import { Router } from "express";
import { z } from "zod";

import { requireRole } from "../lib/auth.js";
import { query, withTransaction } from "../lib/db.js";
import { parcelQuestionAreaJoin } from "../lib/parcelQuestionAreaMatch.js";

const router = Router();

const VALID_STATUSES = ["review", "active", "resolved", "hold"] as const;

const commentSchema = z.object({
  body: z.string().min(3).max(2000),
});

const statusSchema = z.object({
  status: z.enum(VALID_STATUSES),
});

type ParcelRow = {
  id: number;
  properties: Record<string, unknown>;
  geometry: object;
  review_status: string;
};

type ParcelCommentRow = {
  id: number;
  body: string;
  created_at: string;
  author_name: string;
  author_role: string;
};

type ParcelDocumentRow = {
  id: number;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  created_at: string;
};

async function getParcelBase(parcelId: number): Promise<ParcelRow | null> {
  const result = await query<ParcelRow>(
    `
      SELECT
        p.id,
        p.raw_properties || jsonb_build_object('questionAreaCode', qa.code) AS properties,
        ST_AsGeoJSON(p.geom, 5)::jsonb AS geometry,
        p.review_status
      FROM parcel_features p
      ${parcelQuestionAreaJoin("p", "qa")}
      WHERE p.id = $1
      LIMIT 1
    `,
    [parcelId],
  );

  return result.rows[0] ?? null;
}

router.get("/:id", async (req, res) => {
  const parcelId = Number(req.params.id);
  if (!Number.isInteger(parcelId) || parcelId <= 0) {
    res.status(400).json({ message: "Invalid parcel id." });
    return;
  }

  const parcel = await getParcelBase(parcelId);
  if (!parcel) {
    res.status(404).json({ message: "Parcel not found." });
    return;
  }

  const comments = await query<ParcelCommentRow>(
    `
      SELECT pc.id, pc.body, pc.created_at, u.name AS author_name, u.role AS author_role
      FROM parcel_comments pc
      JOIN users u ON u.id = pc.author_id
      WHERE pc.parcel_id = $1
      ORDER BY pc.created_at ASC
    `,
    [parcelId],
  );

  const questionAreaCode = parcel.properties.questionAreaCode;
  let documents: ParcelDocumentRow[] = [];

  if (typeof questionAreaCode === "string" && questionAreaCode.trim()) {
    const documentResult = await query<ParcelDocumentRow>(
      `
        SELECT d.id, d.original_name, d.mime_type, d.size_bytes, d.created_at
        FROM documents d
        JOIN question_areas qa ON qa.id = d.question_area_id
        WHERE qa.code = $1
        ORDER BY d.created_at DESC
      `,
      [questionAreaCode],
    );
    documents = documentResult.rows;
  }

  res.json({
    type: "Feature",
    geometry: parcel.geometry,
    properties: {
      id: parcel.id,
      reviewStatus: parcel.review_status,
      ...parcel.properties,
    },
    comments: comments.rows.map((comment) => ({
      id: comment.id,
      body: comment.body,
      createdAt: comment.created_at,
      authorName: comment.author_name,
      authorRole: comment.author_role,
    })),
    documents: documents.map((document) => ({
      id: document.id,
      originalName: document.original_name,
      mimeType: document.mime_type,
      sizeBytes: document.size_bytes,
      createdAt: document.created_at,
      downloadUrl: `/api/question-areas/documents/${document.id}/download`,
    })),
  });
});

router.post("/:id/comments", requireRole("admin", "client"), async (req, res) => {
  const parcelId = Number(req.params.id);
  if (!Number.isInteger(parcelId) || parcelId <= 0) {
    res.status(400).json({ message: "Invalid parcel id." });
    return;
  }

  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success || !req.user) {
    res.status(400).json({ message: "Comment body is required." });
    return;
  }

  const parcel = await query<{ id: number }>(`SELECT id FROM parcel_features WHERE id = $1`, [parcelId]);
  if (!parcel.rows[0]) {
    res.status(404).json({ message: "Parcel not found." });
    return;
  }

  const result = await query<{ id: number; body: string; created_at: string }>(
    `
      INSERT INTO parcel_comments (parcel_id, author_id, body)
      VALUES ($1, $2, $3)
      RETURNING id, body, created_at
    `,
    [parcelId, req.user.id, parsed.data.body],
  );

  res.status(201).json({
    id: result.rows[0].id,
    body: result.rows[0].body,
    createdAt: result.rows[0].created_at,
    authorName: req.user.name,
    authorRole: req.user.role,
  });
});

router.patch("/:id/status", requireRole("admin", "client"), async (req, res) => {
  const parcelId = Number(req.params.id);
  if (!Number.isInteger(parcelId) || parcelId <= 0) {
    res.status(400).json({ message: "Invalid parcel id." });
    return;
  }

  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success || !req.user) {
    res.status(400).json({ message: "Invalid parcel status." });
    return;
  }

  const status = parsed.data.status;
  const user = req.user;

  const result = await withTransaction(async (client) => {
    const existing = await client.query<{ review_status: string }>(
      `SELECT review_status FROM parcel_features WHERE id = $1 FOR UPDATE`,
      [parcelId],
    );

    const row = existing.rows[0];
    if (!row) {
      return null;
    }

    if (row.review_status !== status) {
      await client.query(
        `UPDATE parcel_features SET review_status = $1 WHERE id = $2`,
        [status, parcelId],
      );

      await client.query(
        `
          INSERT INTO parcel_comments (parcel_id, author_id, body)
          VALUES ($1, $2, $3)
        `,
        [
          parcelId,
          user.id,
          `Status changed from ${row.review_status} to ${status}.`,
        ],
      );
    }

    return {
      reviewStatus: status,
    };
  });

  if (!result) {
    res.status(404).json({ message: "Parcel not found." });
    return;
  }

  res.json(result);
});

export default router;
