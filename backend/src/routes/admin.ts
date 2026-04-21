import { Router } from "express";
import { z } from "zod";

import type { Role } from "../lib/auth.js";
import { hashPassword, requireRole } from "../lib/auth.js";
import { query } from "../lib/db.js";

const router = Router();

const ROLE_OPTIONS = ["admin", "client"] as const;

const emailSchema = z.string().trim().email().transform((value) => value.toLowerCase());

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  role: z.enum(ROLE_OPTIONS),
  password: z.string().min(8).max(100),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: emailSchema.optional(),
  role: z.enum(ROLE_OPTIONS).optional(),
  password: z.string().min(8).max(100).optional(),
});

type ManagedUserRow = {
  id: number;
  name: string;
  email: string;
  role: Role;
  created_at: string;
  comment_count: number;
  document_count: number;
};

type AdminCountRow = {
  count: string;
};

router.use(requireRole("admin"));

function serializeUser(row: ManagedUserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    commentCount: Number(row.comment_count ?? 0),
    documentCount: Number(row.document_count ?? 0),
  };
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

async function getAdminCount(): Promise<number> {
  const result = await query<AdminCountRow>(`SELECT COUNT(*)::text AS count FROM users WHERE role = 'admin'`);
  return Number(result.rows[0]?.count ?? 0);
}

async function getManagedUser(id: number): Promise<ManagedUserRow | null> {
  const result = await query<ManagedUserRow>(
    `
      SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.created_at,
        COALESCE(comment_stats.comment_count, 0)::int AS comment_count,
        COALESCE(document_stats.document_count, 0)::int AS document_count
      FROM users u
      LEFT JOIN (
        SELECT author_id, COUNT(*)::int AS comment_count
        FROM comments
        GROUP BY author_id
      ) AS comment_stats ON comment_stats.author_id = u.id
      LEFT JOIN (
        SELECT uploaded_by, COUNT(*)::int AS document_count
        FROM documents
        GROUP BY uploaded_by
      ) AS document_stats ON document_stats.uploaded_by = u.id
      WHERE u.id = $1
    `,
    [id],
  );

  return result.rows[0] ?? null;
}

router.get("/users", async (_req, res) => {
  const result = await query<ManagedUserRow>(
    `
      SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.created_at,
        COALESCE(comment_stats.comment_count, 0)::int AS comment_count,
        COALESCE(document_stats.document_count, 0)::int AS document_count
      FROM users u
      LEFT JOIN (
        SELECT author_id, COUNT(*)::int AS comment_count
        FROM comments
        GROUP BY author_id
      ) AS comment_stats ON comment_stats.author_id = u.id
      LEFT JOIN (
        SELECT uploaded_by, COUNT(*)::int AS document_count
        FROM documents
        GROUP BY uploaded_by
      ) AS document_stats ON document_stats.uploaded_by = u.id
      ORDER BY
        CASE u.role
          WHEN 'admin' THEN 0
          ELSE 1
        END,
        u.name ASC,
        u.email ASC
    `,
  );

  res.json({
    users: result.rows.map(serializeUser),
  });
});

router.post("/users", async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid user payload." });
    return;
  }

  const passwordHash = await hashPassword(parsed.data.password);

  try {
    const result = await query<ManagedUserRow>(
      `
        INSERT INTO users (name, email, password_hash, role)
        VALUES ($1, $2, $3, $4)
        RETURNING
          id,
          name,
          email,
          role,
          created_at,
          0::int AS comment_count,
          0::int AS document_count
      `,
      [parsed.data.name, parsed.data.email, passwordHash, parsed.data.role],
    );

    res.status(201).json({
      user: serializeUser(result.rows[0]),
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ message: "A user with that email already exists." });
      return;
    }
    throw error;
  }
});

router.patch("/users/:id", async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ message: "Invalid user id." });
    return;
  }

  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid user payload." });
    return;
  }

  const updates = parsed.data;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ message: "No user fields were provided." });
    return;
  }

  const existing = await getManagedUser(userId);
  if (!existing) {
    res.status(404).json({ message: "User not found." });
    return;
  }

  if (updates.role && existing.role === "admin" && updates.role !== "admin") {
    if (req.user?.id === userId) {
      res.status(400).json({ message: "You cannot remove your own admin role." });
      return;
    }

    const adminCount = await getAdminCount();
    if (adminCount <= 1) {
      res.status(409).json({ message: "At least one admin account must remain." });
      return;
    }
  }

  const assignments: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    values.push(updates.name);
    assignments.push(`name = $${values.length}`);
  }
  if (updates.email !== undefined) {
    values.push(updates.email);
    assignments.push(`email = $${values.length}`);
  }
  if (updates.role !== undefined) {
    values.push(updates.role);
    assignments.push(`role = $${values.length}`);
  }
  if (updates.password !== undefined) {
    values.push(await hashPassword(updates.password));
    assignments.push(`password_hash = $${values.length}`);
  }

  values.push(userId);

  try {
    await query(
      `
        UPDATE users
        SET ${assignments.join(", ")}
        WHERE id = $${values.length}
      `,
      values,
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ message: "A user with that email already exists." });
      return;
    }
    throw error;
  }

  const updatedUser = await getManagedUser(userId);
  if (!updatedUser) {
    res.status(404).json({ message: "User not found." });
    return;
  }

  res.json({
    user: serializeUser(updatedUser),
  });
});

router.delete("/users/:id", async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ message: "Invalid user id." });
    return;
  }

  if (req.user?.id === userId) {
    res.status(400).json({ message: "You cannot delete your own account." });
    return;
  }

  const existing = await getManagedUser(userId);
  if (!existing) {
    res.status(404).json({ message: "User not found." });
    return;
  }

  if (existing.role === "admin") {
    const adminCount = await getAdminCount();
    if (adminCount <= 1) {
      res.status(409).json({ message: "At least one admin account must remain." });
      return;
    }
  }

  if (existing.comment_count > 0 || existing.document_count > 0) {
    res.status(409).json({
      message: "Users with comments or uploaded documents cannot be deleted yet.",
    });
    return;
  }

  await query(`DELETE FROM users WHERE id = $1`, [userId]);
  res.status(204).send();
});

export default router;
