import fs from "node:fs/promises";
import path from "node:path";

import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import { config } from "../config.js";
import { requireRole } from "../lib/auth.js";
import { query } from "../lib/db.js";
import { buildQuestionAreaSearchClause, parseSearchField } from "../lib/search.js";
import { featureCollection, parseBbox } from "../lib/utils.js";

const router = Router();

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/geopackage+sqlite3",
  "application/geo+json",
  "application/json",
]);

const MIME_FALLBACK_TYPES = new Set(["", "application/octet-stream"]);

const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".gif", ".webp",
  ".doc", ".docx", ".xls", ".xlsx", ".txt", ".csv", ".zip",
  ".gpkg", ".geojson", ".json",
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, config.uploadsDir);
    },
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      callback(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
    },
  }),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const hasSafeExtension = ALLOWED_EXTENSIONS.has(ext);
    const hasAllowedMime = ALLOWED_MIME_TYPES.has(file.mimetype);
    const hasBrowserFallbackMime = MIME_FALLBACK_TYPES.has(file.mimetype);

    if (!hasSafeExtension || (!hasAllowedMime && !hasBrowserFallbackMime)) {
      callback(new Error(`File type not allowed: ${ext} (${file.mimetype})`));
      return;
    }
    callback(null, true);
  },
});

const VALID_STATUSES = ["review", "active", "resolved", "hold"] as const;

const updateSchema = z.object({
  status: z.enum(VALID_STATUSES).optional(),
  summary: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  assignedReviewer: z.string().nullable().optional(),
});

const commentSchema = z.object({
  body: z.string().min(3).max(2000),
});

router.get("/", async (req, res) => {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const search = String(req.query.search ?? "").trim();
  const searchField = parseSearchField(req.query.field);
  if (search) {
    params.push(`%${search}%`);
    const placeholder = `$${params.length}`;
    clauses.push(`(${buildQuestionAreaSearchClause("qa", placeholder, searchField)})`);
  }

  const status = String(req.query.status ?? "").trim();
  if (status) {
    params.push(status);
    clauses.push(`qa.status = $${params.length}`);
  }

  const bbox = parseBbox(String(req.query.bbox ?? ""));
  if (bbox) {
    const [west, south, east, north] = bbox;
    params.push(west, south, east, north);
    clauses.push(
      `qa.geom && ST_MakeEnvelope($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length}, 4326)`,
    );
  }

  const rawLimit = Number(req.query.limit ?? 500);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 500, 1), 1000);
  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const result = await query<{
    code: string;
    status: string;
    severity: string;
    title: string;
    summary: string;
    county: string | null;
    state: string | null;
    parcel_code: string | null;
    owner_name: string | null;
    property_name: string | null;
    tract_name: string | null;
    fund_name: string | null;
    assigned_reviewer: string | null;
    geometry: object;
  }>(
    `
      SELECT
        code,
        status,
        severity,
        title,
        summary,
        county,
        state,
        parcel_code,
        owner_name,
        property_name,
        tract_name,
        fund_name,
        assigned_reviewer,
        ST_AsGeoJSON(geom, 6)::jsonb AS geometry
      FROM question_areas qa
      ${whereClause}
      ORDER BY code
      LIMIT ${limit}
    `,
    params,
  );

  res.json(
    featureCollection(
      result.rows.map((row) => ({
        type: "Feature",
        geometry: row.geometry as never,
        properties: {
          code: row.code,
          status: row.status,
          severity: row.severity,
          title: row.title,
          summary: row.summary,
          county: row.county,
          state: row.state,
          parcelCode: row.parcel_code,
          ownerName: row.owner_name,
          propertyName: row.property_name,
          tractName: row.tract_name,
          fundName: row.fund_name,
          assignedReviewer: row.assigned_reviewer,
        },
      })),
    ),
  );
});

router.get("/:code", async (req, res) => {
  const result = await query<{
    id: number;
    code: string;
    source_layer: string;
    status: string;
    severity: string;
    title: string;
    summary: string;
    description: string | null;
    county: string | null;
    state: string | null;
    parcel_code: string | null;
    owner_name: string | null;
    property_name: string | null;
    tract_name: string | null;
    fund_name: string | null;
    land_services: string | null;
    tax_bill_acres: number | null;
    gis_acres: number | null;
    exists_in_legal_layer: boolean | null;
    exists_in_management_layer: boolean | null;
    exists_in_client_tabular_bill_data: boolean | null;
    assigned_reviewer: string | null;
    raw_properties: unknown;
    geometry: object;
  }>(
    `
      SELECT
        qa.id,
        code,
        source_layer,
        status,
        severity,
        title,
        summary,
        description,
        county,
        state,
        parcel_code,
        owner_name,
        property_name,
        tract_name,
        fund_name,
        land_services,
        tax_bill_acres,
        gis_acres,
        exists_in_legal_layer,
        exists_in_management_layer,
        exists_in_client_tabular_bill_data,
        assigned_reviewer,
        raw_properties,
        ST_AsGeoJSON(qa.geom, 6)::jsonb AS geometry
      FROM question_areas qa
      WHERE qa.code = $1
    `,
    [req.params.code],
  );

  const row = result.rows[0];
  if (!row) {
    res.status(404).json({ message: "Question area not found." });
    return;
  }

  const [comments, documents] = await Promise.all([
    query<{
      id: number;
      body: string;
      created_at: string;
      author_name: string;
      author_role: string;
    }>(
      `
        SELECT c.id, c.body, c.created_at, u.name AS author_name, u.role AS author_role
        FROM comments c
        JOIN users u ON u.id = c.author_id
        WHERE c.question_area_id = $1
        ORDER BY c.created_at ASC
      `,
      [row.id],
    ),
    query<{
      id: number;
      original_name: string;
      mime_type: string | null;
      size_bytes: number;
      created_at: string;
    }>(
      `
        SELECT id, original_name, mime_type, size_bytes, created_at
        FROM documents
        WHERE question_area_id = $1
        ORDER BY created_at DESC
      `,
      [row.id],
    ),
  ]);

  res.json({
    id: row.id,
    code: row.code,
    sourceLayer: row.source_layer,
    status: row.status,
    severity: row.severity,
    title: row.title,
    summary: row.summary,
    description: row.description,
    county: row.county,
    state: row.state,
    parcelCode: row.parcel_code,
    ownerName: row.owner_name,
    propertyName: row.property_name,
    tractName: row.tract_name,
    fundName: row.fund_name,
    landServices: row.land_services,
    taxBillAcres: row.tax_bill_acres,
    gisAcres: row.gis_acres,
    existsInLegalLayer: row.exists_in_legal_layer,
    existsInManagementLayer: row.exists_in_management_layer,
    existsInClientTabularBillData: row.exists_in_client_tabular_bill_data,
    assignedReviewer: row.assigned_reviewer,
    rawProperties: row.raw_properties,
    geometry: row.geometry,
    comments: comments.rows.map((comment) => ({
      id: comment.id,
      body: comment.body,
      createdAt: comment.created_at,
      authorName: comment.author_name,
      authorRole: comment.author_role,
    })),
    documents: documents.rows.map((document) => ({
      id: document.id,
      originalName: document.original_name,
      mimeType: document.mime_type,
      sizeBytes: document.size_bytes,
      createdAt: document.created_at,
      downloadUrl: `/api/question-areas/documents/${document.id}/download`,
    })),
  });
});

router.patch("/:code", requireRole("admin", "client"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid update payload." });
    return;
  }

  const updates = parsed.data;
  const assignments: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    values.push(updates.status);
    assignments.push(`status = $${values.length}`);
  }
  if (updates.summary !== undefined) {
    values.push(updates.summary);
    assignments.push(`summary = $${values.length}`);
  }
  if (updates.description !== undefined) {
    values.push(updates.description);
    assignments.push(`description = $${values.length}`);
  }
  if (updates.assignedReviewer !== undefined) {
    values.push(updates.assignedReviewer);
    assignments.push(`assigned_reviewer = $${values.length}`);
  }

  if (assignments.length === 0) {
    res.status(400).json({ message: "No updatable fields provided." });
    return;
  }

  values.push(req.params.code);

  const result = await query<{ code: string; status: string; summary: string; assigned_reviewer: string | null }>(
    `
      UPDATE question_areas
      SET ${assignments.join(", ")}, updated_at = NOW()
      WHERE code = $${values.length}
      RETURNING code, status, summary, assigned_reviewer
    `,
    values,
  );

  const row = result.rows[0];
  if (!row) {
    res.status(404).json({ message: "Question area not found." });
    return;
  }

  res.json({
    code: row.code,
    status: row.status,
    summary: row.summary,
    assignedReviewer: row.assigned_reviewer,
  });
});

router.post("/:code/comments", requireRole("admin", "client"), async (req, res) => {
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Comment body is required." });
    return;
  }

  const questionArea = await query<{ id: number }>(
    `SELECT id FROM question_areas WHERE code = $1`,
    [req.params.code],
  );

  const area = questionArea.rows[0];
  if (!area || !req.user) {
    res.status(404).json({ message: "Question area not found." });
    return;
  }

  const result = await query<{
    id: number;
    body: string;
    created_at: string;
  }>(
    `
      INSERT INTO comments (question_area_id, author_id, body)
      VALUES ($1, $2, $3)
      RETURNING id, body, created_at
    `,
    [area.id, req.user.id, parsed.data.body],
  );

  res.status(201).json({
    id: result.rows[0].id,
    body: result.rows[0].body,
    createdAt: result.rows[0].created_at,
    authorName: req.user.name,
    authorRole: req.user.role,
  });
});

router.post("/:code/documents", requireRole("admin", "client"), (req, res, next) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      res.status(400).json({ message: `Upload error: ${err.message}` });
      return;
    }
    if (err instanceof Error) {
      res.status(400).json({ message: err.message });
      return;
    }
    next();
  });
}, async (req, res) => {
  if (!req.file || !req.user) {
    res.status(400).json({ message: "A file is required." });
    return;
  }

  const questionArea = await query<{ id: number }>(
    `SELECT id FROM question_areas WHERE code = $1`,
    [req.params.code],
  );

  const area = questionArea.rows[0];
  if (!area) {
    await fs.unlink(req.file.path).catch(() => undefined);
    res.status(404).json({ message: "Question area not found." });
    return;
  }

  try {
    const result = await query<{
      id: number;
      original_name: string;
      mime_type: string | null;
      size_bytes: number;
      created_at: string;
    }>(
      `
        INSERT INTO documents (question_area_id, original_name, stored_name, mime_type, size_bytes, uploaded_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, original_name, mime_type, size_bytes, created_at
      `,
      [
        area.id,
        req.file.originalname,
        req.file.filename,
        req.file.mimetype,
        req.file.size,
        req.user.id,
      ],
    );

    res.status(201).json({
      id: result.rows[0].id,
      originalName: result.rows[0].original_name,
      mimeType: result.rows[0].mime_type,
      sizeBytes: result.rows[0].size_bytes,
      createdAt: result.rows[0].created_at,
      downloadUrl: `/api/question-areas/documents/${result.rows[0].id}/download`,
    });
  } catch (dbError) {
    await fs.unlink(req.file.path).catch(() => undefined);
    throw dbError;
  }
});

router.get("/documents/:id/download", async (req, res) => {
  const result = await query<{
    original_name: string;
    stored_name: string;
  }>(
    `SELECT original_name, stored_name FROM documents WHERE id = $1`,
    [req.params.id],
  );

  const document = result.rows[0];
  if (!document) {
    res.status(404).json({ message: "Document not found." });
    return;
  }

  const filePath = path.join(config.uploadsDir, document.stored_name);
  try {
    await fs.access(filePath);
  } catch {
    res.status(404).json({ message: "Document file is missing from storage." });
    return;
  }

  res.download(filePath, document.original_name);
});

export default router;
