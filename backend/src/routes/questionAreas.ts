import fs from "node:fs/promises";
import path from "node:path";

import { Router, type Request } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { z } from "zod";

import { config } from "../config.js";
import { loadAtlasQuestionAreaView, normalizeAtlasBufferFeet } from "../lib/atlas.js";
import { query } from "../lib/db.js";
import { hasPermission, requirePermission } from "../lib/rbac.js";
import { buildQuestionAreaSearchClause, parseSearchField } from "../lib/search.js";
import {
  loadTaxParcelQuestionAreaView,
  normalizeTaxParcelBufferFeet,
} from "../lib/taxParcels.js";
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
const VALID_SEVERITIES = ["high", "medium", "low"] as const;
const VALID_ACTIONABILITY_STATES = ["normal", "high_pain", "no_parcel_data", "in_progress"] as const;
const DATA_AVAILABILITY_FILTERS = ["available", "missing", "unknown"] as const;
const EXPORT_LIMIT = 10_000;

type QuestionActionabilityState = (typeof VALID_ACTIONABILITY_STATES)[number];
type DataAvailabilityFilter = (typeof DATA_AVAILABILITY_FILTERS)[number];
type QuestionAreaWhereClause = {
  whereClause: string;
  params: unknown[];
};

const updateSchema = z.object({
  status: z.enum(VALID_STATUSES).optional(),
  severity: z.enum(VALID_SEVERITIES).optional(),
  summary: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  assignedReviewer: z.string().nullable().optional(),
});

const commentSchema = z.object({
  body: z.string().min(3).max(2000),
});

function addIlikeFilter(clauses: string[], params: unknown[], value: unknown, expression: string) {
  const text = String(value ?? "").trim();
  if (!text) {
    return;
  }

  params.push(`%${text}%`);
  clauses.push(`${expression} ILIKE $${params.length}`);
}

function addBooleanAvailabilityFilter(
  clauses: string[],
  value: unknown,
  expression: string,
) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!DATA_AVAILABILITY_FILTERS.includes(normalized as DataAvailabilityFilter)) {
    return;
  }

  if (normalized === "available") {
    clauses.push(`${expression} IS TRUE`);
  } else if (normalized === "missing") {
    clauses.push(`${expression} IS FALSE`);
  } else {
    clauses.push(`${expression} IS NULL`);
  }
}

function addActionabilityFilter(clauses: string[], value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  switch (normalized) {
    case "open":
      clauses.push(`qa.status IN ('review', 'active')`);
      break;
    case "closed":
      clauses.push(`qa.status IN ('resolved', 'hold')`);
      break;
    case "assigned":
      clauses.push(`NULLIF(BTRIM(qa.assigned_reviewer), '') IS NOT NULL`);
      break;
    case "unassigned":
      clauses.push(`NULLIF(BTRIM(qa.assigned_reviewer), '') IS NULL`);
      break;
    case "needs_data":
      clauses.push(`(
        qa.exists_in_legal_layer IS NOT TRUE
        OR qa.exists_in_management_layer IS NOT TRUE
        OR qa.exists_in_client_tabular_bill_data IS NOT TRUE
      )`);
      break;
    case "ready":
      clauses.push(`(
        qa.exists_in_legal_layer IS TRUE
        AND qa.exists_in_management_layer IS TRUE
        AND qa.exists_in_client_tabular_bill_data IS TRUE
      )`);
      break;
    default:
      break;
  }
}

function addActionabilityStateFilter(clauses: string[], params: unknown[], value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!VALID_ACTIONABILITY_STATES.includes(normalized as QuestionActionabilityState)) {
    return;
  }

  params.push(normalized);
  clauses.push(`qa.actionability_state = $${params.length}`);
}

function buildQuestionAreaWhereClause(req: Request): QuestionAreaWhereClause {
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

  const severity = String(req.query.severity ?? req.query.priority ?? "").trim();
  if (severity) {
    params.push(severity);
    clauses.push(`qa.severity = $${params.length}`);
  }

  addIlikeFilter(clauses, params, req.query.state, "COALESCE(qa.state, '')");
  addIlikeFilter(clauses, params, req.query.county, "COALESCE(qa.county, '')");
  addIlikeFilter(clauses, params, req.query.propertyName ?? req.query.property, "COALESCE(qa.property_name, '')");
  addIlikeFilter(
    clauses,
    params,
    req.query.assignedReviewer ?? req.query.reviewer ?? req.query.assignee,
    "COALESCE(qa.assigned_reviewer, '')",
  );
  addActionabilityFilter(clauses, req.query.actionability);
  addActionabilityStateFilter(clauses, params, req.query.actionabilityState);
  addBooleanAvailabilityFilter(clauses, req.query.hasLegalData, "qa.exists_in_legal_layer");
  addBooleanAvailabilityFilter(clauses, req.query.hasManagementData, "qa.exists_in_management_layer");
  addBooleanAvailabilityFilter(
    clauses,
    req.query.hasClientBillData,
    "qa.exists_in_client_tabular_bill_data",
  );

  const bbox = parseBbox(String(req.query.bbox ?? ""));
  if (bbox) {
    const [west, south, east, north] = bbox;
    params.push(west, south, east, north);
    clauses.push(
      `qa.geom && ST_MakeEnvelope($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length}, 4326)`,
    );
  }

  return {
    params,
    whereClause: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
  };
}

function formatExportBoolean(value: boolean | null) {
  if (value === null) {
    return "Unknown";
  }

  return value ? "Yes" : "No";
}

function safeReportValue(value: string | number | null) {
  return value ?? "";
}

function formatRisk(value: string | null) {
  const text = String(value ?? "").trim();
  return text || "Unspecified";
}

router.get("/", requirePermission("question_areas:read"), async (req, res) => {
  const { params, whereClause } = buildQuestionAreaWhereClause(req);
  const rawLimit = Number(req.query.limit ?? 500);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 500, 1), 1000);

  const result = await query<{
    code: string;
    status: string;
    severity: string;
    actionability_state: string;
    title: string;
    summary: string;
    county: string | null;
    state: string | null;
    parcel_code: string | null;
    owner_name: string | null;
    property_name: string | null;
    tract_name: string | null;
    fund_name: string | null;
    risk: string | null;
    spatial_overlay_notes: string | null;
    legal_description: string | null;
    latitude: number | null;
    longitude: number | null;
    questionnaire_source: string | null;
    tax_bill_acres: number | null;
    gis_acres: number | null;
    land_services: string | null;
    assigned_reviewer: string | null;
    exists_in_legal_layer: boolean | null;
    exists_in_management_layer: boolean | null;
    exists_in_client_tabular_bill_data: boolean | null;
    geometry: object;
  }>(
    `
      SELECT
        code,
        status,
        severity,
        actionability_state,
        title,
        summary,
        county,
        state,
        parcel_code,
        owner_name,
        property_name,
        tract_name,
        fund_name,
        risk,
        spatial_overlay_notes,
        legal_description,
        latitude,
        longitude,
        questionnaire_source,
        tax_bill_acres,
        gis_acres,
        land_services,
        assigned_reviewer,
        exists_in_legal_layer,
        exists_in_management_layer,
        exists_in_client_tabular_bill_data,
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
          actionabilityState: row.actionability_state,
          title: row.title,
          summary: row.summary,
          county: row.county,
          state: row.state,
          parcelCode: row.parcel_code,
          ownerName: row.owner_name,
          propertyName: row.property_name,
          tractName: row.tract_name,
          fundName: row.fund_name,
          risk: row.risk,
          spatialOverlayNotes: row.spatial_overlay_notes,
          legalDescription: row.legal_description,
          latitude: row.latitude,
          longitude: row.longitude,
          questionnaireSource: row.questionnaire_source,
          taxBillAcres: row.tax_bill_acres,
          gisAcres: row.gis_acres,
          landServices: row.land_services,
          assignedReviewer: row.assigned_reviewer,
          existsInLegalLayer: row.exists_in_legal_layer,
          existsInManagementLayer: row.exists_in_management_layer,
          existsInClientTabularBillData: row.exists_in_client_tabular_bill_data,
        },
      })),
    ),
  );
});

router.get("/filter-options", requirePermission("question_areas:read"), async (_req, res) => {
  const result = await query<{
    states: string[];
    counties: string[];
    property_names: string[];
    assigned_reviewers: string[];
  }>(`
    SELECT
      COALESCE(
        ARRAY_AGG(DISTINCT NULLIF(BTRIM(state), '') ORDER BY NULLIF(BTRIM(state), ''))
          FILTER (WHERE NULLIF(BTRIM(state), '') IS NOT NULL),
        ARRAY[]::text[]
      ) AS states,
      COALESCE(
        ARRAY_AGG(DISTINCT NULLIF(BTRIM(county), '') ORDER BY NULLIF(BTRIM(county), ''))
          FILTER (WHERE NULLIF(BTRIM(county), '') IS NOT NULL),
        ARRAY[]::text[]
      ) AS counties,
      COALESCE(
        ARRAY_AGG(DISTINCT NULLIF(BTRIM(property_name), '') ORDER BY NULLIF(BTRIM(property_name), ''))
          FILTER (WHERE NULLIF(BTRIM(property_name), '') IS NOT NULL),
        ARRAY[]::text[]
      ) AS property_names,
      COALESCE(
        ARRAY_AGG(DISTINCT NULLIF(BTRIM(assigned_reviewer), '') ORDER BY NULLIF(BTRIM(assigned_reviewer), ''))
          FILTER (WHERE NULLIF(BTRIM(assigned_reviewer), '') IS NOT NULL),
        ARRAY[]::text[]
      ) AS assigned_reviewers
    FROM question_areas
  `);

  const options = result.rows[0] ?? {
    states: [],
    counties: [],
    property_names: [],
    assigned_reviewers: [],
  };

  res.json({
    states: options.states,
    counties: options.counties,
    propertyNames: options.property_names,
    assignedReviewers: options.assigned_reviewers,
  });
});

router.get("/export.xlsx", requirePermission("question_areas:read"), async (req, res) => {
  const { params, whereClause } = buildQuestionAreaWhereClause(req);
  const result = await query<{
    code: string;
    status: string;
    severity: string;
    actionability_state: string;
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
    spatial_overlay_notes: string | null;
    legal_description: string | null;
    risk: string | null;
    questionnaire_source: string | null;
    assigned_reviewer: string | null;
    exists_in_legal_layer: boolean | null;
    exists_in_management_layer: boolean | null;
    exists_in_client_tabular_bill_data: boolean | null;
    longitude: number | null;
    latitude: number | null;
  }>(
    `
      SELECT
        code,
        status,
        severity,
        actionability_state,
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
        spatial_overlay_notes,
        legal_description,
        risk,
        questionnaire_source,
        assigned_reviewer,
        exists_in_legal_layer,
        exists_in_management_layer,
        exists_in_client_tabular_bill_data,
        COALESCE(longitude, ST_X(geom)) AS longitude,
        COALESCE(latitude, ST_Y(geom)) AS latitude
      FROM question_areas qa
      ${whereClause}
      ORDER BY code
      LIMIT ${EXPORT_LIMIT}
    `,
    params,
  );

  const rows = result.rows.map((row) => ({
    "Question Area ID": row.code,
    Status: row.status,
    Priority: row.severity,
    Risk: formatRisk(row.risk),
    Actionability: row.actionability_state,
    Title: row.title,
    Summary: row.summary,
    "Spatial Overlay Notes": safeReportValue(row.spatial_overlay_notes),
    Description: safeReportValue(row.description),
    County: safeReportValue(row.county),
    State: safeReportValue(row.state),
    "Tax Parcel Code": safeReportValue(row.parcel_code),
    "Record Owner": safeReportValue(row.owner_name),
    Property: safeReportValue(row.property_name),
    Tract: safeReportValue(row.tract_name),
    Fund: safeReportValue(row.fund_name),
    "Land Services Note": safeReportValue(row.land_services),
    "Legal Description": safeReportValue(row.legal_description),
    "Tax Bill Acres": safeReportValue(row.tax_bill_acres),
    "GIS Acres": safeReportValue(row.gis_acres),
    "Assigned Reviewer": safeReportValue(row.assigned_reviewer),
    "Legal/Deed Evidence": formatExportBoolean(row.exists_in_legal_layer),
    "Management Data": formatExportBoolean(row.exists_in_management_layer),
    "In Client Bill Data": formatExportBoolean(row.exists_in_client_tabular_bill_data),
    Longitude: safeReportValue(row.longitude),
    Latitude: safeReportValue(row.latitude),
    "Questionnaire Source": safeReportValue(row.questionnaire_source),
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Question Areas");
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;

  res
    .status(200)
    .setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .setHeader("Content-Disposition", 'attachment; filename="question-area-report.xlsx"')
    .send(buffer);
});

router.get("/:code/atlas", requirePermission("atlas_land_records:read"), async (req, res) => {
  const unit = String(req.query.unit ?? "feet").trim().toLowerCase();
  if (unit !== "feet") {
    res.status(400).json({ message: "Atlas buffer unit must be feet." });
    return;
  }

  const bufferFeet = normalizeAtlasBufferFeet(req.query.buffer ?? 500);
  if (!bufferFeet) {
    res.status(400).json({ message: "Atlas buffer must be one of 100, 500, 1000, or 5000 feet." });
    return;
  }

  const questionAreaCode = String(req.params.code);
  const result = await loadAtlasQuestionAreaView(questionAreaCode, bufferFeet);
  if (!result) {
    res.status(404).json({ message: "Question area not found." });
    return;
  }

  res.json(result);
});

router.get("/:code/tax-parcels", requirePermission("property_tax:read"), async (req, res) => {
  const unit = String(req.query.unit ?? "feet").trim().toLowerCase();
  if (unit !== "feet") {
    res.status(400).json({ message: "Tax parcel buffer unit must be feet." });
    return;
  }

  const bufferFeet = normalizeTaxParcelBufferFeet(req.query.buffer ?? 500);
  if (!bufferFeet) {
    res.status(400).json({ message: "Tax parcel buffer must be one of 100, 500, 1000, or 5000 feet." });
    return;
  }

  const questionAreaCode = String(req.params.code);
  const result = await loadTaxParcelQuestionAreaView(questionAreaCode, bufferFeet);
  if (!result) {
    res.status(404).json({ message: "Question area not found." });
    return;
  }

  res.json(result);
});

router.get("/:code", requirePermission("question_areas:read"), async (req, res) => {
  const result = await query<{
    id: number;
    code: string;
    source_layer: string;
    status: string;
    severity: string;
    actionability_state: string;
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
    spatial_overlay_notes: string | null;
    legal_description: string | null;
    risk: string | null;
    latitude: number | null;
    longitude: number | null;
    questionnaire_source: string | null;
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
        actionability_state,
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
        spatial_overlay_notes,
        legal_description,
        risk,
        latitude,
        longitude,
        questionnaire_source,
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
    actionabilityState: row.actionability_state,
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
    spatialOverlayNotes: row.spatial_overlay_notes,
    legalDescription: row.legal_description,
    risk: row.risk,
    latitude: row.latitude,
    longitude: row.longitude,
    questionnaireSource: row.questionnaire_source,
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

router.patch("/:code", requirePermission("question_areas:review"), async (req, res) => {
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
  if (updates.severity !== undefined) {
    values.push(updates.severity);
    assignments.push(`severity = $${values.length}`);
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

  if (updates.assignedReviewer !== undefined && !hasPermission(req.user, "question_areas:assign")) {
    res.status(403).json({ message: "Insufficient permissions." });
    return;
  }

  values.push(req.params.code);

  const result = await query<{
    code: string;
    status: string;
    severity: string;
    summary: string;
    assigned_reviewer: string | null;
  }>(
    `
      UPDATE question_areas
      SET ${assignments.join(", ")}, updated_at = NOW()
      WHERE code = $${values.length}
      RETURNING code, status, severity, summary, assigned_reviewer
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
    severity: row.severity,
    summary: row.summary,
    assignedReviewer: row.assigned_reviewer,
  });
});

router.post("/:code/comments", requirePermission("question_areas:comment"), async (req, res) => {
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

router.post("/:code/documents", requirePermission("question_areas:upload_document"), (req, res, next) => {
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

router.get("/documents/:id/download", requirePermission("question_areas:read"), async (req, res) => {
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
