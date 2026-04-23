import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { QueryResult, QueryResultRow } from "pg";
import * as XLSX from "xlsx";

import { config } from "../config.js";
import { query } from "./db.js";

export const ATLAS_BUFFER_FEET_OPTIONS = [100, 500, 1000, 5000] as const;

export type AtlasBufferFeet = (typeof ATLAS_BUFFER_FEET_OPTIONS)[number];

export type AtlasWarning = {
  code: "import_rejects" | "missing_geometry" | "missing_file" | "unsupported_preview";
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
  pageTarget: number | null;
  packageRelativePath: string | null;
  fileName: string | null;
  extension: string | null;
  sizeBytes: number | null;
  hasFile: boolean;
  isPreviewable: boolean;
  contentUrl: string | null;
  downloadUrl: string;
};

export type AtlasFeaturelessDocument = AtlasDocument;

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

export type AtlasImportRejectSummary = {
  code: string;
  count: number;
};

export type AtlasRecord = {
  lrNumber: string;
  tractKey: string | null;
  oldLrNumber: string | null;
  primaryDocumentNumber: string | null;
  parentPageNo: string | null;
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
  sourceSheet: string | null;
  geometry: object | null;
  parentDocument: AtlasDocument | null;
  childDocuments: AtlasDocument[];
};

export type AtlasQueryResult = {
  questionAreaCode: string;
  bufferValue: AtlasBufferFeet;
  bufferUnit: "feet";
  bufferGeometry: object;
  matchedRecordCount: number;
  linkedDocumentCount: number;
  featurelessDocumentCount: number;
  importRejectSummary: AtlasImportRejectSummary[];
  records: AtlasRecord[];
  featurelessDocuments: AtlasFeaturelessDocument[];
  warnings: AtlasWarning[];
};

type AtlasWorkbookRow = {
  rowNumber: number;
  values: Record<string, unknown>;
};

type AtlasImportRejectRow = {
  entityType: string;
  sourceSheet: string;
  sourceRowNumber: number | null;
  rejectReason: string;
  rawData: Record<string, unknown>;
};

type AtlasLandRecordSeedRow = {
  lr_number: string;
  tract_key: string | null;
  old_lr_number: string | null;
  primary_document_number: string;
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
  source_sheet: string | null;
  source_row_number: number;
};

type AtlasDocumentSeedRow = {
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
  source_sheet: string | null;
  source_row_number: number;
};

type AtlasDocumentLinkSeedRow = {
  lr_number: string;
  document_number: string;
  page_no: string | null;
  source_sheet: string | null;
  source_row_number: number;
};

type AtlasFeaturelessSeedRow = {
  document_number: string;
  source_sheet: string | null;
  source_row_number: number;
};

type AtlasDocumentManifestSeedRow = {
  property_code: string | null;
  property_name: string | null;
  source_folder: string | null;
  package_relative_path: string;
  file_name: string | null;
  extension: string | null;
  size_bytes: number | null;
  document_number: string | null;
  source_file_path: string | null;
};

type AtlasWorkbookImport = {
  documents: AtlasDocumentSeedRow[];
  featurelessDocs: AtlasFeaturelessSeedRow[];
  landRecords: AtlasLandRecordSeedRow[];
  links: AtlasDocumentLinkSeedRow[];
  manifestRows: AtlasDocumentManifestSeedRow[];
  rejects: AtlasImportRejectRow[];
};

const ATLAS_CORE_SEED_TABLES = [
  "atlas_land_records",
  "atlas_documents",
  "atlas_document_manifest",
] as const;

const ATLAS_SEED_METADATA_KEY = "atlas_workbook_sha256";
const ATLAS_WORKBOOK_SHEETS = {
  landRecords: "LR Info Template",
  documents: "LR Documents Template",
  documentLinks: "Document Link Template",
  featurelessDocs: "Featureless Docs",
} as const;

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

function workbookPath() {
  return path.resolve(config.atlasWorkbookPath);
}

function docsRootPath() {
  return path.resolve(config.atlasDocumentRoot);
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const normalized = String(value).replace(/\r/g, "").replace(/\n/g, " ").trim();
  return normalized ? normalized : null;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const text = nullableText(value);
  if (!text) {
    return null;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = nullableText(value);
  if (!text) {
    return null;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
}

function normalizeExtension(extension: string | null, fileName?: string | null): string | null {
  const source = nullableText(extension) ?? nullableText(fileName ? path.extname(fileName) : null);
  if (!source) {
    return null;
  }

  const normalized = source.toLowerCase();
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}

function isPreviewableExtension(extension: string | null, fileName?: string | null): boolean {
  const normalized = normalizeExtension(extension, fileName);
  return normalized ? ATLAS_PREVIEWABLE_EXTENSIONS.has(normalized) : false;
}

function mimeTypeFromExtension(extension: string | null, fileName?: string | null): string | null {
  const normalized = normalizeExtension(extension, fileName);
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

function parsePageTarget(pageNo: string | null): number | null {
  if (!pageNo) {
    return null;
  }

  const parsed = Number(pageNo);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function makeDocumentUrls(documentNumber: string): Pick<AtlasDocumentAsset, "contentUrl" | "downloadUrl"> {
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
    pageTarget: asset.pageTarget,
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

function readWorkbookSheetRows(workbook: XLSX.WorkBook, sheetName: string): AtlasWorkbookRow[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet["!ref"]) {
    return [];
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    blankrows: false,
    defval: null,
    header: 1,
    raw: false,
  });

  const [headerRow, ...rows] = matrix;
  if (!headerRow) {
    return [];
  }

  const headers = headerRow.map((cell) => nullableText(cell) ?? "");
  const normalizedRows: AtlasWorkbookRow[] = [];

  rows.forEach((cells, index) => {
    const values: Record<string, unknown> = {};
    let hasValue = false;
    headers.forEach((header, cellIndex) => {
      if (!header) {
        return;
      }

      const value = cells[cellIndex] ?? null;
      if (value !== null && value !== "") {
        hasValue = true;
      }
      values[header] = value;
    });

    if (hasValue) {
      normalizedRows.push({ rowNumber: index + 2, values });
    }
  });

  return normalizedRows;
}

async function loadWorkbook(): Promise<XLSX.WorkBook> {
  const sourcePath = workbookPath();
  try {
    await fs.access(sourcePath);
  } catch {
    throw new Error(`Atlas workbook not found: ${sourcePath}`);
  }

  const buffer = await fs.readFile(sourcePath);
  return XLSX.read(buffer, {
    cellDates: true,
    dense: false,
    type: "buffer",
  });
}

async function currentAtlasHash(): Promise<string> {
  const hash = crypto.createHash("sha256");
  const sourcePath = workbookPath();
  hash.update(path.basename(sourcePath));
  hash.update(await fs.readFile(sourcePath));

  const documentRoot = docsRootPath();
  if (await directoryExists(documentRoot)) {
    const files = await listFilesRecursive(documentRoot);
    for (const filePath of files) {
      const stat = await fs.stat(filePath);
      hash.update(path.relative(documentRoot, filePath));
      hash.update(String(stat.size));
      hash.update(String(stat.mtimeMs));
    }
  }

  return hash.digest("hex");
}

export function resolveAtlasPackagePath(packageRelativePath: string | null): string | null {
  if (!packageRelativePath) {
    return null;
  }

  const root = docsRootPath();
  const candidate = path.resolve(root, packageRelativePath);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return candidate;
}

export async function ensureAtlasSeedData(client: {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}): Promise<void> {
  const counts = await getAtlasTableCounts(client);
  const allPopulated = ATLAS_CORE_SEED_TABLES.every((table) => (counts[table] ?? 0) > 0);
  const somePopulated = ATLAS_CORE_SEED_TABLES.some((table) => (counts[table] ?? 0) > 0);
  const atlasHash = await currentAtlasHash();

  if (allPopulated) {
    const storedHash = await getAtlasSeedHash(client);
    if (!storedHash) {
      throw new Error(buildAtlasMismatchMessage("Atlas seed metadata is missing for an already-populated database."));
    }
    if (storedHash !== atlasHash) {
      throw new Error(buildAtlasMismatchMessage("Atlas workbook or document folder hash changed."));
    }
    return;
  }

  if (somePopulated) {
    throw new Error(buildAtlasMismatchMessage("Atlas seed tables are partially populated."));
  }

  await importAtlasSeedData(client);
  await storeAtlasSeedHash(client, atlasHash);
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
  atlasHash: string,
): Promise<void> {
  await client.query(
    `
      INSERT INTO seed_metadata (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [ATLAS_SEED_METADATA_KEY, atlasHash],
  );
}

function buildAtlasMismatchMessage(reason: string): string {
  return [
    reason,
    "The Atlas workbook/doc sources no longer match the populated PostGIS seed metadata.",
    "For local development, reset and reseed the database explicitly, for example: docker compose down -v && docker compose up --build.",
  ].join(" ");
}

async function importAtlasSeedData(client: {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}): Promise<void> {
  const workbookImport = await loadAtlasWorkbookImport();

  await bulkInsertAtlasLandRecords(client, workbookImport.landRecords);
  await hydrateAtlasGeometryFromLandRecords(client);

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
      "source_workbook_path",
      "source_sheet",
      "source_row_number",
    ],
    workbookImport.documents,
    (row) => [
      row.document_number,
      row.doc_name,
      row.doc_type,
      row.recording_instrument,
      row.recording_date,
      row.expiration_date,
      row.deed_acres,
      row.keywords,
      row.remark,
      row.source_file,
      workbookPath(),
      row.source_sheet,
      row.source_row_number,
    ],
  );

  await bulkInsert(
    client,
    "atlas_document_links",
    ["lr_number", "document_number", "page_no", "source_workbook_path", "source_sheet", "source_row_number"],
    workbookImport.links,
    (row) => [
      row.lr_number,
      row.document_number,
      row.page_no,
      workbookPath(),
      row.source_sheet,
      row.source_row_number,
    ],
  );

  await bulkInsert(
    client,
    "atlas_featureless_docs",
    ["document_number", "source_workbook_path", "source_sheet", "source_row_number"],
    workbookImport.featurelessDocs,
    (row) => [row.document_number, workbookPath(), row.source_sheet, row.source_row_number],
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
      "source_workbook_path",
      "source_docs_root_path",
      "source_file_path",
    ],
    workbookImport.manifestRows,
    (row) => [
      row.property_code,
      row.property_name,
      row.source_folder,
      row.package_relative_path,
      row.file_name,
      row.extension,
      row.size_bytes,
      row.document_number,
      workbookPath(),
      docsRootPath(),
      row.source_file_path,
    ],
  );

  await bulkInsert(
    client,
    "atlas_import_rejects",
    [
      "entity_type",
      "source_workbook_path",
      "source_docs_root_path",
      "source_sheet",
      "source_row_number",
      "reject_reason",
      "raw_data",
    ],
    workbookImport.rejects,
    (row) => [
      row.entityType,
      workbookPath(),
      docsRootPath(),
      row.sourceSheet,
      row.sourceRowNumber,
      row.rejectReason,
      JSON.stringify(row.rawData),
    ],
  );
}

async function loadAtlasWorkbookImport(): Promise<AtlasWorkbookImport> {
  const workbook = await loadWorkbook();
  const sourceFile = path.basename(workbookPath());
  const documents: AtlasDocumentSeedRow[] = [];
  const landRecords: AtlasLandRecordSeedRow[] = [];
  const links: AtlasDocumentLinkSeedRow[] = [];
  const featurelessDocs: AtlasFeaturelessSeedRow[] = [];
  const rejects: AtlasImportRejectRow[] = [];
  const documentNumbers = new Set<string>();
  const landRecordNumbers = new Set<string>();

  for (const row of readWorkbookSheetRows(workbook, ATLAS_WORKBOOK_SHEETS.documents)) {
    const documentNumber = nullableText(row.values.DocumentNumber);
    if (!documentNumber) {
      rejects.push(makeReject(row, ATLAS_WORKBOOK_SHEETS.documents, "document", "Missing DocumentNumber."));
      continue;
    }

    if (documentNumbers.has(documentNumber)) {
      rejects.push(makeReject(row, ATLAS_WORKBOOK_SHEETS.documents, "document", `Duplicate DocumentNumber ${documentNumber}.`));
      continue;
    }

    documentNumbers.add(documentNumber);
    documents.push({
      document_number: documentNumber,
      doc_name: nullableText(row.values.DocName),
      doc_type: nullableText(row.values.DocType),
      recording_instrument: nullableText(row.values["Recording Instrument"]),
      recording_date: nullableDate(row.values.RecordingDate),
      expiration_date: nullableDate(row.values.ExpirationDate),
      deed_acres: nullableNumber(row.values.DeedAcres),
      keywords: nullableText(row.values.Keywords),
      remark: nullableText(row.values.Remark),
      source_file: sourceFile,
      source_sheet: ATLAS_WORKBOOK_SHEETS.documents,
      source_row_number: row.rowNumber,
    });
  }

  for (const row of readWorkbookSheetRows(workbook, ATLAS_WORKBOOK_SHEETS.landRecords)) {
    const lrNumber = nullableText(row.values.LR_Number);
    if (!lrNumber) {
      rejects.push(makeReject(row, ATLAS_WORKBOOK_SHEETS.landRecords, "land_record", "Missing LR_Number."));
      continue;
    }

    if (landRecordNumbers.has(lrNumber)) {
      rejects.push(makeReject(row, ATLAS_WORKBOOK_SHEETS.landRecords, "land_record", `Duplicate LR_Number ${lrNumber}.`));
      continue;
    }

    const parentDocumentNumber = nullableText(row.values.DocumentNumber);
    if (!parentDocumentNumber || !documentNumbers.has(parentDocumentNumber)) {
      rejects.push(
        makeReject(
          row,
          ATLAS_WORKBOOK_SHEETS.landRecords,
          "land_record",
          `Parent DocumentNumber ${parentDocumentNumber ?? "(blank)"} does not resolve to LR Documents Template.DocumentNumber.`,
        ),
      );
      continue;
    }

    landRecordNumbers.add(lrNumber);
    landRecords.push({
      lr_number: lrNumber,
      tract_key: nullableText(row.values.TractKey),
      old_lr_number: nullableText(row.values["Old LR_Number"]),
      primary_document_number: parentDocumentNumber,
      primary_page_no: nullableText(row.values.PageNo),
      property_name: null,
      fund_name: null,
      region_name: null,
      lr_type: nullableText(row.values.LR_Type),
      lr_status: nullableText(row.values.LR_Status),
      acq_date: nullableDate(row.values.Acq_Date),
      tax_parcel_number: nullableText(row.values.Tax_Parcel_Number),
      gis_acres: nullableNumber(row.values.GISAcres),
      deed_acres: nullableNumber(row.values.DeedAcres),
      doc_description_heading: nullableText(row.values.DocDescriptionHeading),
      lr_specs: nullableText(row.values.LRSpecs),
      township: nullableText(row.values.Township),
      range: nullableText(row.values.Range),
      section: nullableText(row.values.Section),
      fips: nullableText(row.values.FIPS),
      remark: nullableText(row.values.Remark),
      source_file: sourceFile,
      source_sheet: ATLAS_WORKBOOK_SHEETS.landRecords,
      source_row_number: row.rowNumber,
    });
  }

  for (const row of readWorkbookSheetRows(workbook, ATLAS_WORKBOOK_SHEETS.documentLinks)) {
    const lrNumber = nullableText(row.values.LRNumber);
    const documentNumber = nullableText(row.values.DocNo);

    if (!lrNumber || !documentNumber) {
      rejects.push(makeReject(row, ATLAS_WORKBOOK_SHEETS.documentLinks, "child_link", "Missing LRNumber or DocNo."));
      continue;
    }

    if (!landRecordNumbers.has(lrNumber)) {
      rejects.push(
        makeReject(
          row,
          ATLAS_WORKBOOK_SHEETS.documentLinks,
          "child_link",
          `LRNumber ${lrNumber} does not resolve to LR Info Template.LR_Number.`,
        ),
      );
      continue;
    }

    if (!documentNumbers.has(documentNumber)) {
      rejects.push(
        makeReject(
          row,
          ATLAS_WORKBOOK_SHEETS.documentLinks,
          "child_link",
          `DocNo ${documentNumber} does not resolve to LR Documents Template.DocumentNumber.`,
        ),
      );
      continue;
    }

    links.push({
      lr_number: lrNumber,
      document_number: documentNumber,
      page_no: nullableText(row.values.PageNo),
      source_sheet: ATLAS_WORKBOOK_SHEETS.documentLinks,
      source_row_number: row.rowNumber,
    });
  }

  for (const row of readWorkbookSheetRows(workbook, ATLAS_WORKBOOK_SHEETS.featurelessDocs)) {
    const featurelessKey = Object.keys(row.values).find((key) => key.toLowerCase().includes("featureless"));
    const documentNumber = nullableText(featurelessKey ? row.values[featurelessKey] : row.values.DocumentNumber);
    if (!documentNumber) {
      continue;
    }

    if (!documentNumbers.has(documentNumber)) {
      rejects.push(
        makeReject(
          row,
          ATLAS_WORKBOOK_SHEETS.featurelessDocs,
          "featureless_document",
          `Featureless document ${documentNumber} does not resolve to LR Documents Template.DocumentNumber.`,
        ),
      );
      continue;
    }

    featurelessDocs.push({
      document_number: documentNumber,
      source_sheet: ATLAS_WORKBOOK_SHEETS.featurelessDocs,
      source_row_number: row.rowNumber,
    });
  }

  const manifestRows = await buildDocumentManifest(documents);
  return { documents, featurelessDocs, landRecords, links, manifestRows, rejects };
}

function makeReject(
  row: AtlasWorkbookRow,
  sourceSheet: string,
  entityType: string,
  rejectReason: string,
): AtlasImportRejectRow {
  return {
    entityType,
    sourceSheet,
    sourceRowNumber: row.rowNumber,
    rejectReason,
    rawData: row.values,
  };
}

async function buildDocumentManifest(documents: AtlasDocumentSeedRow[]): Promise<AtlasDocumentManifestSeedRow[]> {
  const documentRoot = docsRootPath();
  const documentFilesByName = await loadDocumentFilesByName(documentRoot);

  return documents.map((document) => {
    const fileName = document.doc_name;
    const fileMatch = fileName ? documentFilesByName.get(fileName) ?? null : null;
    const filePath = fileMatch?.filePath ?? null;
    const packageRelativePath = filePath
      ? path.relative(documentRoot, filePath).replace(/[\\/]+/g, "/")
      : fileName ?? document.document_number;

    return {
      property_code: inferPropertyCode(document.document_number),
      property_name: null,
      source_folder: (documentFilesByName.size > 0) ? documentRoot : null,
      package_relative_path: packageRelativePath,
      file_name: fileName,
      extension: normalizeExtension(null, fileName),
      size_bytes: fileMatch?.sizeBytes ?? null,
      document_number: document.document_number,
      source_file_path: filePath,
    };
  });
}

async function loadDocumentFilesByName(root: string): Promise<Map<string, { filePath: string; sizeBytes: number }>> {
  const filesByName = new Map<string, { filePath: string; sizeBytes: number }>();
  if (!await directoryExists(root)) {
    return filesByName;
  }

  const files = await listFilesRecursive(root);
  for (const filePath of files) {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      continue;
    }
    filesByName.set(path.basename(filePath), { filePath, sizeBytes: stat.size });
  }
  return filesByName;
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function directoryExists(root: string): Promise<boolean> {
  try {
    const stat = await fs.stat(root);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function inferPropertyCode(documentNumber: string): string | null {
  const [prefix] = documentNumber.split("-", 1);
  return prefix || null;
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
    if (batch.length === 0) {
      continue;
    }

    const values: unknown[] = [];
    const placeholders = batch.map((row) => {
      const currentValues = rowValues(row);
      const rowStart = values.length;
      values.push(...currentValues);
      return `(${currentValues.map((_value, index) => `$${rowStart + index + 1}`).join(", ")})`;
    });

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
  rows: AtlasLandRecordSeedRow[],
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
    "source_workbook_path",
    "source_sheet",
    "source_row_number",
  ];

  await bulkInsert(client, "atlas_land_records", columns, rows, (row) => [
    row.lr_number,
    row.tract_key,
    row.old_lr_number,
    row.primary_document_number,
    row.primary_page_no,
    row.property_name,
    row.fund_name,
    row.region_name,
    row.lr_type,
    row.lr_status,
    row.acq_date,
    row.tax_parcel_number,
    row.gis_acres,
    row.deed_acres,
    row.doc_description_heading,
    row.lr_specs,
    row.township,
    row.range,
    row.section,
    row.fips,
    row.remark,
    row.source_file,
    workbookPath(),
    row.source_sheet,
    row.source_row_number,
  ], batchSize);
}

async function hydrateAtlasGeometryFromLandRecords(client: {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}): Promise<void> {
  await client.query(`
    UPDATE atlas_land_records atlas
    SET
      geom = lr.geom,
      property_name = COALESCE(atlas.property_name, lr.property_name),
      fund_name = COALESCE(atlas.fund_name, lr.fund_name),
      region_name = COALESCE(atlas.region_name, lr.region_name)
    FROM land_records lr
    WHERE lr.record_number = atlas.lr_number
  `);
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
  source_file_path: string | null;
};

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
        m.size_bytes,
        m.source_file_path
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

  return buildAtlasDocumentAsset({
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
    sourceFilePath: row.source_file_path,
  });
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

  const [nullGeometryCountResult, rejectSummaryResult, featurelessRows, linkedRows] = await Promise.all([
    query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM atlas_land_records WHERE geom IS NULL`),
    query<{ entity_type: string; count: string }>(
      `
        SELECT entity_type, COUNT(*)::text AS count
        FROM atlas_import_rejects
        GROUP BY entity_type
        ORDER BY entity_type
      `,
    ),
    query<AtlasFeaturelessRow>(
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
          m.size_bytes,
          m.source_file_path
        FROM atlas_featureless_docs fd
        JOIN atlas_documents d
          ON d.document_number = fd.document_number
        LEFT JOIN atlas_document_manifest m
          ON m.document_number = d.document_number
        ORDER BY d.document_number
      `,
    ),
    query<AtlasQuestionAreaRow>(
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
          lr.source_sheet,
          ST_AsGeoJSON(lr.geom, 6)::jsonb AS geometry,
          pd.document_number AS parent_document_number,
          pd.doc_name AS parent_doc_name,
          pd.doc_type AS parent_doc_type,
          pd.recording_instrument AS parent_recording_instrument,
          pd.recording_date AS parent_recording_date,
          pd.expiration_date AS parent_expiration_date,
          pd.deed_acres AS parent_deed_acres,
          pd.keywords AS parent_keywords,
          pd.remark AS parent_remark,
          pd.source_file AS parent_source_file,
          pm.property_code AS parent_property_code,
          pm.property_name AS parent_manifest_property_name,
          pm.package_relative_path AS parent_package_relative_path,
          pm.file_name AS parent_file_name,
          pm.extension AS parent_extension,
          pm.size_bytes AS parent_size_bytes,
          pm.source_file_path AS parent_source_file_path,
          dl.id AS child_link_id,
          dl.page_no AS child_page_no,
          cd.document_number AS child_document_number,
          cd.doc_name AS child_doc_name,
          cd.doc_type AS child_doc_type,
          cd.recording_instrument AS child_recording_instrument,
          cd.recording_date AS child_recording_date,
          cd.expiration_date AS child_expiration_date,
          cd.deed_acres AS child_deed_acres,
          cd.keywords AS child_keywords,
          cd.remark AS child_remark,
          cd.source_file AS child_source_file,
          cm.property_code AS child_property_code,
          cm.property_name AS child_manifest_property_name,
          cm.package_relative_path AS child_package_relative_path,
          cm.file_name AS child_file_name,
          cm.extension AS child_extension,
          cm.size_bytes AS child_size_bytes,
          cm.source_file_path AS child_source_file_path
        FROM selected s
        JOIN atlas_land_records lr
          ON lr.geom IS NOT NULL
         AND ST_Intersects(lr.geom, s.buffer_geometry)
        LEFT JOIN atlas_documents pd
          ON pd.document_number = lr.primary_document_number
        LEFT JOIN atlas_document_manifest pm
          ON pm.document_number = pd.document_number
        LEFT JOIN atlas_document_links dl
          ON dl.lr_number = lr.lr_number
        LEFT JOIN atlas_documents cd
          ON cd.document_number = dl.document_number
        LEFT JOIN atlas_document_manifest cm
          ON cm.document_number = cd.document_number
        ORDER BY lr.lr_number, dl.id NULLS LAST, cd.document_number
      `,
      [questionAreaCode, feetToMeters(bufferFeet)],
    ),
  ]);

  const importRejectSummary = rejectSummaryResult.rows.map((row) => ({
    code: row.entity_type,
    count: Number(row.count),
  }));
  const warnings = buildAtlasWarnings(Number(nullGeometryCountResult.rows[0]?.count ?? 0), importRejectSummary);
  const records = await buildAtlasRecords(linkedRows.rows, warnings);
  const featurelessDocuments = await buildFeaturelessDocuments(featurelessRows.rows);
  const linkedDocumentCount = records.reduce(
    (total, record) => total + (record.parentDocument ? 1 : 0) + record.childDocuments.length,
    0,
  );

  return {
    questionAreaCode: areaRow.code,
    bufferValue: bufferFeet,
    bufferUnit: "feet",
    bufferGeometry: areaRow.buffer_geometry,
    matchedRecordCount: records.length,
    linkedDocumentCount,
    featurelessDocumentCount: featurelessDocuments.length,
    importRejectSummary,
    records,
    featurelessDocuments,
    warnings,
  };
}

function buildAtlasWarnings(
  nullGeometryCount: number,
  importRejectSummary: AtlasImportRejectSummary[],
): AtlasWarning[] {
  const warnings: AtlasWarning[] = [];
  if (nullGeometryCount > 0) {
    warnings.push({
      code: "missing_geometry",
      message: `${nullGeometryCount} Atlas land records do not have geometry in the PostGIS land_records layer and were excluded from spatial matching.`,
      severity: "warning",
    });
  }

  const rejectCount = importRejectSummary.reduce((total, row) => total + row.count, 0);
  if (rejectCount > 0) {
    warnings.push({
      code: "import_rejects",
      message: `${rejectCount} Atlas workbook rows were excluded by strict import validation.`,
      severity: "warning",
    });
  }
  return warnings;
}

async function buildAtlasRecords(rows: AtlasQuestionAreaRow[], warnings: AtlasWarning[]): Promise<AtlasRecord[]> {
  const recordsByLrNumber = new Map<string, AtlasRecord>();
  const warningKeys = new Set<string>();

  for (const row of rows) {
    let record = recordsByLrNumber.get(row.lr_number);
    if (!record) {
      const parentDocument = row.parent_document_number
        ? toAtlasDocument(await buildAtlasDocumentAsset({
            documentNumber: row.parent_document_number,
            docName: row.parent_doc_name,
            docType: row.parent_doc_type,
            recordingInstrument: row.parent_recording_instrument,
            recordingDate: row.parent_recording_date,
            expirationDate: row.parent_expiration_date,
            deedAcres: row.parent_deed_acres,
            keywords: row.parent_keywords,
            remark: row.parent_remark,
            sourceFile: row.parent_source_file,
            propertyCode: row.parent_property_code,
            propertyName: row.parent_manifest_property_name,
            pageNo: row.primary_page_no,
            packageRelativePath: row.parent_package_relative_path,
            fileName: row.parent_file_name,
            extension: row.parent_extension,
            sizeBytes: row.parent_size_bytes,
            sourceFilePath: row.parent_source_file_path,
          }))
        : null;

      record = {
        lrNumber: row.lr_number,
        tractKey: row.tract_key,
        oldLrNumber: row.old_lr_number,
        primaryDocumentNumber: row.primary_document_number,
        parentPageNo: row.primary_page_no,
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
        sourceSheet: row.source_sheet,
        geometry: row.geometry,
        parentDocument,
        childDocuments: [],
      };
      recordsByLrNumber.set(row.lr_number, record);

      if (parentDocument) {
        pushDocumentWarnings(parentDocument, row.lr_number, warningKeys, warnings);
      }
    }

    if (!row.child_document_number) {
      continue;
    }

    const childDocument = toAtlasDocument(await buildAtlasDocumentAsset({
      documentNumber: row.child_document_number,
      docName: row.child_doc_name,
      docType: row.child_doc_type,
      recordingInstrument: row.child_recording_instrument,
      recordingDate: row.child_recording_date,
      expirationDate: row.child_expiration_date,
      deedAcres: row.child_deed_acres,
      keywords: row.child_keywords,
      remark: row.child_remark,
      sourceFile: row.child_source_file,
      propertyCode: row.child_property_code,
      propertyName: row.child_manifest_property_name,
      pageNo: row.child_page_no,
      packageRelativePath: row.child_package_relative_path,
      fileName: row.child_file_name,
      extension: row.child_extension,
      sizeBytes: row.child_size_bytes,
      sourceFilePath: row.child_source_file_path,
    }));

    record.childDocuments.push(childDocument);
    pushDocumentWarnings(childDocument, row.lr_number, warningKeys, warnings);
  }

  return Array.from(recordsByLrNumber.values());
}

async function buildFeaturelessDocuments(rows: AtlasFeaturelessRow[]): Promise<AtlasFeaturelessDocument[]> {
  const documents: AtlasFeaturelessDocument[] = [];
  for (const row of rows) {
    documents.push(toAtlasDocument(await buildAtlasDocumentAsset({
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
      sourceFilePath: row.source_file_path,
    })));
  }
  return documents;
}

function pushDocumentWarnings(
  document: AtlasDocument,
  lrNumber: string,
  warningKeys: Set<string>,
  warnings: AtlasWarning[],
) {
  if (!document.hasFile) {
    const warningKey = `missingFile:${document.documentNumber}`;
    if (!warningKeys.has(warningKey)) {
      warningKeys.add(warningKey);
      warnings.push({
        code: "missing_file",
        documentNumber: document.documentNumber,
        lrNumber,
        message: `Atlas document ${document.documentNumber} is missing from the configured document folder.`,
        severity: "warning",
      });
    }
    return;
  }

  if (!document.isPreviewable) {
    const warningKey = `unsupportedPreview:${document.documentNumber}`;
    if (!warningKeys.has(warningKey)) {
      warningKeys.add(warningKey);
      warnings.push({
        code: "unsupported_preview",
        documentNumber: document.documentNumber,
        lrNumber,
        message: `Atlas document ${document.documentNumber} cannot be previewed inline.`,
        severity: "warning",
      });
    }
  }
}

export async function loadAtlasFeaturelessDocuments(): Promise<AtlasFeaturelessDocument[]> {
  const result = await query<AtlasFeaturelessRow>(
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
        m.size_bytes,
        m.source_file_path
      FROM atlas_featureless_docs fd
      JOIN atlas_documents d
        ON d.document_number = fd.document_number
      LEFT JOIN atlas_document_manifest m
        ON m.document_number = d.document_number
      ORDER BY d.document_number
    `,
  );

  return buildFeaturelessDocuments(result.rows);
}

export async function loadAtlasImportReport(limit: number): Promise<{
  summary: AtlasImportRejectSummary[];
  rejects: Array<{
    id: number;
    entityType: string;
    sourceSheet: string | null;
    sourceRowNumber: number | null;
    rejectReason: string;
    rawData: unknown;
  }>;
}> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 1000);
  const [summary, rejects] = await Promise.all([
    query<{ entity_type: string; count: string }>(
      `
        SELECT entity_type, COUNT(*)::text AS count
        FROM atlas_import_rejects
        GROUP BY entity_type
        ORDER BY entity_type
      `,
    ),
    query<{
      id: number;
      entity_type: string;
      source_sheet: string | null;
      source_row_number: number | null;
      reject_reason: string;
      raw_data: unknown;
    }>(
      `
        SELECT id, entity_type, source_sheet, source_row_number, reject_reason, raw_data
        FROM atlas_import_rejects
        ORDER BY id
        LIMIT ${safeLimit}
      `,
    ),
  ]);

  return {
    summary: summary.rows.map((row) => ({ code: row.entity_type, count: Number(row.count) })),
    rejects: rejects.rows.map((row) => ({
      id: row.id,
      entityType: row.entity_type,
      sourceSheet: row.source_sheet,
      sourceRowNumber: row.source_row_number,
      rejectReason: row.reject_reason,
      rawData: row.raw_data,
    })),
  };
}

type AtlasFeaturelessRow = {
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
  source_file_path: string | null;
};

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
  source_sheet: string | null;
  geometry: object | null;
  parent_document_number: string | null;
  parent_doc_name: string | null;
  parent_doc_type: string | null;
  parent_recording_instrument: string | null;
  parent_recording_date: string | null;
  parent_expiration_date: string | null;
  parent_deed_acres: number | null;
  parent_keywords: string | null;
  parent_remark: string | null;
  parent_source_file: string | null;
  parent_property_code: string | null;
  parent_manifest_property_name: string | null;
  parent_package_relative_path: string | null;
  parent_file_name: string | null;
  parent_extension: string | null;
  parent_size_bytes: number | null;
  parent_source_file_path: string | null;
  child_link_id: number | null;
  child_page_no: string | null;
  child_document_number: string | null;
  child_doc_name: string | null;
  child_doc_type: string | null;
  child_recording_instrument: string | null;
  child_recording_date: string | null;
  child_expiration_date: string | null;
  child_deed_acres: number | null;
  child_keywords: string | null;
  child_remark: string | null;
  child_source_file: string | null;
  child_property_code: string | null;
  child_manifest_property_name: string | null;
  child_package_relative_path: string | null;
  child_file_name: string | null;
  child_extension: string | null;
  child_size_bytes: number | null;
  child_source_file_path: string | null;
};

async function buildAtlasDocumentAsset(row: {
  documentNumber: string;
  docName: string | null;
  docType: string | null;
  recordingInstrument: string | null;
  recordingDate: string | null;
  expirationDate: string | null;
  deedAcres: number | null;
  keywords: string | null;
  remark: string | null;
  sourceFile: string | null;
  propertyCode: string | null;
  propertyName: string | null;
  pageNo: string | null;
  packageRelativePath: string | null;
  fileName: string | null;
  extension: string | null;
  sizeBytes: number | null;
  sourceFilePath: string | null;
}): Promise<AtlasDocumentAsset> {
  const filePath = resolveSafeSourceFilePath(row.sourceFilePath);
  const hasFile = filePath ? await fileExists(filePath) : false;
  const isPreviewable = hasFile && isPreviewableExtension(row.extension, row.fileName);
  const { contentUrl, downloadUrl } = makeDocumentUrls(row.documentNumber);

  return {
    documentNumber: row.documentNumber,
    docName: row.docName,
    docType: row.docType,
    recordingInstrument: row.recordingInstrument,
    recordingDate: row.recordingDate,
    expirationDate: row.expirationDate,
    deedAcres: row.deedAcres,
    keywords: row.keywords,
    remark: row.remark,
    sourceFile: row.sourceFile,
    propertyCode: row.propertyCode,
    propertyName: row.propertyName,
    pageNo: row.pageNo,
    pageTarget: parsePageTarget(row.pageNo),
    packageRelativePath: row.packageRelativePath,
    fileName: row.fileName,
    extension: row.extension,
    sizeBytes: row.sizeBytes,
    hasFile,
    isPreviewable,
    contentUrl: isPreviewable ? contentUrl : null,
    downloadUrl,
    filePath,
    mimeType: isPreviewable ? mimeTypeFromExtension(row.extension, row.fileName) : null,
  };
}

function resolveSafeSourceFilePath(sourceFilePath: string | null): string | null {
  if (!sourceFilePath) {
    return null;
  }

  const root = docsRootPath();
  const candidate = path.resolve(sourceFilePath);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return candidate;
}

function feetToMeters(bufferFeet: AtlasBufferFeet): number {
  return bufferFeet * 0.3048;
}
