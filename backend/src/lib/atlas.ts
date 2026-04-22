import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { QueryResult, QueryResultRow } from "pg";

import { config } from "../config.js";
import { query } from "./db.js";

export const ATLAS_BUFFER_FEET_OPTIONS = [100, 500, 1000, 5000] as const;

export type AtlasBufferFeet = (typeof ATLAS_BUFFER_FEET_OPTIONS)[number];

export type AtlasWarning = {
  code: "missing_geometry" | "missing_file" | "unsupported_preview";
  message: string;
  severity: "warning";
  lrNumber?: string | null;
  documentNumber?: string | null;
};

export type AtlasDocument = {
  documentNumber: string;
  docName: string | null;
  docType: string | null;
  pageNo: string | null;
  packageRelativePath: string | null;
  fileName: string | null;
  extension: string | null;
  sizeBytes: number | null;
  hasFile: boolean;
  isPreviewable: boolean;
  contentUrl: string | null;
  downloadUrl: string;
};

type AtlasDocumentAsset = AtlasDocument & {
  recordingInstrument: string | null;
  recordingDate: string | null;
  expirationDate: string | null;
  deedAcres: number | null;
  keywords: string | null;
  remark: string | null;
  sourceFile: string | null;
  propertyCode: string | null;
  propertyName: string | null;
  filePath: string | null;
  mimeType: string | null;
};

export type AtlasRecord = {
  lrNumber: string;
  tractKey: string | null;
  oldLrNumber: string | null;
  primaryDocumentNumber: string | null;
  primaryPageNo: string | null;
  propertyName: string | null;
  fundName: string | null;
  regionName: string | null;
  lrType: string | null;
  lrStatus: string | null;
  acqDate: string | null;
  taxParcelNumber: string | null;
  gisAcres: number | null;
  deedAcres: number | null;
  docDescriptionHeading: string | null;
  lrSpecs: string | null;
  township: string | null;
  range: string | null;
  section: string | null;
  fips: string | null;
  remark: string | null;
  sourceFile: string | null;
  geometry: object | null;
  documents: AtlasDocument[];
};

export type AtlasQueryResult = {
  questionAreaCode: string;
  bufferValue: AtlasBufferFeet;
  bufferUnit: "feet";
  bufferGeometry: object;
  matchedRecordCount: number;
  linkedDocumentCount: number;
  records: AtlasRecord[];
  warnings: AtlasWarning[];
};

type AtlasCsvRow = Record<string, string>;

const ATLAS_SEED_TABLES = [
  "atlas_land_records",
  "atlas_documents",
  "atlas_document_links",
  "atlas_featureless_docs",
  "atlas_document_manifest",
] as const;

const ATLAS_SEED_METADATA_KEY = "atlas_package_sha256";

const ATLAS_PREVIEWABLE_EXTENSIONS = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".tif",
  ".tiff",
]);

function csvNullableText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return value === "" ? null : value;
}

function csvNullableNumber(value: string | null | undefined): number | null {
  const text = csvNullableText(value);
  if (text === null) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function csvNullableInteger(value: string | null | undefined): number | null {
  const parsed = csvNullableNumber(value);
  if (parsed === null) {
    return null;
  }
  return Number.isInteger(parsed) ? parsed : Math.trunc(parsed);
}

function parseCsvRows(raw: string): AtlasCsvRow[] {
  const text = raw.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (inQuotes) {
      if (char === "\"") {
        if (nextChar === "\"") {
          field += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    if (char === "\n") {
      row.push(field);
      field = "";
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value !== "")) {
    rows.push(row);
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows.shift() ?? [];
  return rows.map((values) => {
    const record: AtlasCsvRow = {};
    headers.forEach((header, index) => {
      if (!header) {
        return;
      }
      record[header] = values[index] ?? "";
    });
    return record;
  });
}

async function readAtlasCsv(filename: string): Promise<AtlasCsvRow[]> {
  const filePath = path.join(config.atlasPackageDir, filename);
  const raw = await fs.readFile(filePath, "utf-8");
  return parseCsvRows(raw);
}

async function hashAtlasPackage(): Promise<string> {
  const hash = crypto.createHash("sha256");
  const filenames = [
    "land_records.csv",
    "documents.csv",
    "document_links.csv",
    "featureless_docs.csv",
    "document_manifest.csv",
  ];

  for (const filename of filenames) {
    const filePath = path.join(config.atlasPackageDir, filename);
    const raw = await fs.readFile(filePath);
    hash.update(filename);
    hash.update(raw);
  }

  return hash.digest("hex");
}

function normalizeAtlasExtension(extension: string | null, fileName?: string | null): string | null {
  const source = csvNullableText(extension) ?? csvNullableText(fileName ? path.extname(fileName) : null);
  if (!source) {
    return null;
  }

  const normalized = source.toLowerCase();
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}

function isAtlasPreviewableExtension(extension: string | null, fileName?: string | null): boolean {
  const normalized = normalizeAtlasExtension(extension, fileName);
  if (!normalized) {
    return false;
  }

  return ATLAS_PREVIEWABLE_EXTENSIONS.has(normalized);
}

function mimeTypeFromExtension(extension: string | null, fileName?: string | null): string | null {
  const normalized = normalizeAtlasExtension(extension, fileName);
  if (!normalized) {
    return null;
  }

  switch (normalized) {
    case ".pdf":
      return "application/pdf";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    default:
      return null;
  }
}

function normalizePackageRelativePath(packageRelativePath: string): string | null {
  const trimmed = packageRelativePath.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/[\\/]+/g, path.sep);
}

export function resolveAtlasPackagePath(packageRelativePath: string | null): string | null {
  if (!packageRelativePath) {
    return null;
  }

  const normalized = normalizePackageRelativePath(packageRelativePath);
  if (!normalized) {
    return null;
  }

  const root = path.resolve(config.atlasPackageDir);
  const candidate = path.resolve(root, normalized);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return candidate;
}

function makeAtlasDocumentUrls(documentNumber: string): Pick<AtlasDocumentAsset, "contentUrl" | "downloadUrl"> {
  const encoded = encodeURIComponent(documentNumber);
  return {
    contentUrl: `/api/atlas/documents/${encoded}/content`,
    downloadUrl: `/api/atlas/documents/${encoded}/download`,
  };
}

function toAtlasDocument(asset: AtlasDocumentAsset): AtlasDocument {
  return {
    documentNumber: asset.documentNumber,
    docName: asset.docName,
    docType: asset.docType,
    pageNo: asset.pageNo,
    packageRelativePath: asset.packageRelativePath,
    fileName: asset.fileName,
    extension: asset.extension,
    sizeBytes: asset.sizeBytes,
    hasFile: asset.hasFile,
    isPreviewable: asset.isPreviewable,
    contentUrl: asset.contentUrl,
    downloadUrl: asset.downloadUrl,
  };
}

type AtlasDocumentRow = {
  document_number: string;
  doc_name: string | null;
  doc_type: string | null;
  recording_instrument: string | null;
  recording_date: string | null;
  expiration_date: string | null;
  deed_acres: number | null;
  keywords: string | null;
  remark: string | null;
  source_file: string | null;
  property_code: string | null;
  property_name: string | null;
  package_relative_path: string | null;
  file_name: string | null;
  extension: string | null;
  size_bytes: number | null;
};

export async function ensureAtlasSeedData(client: {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}): Promise<void> {
  const counts = await getAtlasTableCounts(client);
  const allPopulated = ATLAS_SEED_TABLES.every((table) => (counts[table] ?? 0) > 0);
  const somePopulated = ATLAS_SEED_TABLES.some((table) => (counts[table] ?? 0) > 0);
  const packageHash = await hashAtlasPackage();

  if (allPopulated) {
    const storedHash = await getAtlasSeedHash(client);
    if (!storedHash) {
      throw new Error(buildAtlasMismatchMessage("Atlas seed metadata is missing for an already-populated database."));
    }
    if (storedHash !== packageHash) {
      throw new Error(buildAtlasMismatchMessage("Atlas package hash changed."));
    }
    return;
  }

  if (somePopulated) {
    throw new Error(buildAtlasMismatchMessage("Atlas seed tables are partially populated."));
  }

  await importAtlasSeedData(client);
  await storeAtlasSeedHash(client, packageHash);
}

async function getAtlasTableCounts(client: {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}): Promise<Record<string, number>> {
  const result = await client.query<{ tbl: string; count: string }>(`
    SELECT tbl, count FROM (
      SELECT 'atlas_land_records' AS tbl, COUNT(*)::text AS count FROM atlas_land_records
      UNION ALL
      SELECT 'atlas_documents', COUNT(*)::text FROM atlas_documents
      UNION ALL
      SELECT 'atlas_document_links', COUNT(*)::text FROM atlas_document_links
      UNION ALL
      SELECT 'atlas_featureless_docs', COUNT(*)::text FROM atlas_featureless_docs
      UNION ALL
      SELECT 'atlas_document_manifest', COUNT(*)::text FROM atlas_document_manifest
    ) sub
  `);
  return Object.fromEntries(result.rows.map((row) => [row.tbl, Number(row.count)]));
}

async function getAtlasSeedHash(client: {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}): Promise<string | null> {
  const result = await client.query<{ value: string }>(
    `SELECT value FROM seed_metadata WHERE key = $1`,
    [ATLAS_SEED_METADATA_KEY],
  );
  return result.rows[0]?.value ?? null;
}

async function storeAtlasSeedHash(
  client: {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  },
  packageHash: string,
): Promise<void> {
  await client.query(
    `
      INSERT INTO seed_metadata (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [ATLAS_SEED_METADATA_KEY, packageHash],
  );
}

function buildAtlasMismatchMessage(reason: string): string {
  return [
    reason,
    "The Atlas package no longer matches the populated PostGIS seed metadata.",
    "For local development, reset and reseed the database explicitly, for example: docker compose down -v && docker compose up --build.",
  ].join(" ");
}

async function importAtlasSeedData(client: {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}): Promise<void> {
  const [landRecords, documents, documentLinks, featurelessDocs, documentManifest] = await Promise.all([
    readAtlasCsv("land_records.csv"),
    readAtlasCsv("documents.csv"),
    readAtlasCsv("document_links.csv"),
    readAtlasCsv("featureless_docs.csv"),
    readAtlasCsv("document_manifest.csv"),
  ]);

  await bulkInsertAtlasLandRecords(client, landRecords);

  await bulkInsert(
    client,
    "atlas_documents",
    [
      "document_number",
      "doc_name",
      "doc_type",
      "recording_instrument",
      "recording_date",
      "expiration_date",
      "deed_acres",
      "keywords",
      "remark",
      "source_file",
    ],
    documents,
    (row) => [
      csvNullableText(row.document_number),
      csvNullableText(row.doc_name),
      csvNullableText(row.doc_type),
      csvNullableText(row.recording_instrument),
      csvNullableText(row.recording_date),
      csvNullableText(row.expiration_date),
      csvNullableNumber(row.deed_acres),
      csvNullableText(row.keywords),
      csvNullableText(row.remark),
      csvNullableText(row.source_file),
    ],
  );

  await bulkInsert(
    client,
    "atlas_document_links",
    ["lr_number", "document_number", "page_no"],
    documentLinks,
    (row) => [
      csvNullableText(row.lr_number),
      csvNullableText(row.document_number),
      csvNullableText(row.page_no),
    ],
  );

  await bulkInsert(
    client,
    "atlas_featureless_docs",
    ["document_number"],
    featurelessDocs,
    (row) => [csvNullableText(row.document_number)],
  );

  await bulkInsert(
    client,
    "atlas_document_manifest",
    [
      "property_code",
      "property_name",
      "source_folder",
      "package_relative_path",
      "file_name",
      "extension",
      "size_bytes",
      "document_number",
    ],
    documentManifest,
    (row) => [
      csvNullableText(row.property_code),
      csvNullableText(row.property_name),
      csvNullableText(row.source_folder),
      csvNullableText(row.package_relative_path),
      csvNullableText(row.file_name),
      csvNullableText(row.extension),
      csvNullableInteger(row.size_bytes),
      csvNullableText(row.document_number),
    ],
  );
}

async function bulkInsert<T>(
  client: {
    query<U extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<U>>;
  },
  table: string,
  columns: string[],
  rows: T[],
  rowValues: (row: T) => unknown[],
  batchSize = 250,
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values: unknown[] = [];
    const placeholders = batch.map((row) => {
      const currentValues = rowValues(row);
      const rowStart = values.length;
      values.push(...currentValues);
      return `(${currentValues.map((_value, index) => `$${rowStart + index + 1}`).join(", ")})`;
    });

    if (batch.length === 0) {
      continue;
    }

    await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders.join(", ")}`,
      values,
    );
  }
}

async function bulkInsertAtlasLandRecords(
  client: {
    query<U extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<U>>;
  },
  rows: AtlasCsvRow[],
  batchSize = 250,
): Promise<void> {
  const columns = [
    "lr_number",
    "tract_key",
    "old_lr_number",
    "primary_document_number",
    "primary_page_no",
    "property_name",
    "fund_name",
    "region_name",
    "lr_type",
    "lr_status",
    "acq_date",
    "tax_parcel_number",
    "gis_acres",
    "deed_acres",
    "doc_description_heading",
    "lr_specs",
    "township",
    "range",
    "section",
    "fips",
    "remark",
    "source_file",
    "geom",
  ];

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values: unknown[] = [];
    const placeholders = batch.map((row) => {
      const rowValues = [
        csvNullableText(row.lr_number),
        csvNullableText(row.tract_key),
        csvNullableText(row.old_lr_number),
        csvNullableText(row.primary_document_number),
        csvNullableText(row.primary_page_no),
        csvNullableText(row.property_name),
        csvNullableText(row.fund_name),
        csvNullableText(row.region_name),
        csvNullableText(row.lr_type),
        csvNullableText(row.lr_status),
        csvNullableText(row.acq_date),
        csvNullableText(row.tax_parcel_number),
        csvNullableNumber(row.gis_acres),
        csvNullableNumber(row.deed_acres),
        csvNullableText(row.doc_description_heading),
        csvNullableText(row.lr_specs),
        csvNullableText(row.township),
        csvNullableText(row.range),
        csvNullableText(row.section),
        csvNullableText(row.fips),
        csvNullableText(row.remark),
        csvNullableText(row.source_file),
        csvNullableText(row.geom_wkt),
      ];
      const rowStart = values.length;
      values.push(...rowValues);
      const geomPlaceholder = `$${rowStart + rowValues.length}`;
      return `(${rowValues
        .slice(0, -1)
        .map((_value, index) => `$${rowStart + index + 1}`)
        .join(", ")}, CASE WHEN ${geomPlaceholder} IS NULL THEN NULL ELSE ST_Multi(ST_Force2D(ST_SetSRID(ST_GeomFromText(${geomPlaceholder}), 4326))) END)`;
    });

    if (batch.length === 0) {
      continue;
    }

    await client.query(
      `INSERT INTO atlas_land_records (${columns.join(", ")}) VALUES ${placeholders.join(", ")}`,
      values,
    );
  }
}

async function getAtlasDocumentRows(documentNumber: string): Promise<AtlasDocumentRow[]> {
  const result = await query<AtlasDocumentRow>(
    `
      SELECT
        d.document_number,
        d.doc_name,
        d.doc_type,
        d.recording_instrument,
        d.recording_date,
        d.expiration_date,
        d.deed_acres,
        d.keywords,
        d.remark,
        d.source_file,
        m.property_code,
        m.property_name,
        m.package_relative_path,
        m.file_name,
        m.extension,
        m.size_bytes
      FROM atlas_documents d
      LEFT JOIN atlas_document_manifest m
        ON m.document_number = d.document_number
      WHERE d.document_number = $1
    `,
    [documentNumber],
  );

  return result.rows;
}

export async function loadAtlasDocumentAsset(documentNumber: string): Promise<AtlasDocumentAsset | null> {
  const rows = await getAtlasDocumentRows(documentNumber);
  const row = rows[0];
  if (!row) {
    return null;
  }

  const contentPath = resolveAtlasPackagePath(row.package_relative_path);
  const fileExists = contentPath ? await pathExists(contentPath) : false;
  const previewable = fileExists && isAtlasPreviewableExtension(row.extension, row.file_name);
  const { contentUrl, downloadUrl } = makeAtlasDocumentUrls(row.document_number);

  return {
    documentNumber: row.document_number,
    docName: row.doc_name,
    docType: row.doc_type,
    recordingInstrument: row.recording_instrument,
    recordingDate: row.recording_date,
    expirationDate: row.expiration_date,
    deedAcres: row.deed_acres,
    keywords: row.keywords,
    remark: row.remark,
    sourceFile: row.source_file,
    propertyCode: row.property_code,
    propertyName: row.property_name,
    pageNo: null,
    packageRelativePath: row.package_relative_path,
    fileName: row.file_name,
    extension: row.extension,
    sizeBytes: row.size_bytes,
    hasFile: fileExists,
    isPreviewable: previewable,
    contentUrl: previewable ? contentUrl : null,
    downloadUrl,
    filePath: contentPath,
    mimeType: previewable ? mimeTypeFromExtension(row.extension, row.file_name) : null,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export function normalizeAtlasBufferFeet(value: unknown): AtlasBufferFeet | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return ATLAS_BUFFER_FEET_OPTIONS.includes(parsed as AtlasBufferFeet)
    ? (parsed as AtlasBufferFeet)
    : null;
}

export async function loadAtlasQuestionAreaView(
  questionAreaCode: string,
  bufferFeet: AtlasBufferFeet,
): Promise<AtlasQueryResult | null> {
  const selectedQuestionArea = await query<{ code: string; buffer_geometry: object }>(
    `
      WITH selected AS (
        SELECT
          code,
          ST_Buffer(geom::geography, $2::double precision)::geometry AS buffer_geometry
        FROM question_areas
        WHERE code = $1
      )
      SELECT
        code,
        ST_AsGeoJSON(buffer_geometry, 6)::jsonb AS buffer_geometry
      FROM selected
    `,
    [questionAreaCode, feetToMeters(bufferFeet)],
  );

  const areaRow = selectedQuestionArea.rows[0];
  if (!areaRow) {
    return null;
  }

  const nullGeometryCountResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM atlas_land_records WHERE geom IS NULL`,
  );
  const nullGeometryCount = Number(nullGeometryCountResult.rows[0]?.count ?? 0);

  const linkedRows = await query<AtlasQuestionAreaRow>(
    `
      WITH selected AS (
        SELECT
          code,
          ST_Buffer(geom::geography, $2::double precision)::geometry AS buffer_geometry
        FROM question_areas
        WHERE code = $1
      )
      SELECT
        lr.lr_number,
        lr.tract_key,
        lr.old_lr_number,
        lr.primary_document_number,
        lr.primary_page_no,
        lr.property_name,
        lr.fund_name,
        lr.region_name,
        lr.lr_type,
        lr.lr_status,
        lr.acq_date,
        lr.tax_parcel_number,
        lr.gis_acres,
        lr.deed_acres,
        lr.doc_description_heading,
        lr.lr_specs,
        lr.township,
        lr.range,
        lr.section,
        lr.fips,
        lr.remark,
        lr.source_file,
        ST_AsGeoJSON(lr.geom, 6)::jsonb AS geometry,
        dl.id AS link_id,
        dl.page_no,
        d.document_number,
        d.doc_name,
        d.doc_type,
        d.recording_instrument,
        d.recording_date,
        d.expiration_date,
        d.deed_acres AS document_deed_acres,
        d.keywords,
        d.remark AS document_remark,
        d.source_file AS document_source_file,
        m.property_code,
        m.property_name AS manifest_property_name,
        m.package_relative_path,
        m.file_name,
        m.extension,
        m.size_bytes
      FROM selected s
      JOIN atlas_land_records lr
        ON lr.geom IS NOT NULL
       AND ST_Intersects(lr.geom, s.buffer_geometry)
      LEFT JOIN atlas_document_links dl
        ON dl.lr_number = lr.lr_number
      LEFT JOIN atlas_documents d
        ON d.document_number = dl.document_number
      LEFT JOIN atlas_document_manifest m
        ON m.document_number = d.document_number
      ORDER BY lr.lr_number, dl.id NULLS LAST, d.document_number
    `,
    [questionAreaCode, feetToMeters(bufferFeet)],
  );

  const warnings: AtlasWarning[] = [];
  if (nullGeometryCount > 0) {
    warnings.push({
      code: "missing_geometry",
      message: `${nullGeometryCount} Atlas land records do not have geometry and were excluded from spatial matching.`,
      severity: "warning",
    });
  }

  const recordsByLrNumber = new Map<string, AtlasRecord>();
  const warningKeys = new Set<string>();

  for (const row of linkedRows.rows) {
    let record = recordsByLrNumber.get(row.lr_number);
    if (!record) {
      record = {
        lrNumber: row.lr_number,
        tractKey: row.tract_key,
        oldLrNumber: row.old_lr_number,
        primaryDocumentNumber: row.primary_document_number,
        primaryPageNo: row.primary_page_no,
        propertyName: row.property_name,
        fundName: row.fund_name,
        regionName: row.region_name,
        lrType: row.lr_type,
        lrStatus: row.lr_status,
        acqDate: row.acq_date,
        taxParcelNumber: row.tax_parcel_number,
        gisAcres: row.gis_acres,
        deedAcres: row.deed_acres,
        docDescriptionHeading: row.doc_description_heading,
        lrSpecs: row.lr_specs,
        township: row.township,
        range: row.range,
        section: row.section,
        fips: row.fips,
        remark: row.remark,
        sourceFile: row.source_file,
        geometry: row.geometry,
        documents: [],
      };
      recordsByLrNumber.set(row.lr_number, record);
    }

    if (!row.document_number) {
      continue;
    }

    const documentAsset = await buildAtlasDocumentAsset(row);
    record.documents.push(toAtlasDocument(documentAsset));

    if (!documentAsset.hasFile) {
      const warningKey = `missingFile:${row.document_number}`;
      if (!warningKeys.has(warningKey)) {
        warningKeys.add(warningKey);
        warnings.push({
          code: "missing_file",
          documentNumber: row.document_number,
          lrNumber: row.lr_number,
          message: `Atlas document ${row.document_number} is missing from package storage.`,
          severity: "warning",
        });
      }
      continue;
    }

    if (!documentAsset.isPreviewable) {
      const warningKey = `unsupportedPreview:${row.document_number}`;
      if (!warningKeys.has(warningKey)) {
        warningKeys.add(warningKey);
        warnings.push({
          code: "unsupported_preview",
          documentNumber: row.document_number,
          lrNumber: row.lr_number,
          message: `Atlas document ${row.document_number} cannot be previewed inline.`,
          severity: "warning",
        });
      }
    }
  }

  const records = Array.from(recordsByLrNumber.values());
  const linkedDocumentCount = records.reduce((total, record) => total + record.documents.length, 0);

  return {
    questionAreaCode: areaRow.code,
    bufferValue: bufferFeet,
    bufferUnit: "feet",
    bufferGeometry: areaRow.buffer_geometry,
    matchedRecordCount: records.length,
    linkedDocumentCount,
    records,
    warnings,
  };
}

type AtlasQuestionAreaRow = {
  lr_number: string;
  tract_key: string | null;
  old_lr_number: string | null;
  primary_document_number: string | null;
  primary_page_no: string | null;
  property_name: string | null;
  fund_name: string | null;
  region_name: string | null;
  lr_type: string | null;
  lr_status: string | null;
  acq_date: string | null;
  tax_parcel_number: string | null;
  gis_acres: number | null;
  deed_acres: number | null;
  doc_description_heading: string | null;
  lr_specs: string | null;
  township: string | null;
  range: string | null;
  section: string | null;
  fips: string | null;
  remark: string | null;
  source_file: string | null;
  geometry: object | null;
  link_id: number | null;
  page_no: string | null;
  document_number: string | null;
  doc_name: string | null;
  doc_type: string | null;
  recording_instrument: string | null;
  recording_date: string | null;
  expiration_date: string | null;
  document_deed_acres: number | null;
  keywords: string | null;
  document_remark: string | null;
  document_source_file: string | null;
  property_code: string | null;
  manifest_property_name: string | null;
  package_relative_path: string | null;
  file_name: string | null;
  extension: string | null;
  size_bytes: number | null;
};

async function buildAtlasDocumentAsset(row: AtlasQuestionAreaRow): Promise<AtlasDocumentAsset> {
  const filePath = resolveAtlasPackagePath(row.package_relative_path);
  const fileExists = filePath ? await pathExists(filePath) : false;
  const previewable = fileExists && isAtlasPreviewableExtension(row.extension, row.file_name);
  const { contentUrl, downloadUrl } = makeAtlasDocumentUrls(row.document_number ?? "");

  return {
    documentNumber: row.document_number ?? "",
    docName: row.doc_name,
    docType: row.doc_type,
    recordingInstrument: row.recording_instrument,
    recordingDate: row.recording_date,
    expirationDate: row.expiration_date,
    deedAcres: row.document_deed_acres,
    keywords: row.keywords,
    remark: row.document_remark,
    sourceFile: row.document_source_file,
    propertyCode: row.property_code,
    propertyName: row.manifest_property_name,
    pageNo: row.page_no,
    packageRelativePath: row.package_relative_path,
    fileName: row.file_name,
    extension: row.extension,
    sizeBytes: row.size_bytes,
    hasFile: fileExists,
    isPreviewable: previewable,
    contentUrl: previewable ? contentUrl : null,
    downloadUrl,
    filePath,
    mimeType: previewable ? mimeTypeFromExtension(row.extension, row.file_name) : null,
  };
}

function feetToMeters(bufferFeet: AtlasBufferFeet): number {
  return bufferFeet * 0.3048;
}
