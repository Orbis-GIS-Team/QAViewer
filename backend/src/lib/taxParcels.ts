import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import type { QueryResult, QueryResultRow } from "pg";
import * as shapefile from "shapefile";

import { config } from "../config.js";
import { query } from "./db.js";

export const TAX_PARCEL_BUFFER_FEET_OPTIONS = [100, 500, 1000, 5000] as const;

export type TaxParcelBufferFeet = (typeof TAX_PARCEL_BUFFER_FEET_OPTIONS)[number];

export type TaxParcelWarning = {
  code: "missing_file" | "unsupported_preview";
  message: string;
  severity: "warning";
  billId?: string | null;
  parcelId?: string | null;
};

export type TaxBill = {
  billId: string;
  parcelId: string;
  year: number;
  filename: string;
  extension: string | null;
  sizeBytes: number | null;
  hasFile: boolean;
  isPreviewable: boolean;
  contentUrl: string | null;
  downloadUrl: string;
};

type TaxBillAsset = TaxBill & {
  filePath: string | null;
  mimeType: string | null;
};

export type TaxParcel = {
  parcelId: string | null;
  parcelCode: string | null;
  accountNumber: string | null;
  ownerName: string | null;
  propertyName: string | null;
  parcelStatus: string | null;
  taxProgram: string | null;
  ownershipType: string | null;
  county: string | null;
  state: string | null;
  gisAcres: number | null;
  description: string | null;
  landUseType: string | null;
  tractName: string | null;
  notes: string | null;
  overlapAreaSqMeters: number | null;
  pointDistanceMeters: number | null;
  primaryRank: number;
  isPrimaryMatch: boolean;
  geometry: object | null;
  bills: TaxBill[];
};

export type TaxParcelQueryResult = {
  questionAreaCode: string;
  bufferValue: TaxParcelBufferFeet;
  bufferUnit: "feet";
  bufferGeometry: object;
  matchedParcelCount: number;
  matchedBillCount: number;
  parcels: TaxParcel[];
  warnings: TaxParcelWarning[];
};

type TaxParcelSeedRow = {
  parcel_id: string | null;
  parcel_code: string | null;
  account_number: string | null;
  owner_name: string | null;
  property_name: string | null;
  parcel_status: string | null;
  tax_program: string | null;
  ownership_type: string | null;
  county: string | null;
  state: string | null;
  gis_acres: number | null;
  description: string | null;
  land_use_type: string | null;
  tract_name: string | null;
  notes: string | null;
  raw_properties: Record<string, unknown>;
  geometry: Geometry;
};

type TaxBillManifestSeedRow = {
  bill_id: string;
  parcel_id: string;
  bill_year: number;
  file_name: string;
  extension: string | null;
  size_bytes: number | null;
  bill_relative_path: string;
  source_root_path: string;
  source_file_path: string;
};

type TaxBillRow = {
  bill_id: string;
  parcel_id: string;
  bill_year: number;
  file_name: string;
  extension: string | null;
  size_bytes: string | number | null;
  bill_relative_path: string;
};

type TaxParcelQueryRow = {
  parcel_key: string;
  parcel_id: string | null;
  parcel_code: string | null;
  account_number: string | null;
  owner_name: string | null;
  property_name: string | null;
  parcel_status: string | null;
  tax_program: string | null;
  ownership_type: string | null;
  county: string | null;
  state: string | null;
  gis_acres: number | null;
  description: string | null;
  land_use_type: string | null;
  tract_name: string | null;
  notes: string | null;
  overlap_area_sq_meters: number | null;
  point_distance_meters: number | null;
  primary_rank: number;
  geometry: object | null;
};

const TAX_PARCEL_CORE_SEED_TABLES = ["tax_parcels", "tax_bill_manifest"] as const;
const TAX_PARCEL_SEED_METADATA_KEY = "tax_parcel_source_sha256";
const TAX_BILL_PREVIEWABLE_EXTENSIONS = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".tif",
  ".tiff",
]);

function parcelSourcePath() {
  return path.resolve(config.taxParcelSourcePath);
}

function billRootPath() {
  return path.resolve(config.taxBillRoot);
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
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

function normalizeParcelId(value: unknown): string | null {
  const numeric = nullableNumber(value);
  if (numeric !== null) {
    return Number.isInteger(numeric) ? String(numeric) : String(numeric).replace(/\.0+$/, "");
  }

  const text = nullableText(value);
  return text ? text.replace(/\.0+$/, "") : null;
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
  return normalized ? TAX_BILL_PREVIEWABLE_EXTENSIONS.has(normalized) : false;
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(directoryPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function listFilesRecursive(rootPath: string): Promise<string[]> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(entryPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function readDbfEncoding(): Promise<string | undefined> {
  const parsed = path.parse(parcelSourcePath());
  const cpgPath = path.join(parsed.dir, `${parsed.name}.cpg`);
  if (!await fileExists(cpgPath)) {
    return undefined;
  }

  const encoding = (await fs.readFile(cpgPath, "utf-8")).trim();
  return encoding ? encoding.toLowerCase() : undefined;
}

async function getTaxParcelSourceFiles(sourcePath: string): Promise<string[]> {
  const parsed = path.parse(sourcePath);
  const candidates = [
    sourcePath,
    path.join(parsed.dir, `${parsed.name}.dbf`),
    path.join(parsed.dir, `${parsed.name}.shx`),
    path.join(parsed.dir, `${parsed.name}.prj`),
    path.join(parsed.dir, `${parsed.name}.cpg`),
    path.join(parsed.dir, `${parsed.name}.sbn`),
    path.join(parsed.dir, `${parsed.name}.sbx`),
    path.join(parsed.dir, `${parsed.base}.xml`),
  ];

  const existing: string[] = [];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      existing.push(candidate);
    }
  }

  return existing;
}

async function currentTaxParcelHash(): Promise<string> {
  const hash = crypto.createHash("sha256");
  const sourcePath = parcelSourcePath();
  const sourceFiles = await getTaxParcelSourceFiles(sourcePath);
  if (sourceFiles.length === 0) {
    throw new Error(`Tax parcel source is missing: ${sourcePath}`);
  }

  for (const filePath of sourceFiles) {
    hash.update(path.basename(filePath));
    hash.update(await fs.readFile(filePath));
  }

  const taxBillRoot = billRootPath();
  if (await directoryExists(taxBillRoot)) {
    const billFiles = await listFilesRecursive(taxBillRoot);
    for (const filePath of billFiles) {
      const stat = await fs.stat(filePath);
      hash.update(path.relative(taxBillRoot, filePath));
      hash.update(String(stat.size));
      hash.update(String(stat.mtimeMs));
    }
  }

  return hash.digest("hex");
}

function buildTaxParcelMismatchMessage(reason: string): string {
  return [
    reason,
    "The tax parcel sidecar sources no longer match the populated PostGIS seed metadata.",
    "For local development, reset and reseed the database explicitly, for example: docker compose down -v && docker compose up --build.",
  ].join(" ");
}

async function getTaxParcelTableCounts(client: {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}): Promise<Record<string, number>> {
  const result = await client.query<{ tbl: string; count: string }>(`
    SELECT tbl, count FROM (
      SELECT 'tax_parcels' AS tbl, COUNT(*)::text AS count FROM tax_parcels
      UNION ALL
      SELECT 'tax_bill_manifest', COUNT(*)::text FROM tax_bill_manifest
    ) sub
  `);

  return Object.fromEntries(result.rows.map((row) => [row.tbl, Number(row.count)]));
}

async function getTaxParcelSeedHash(client: {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}): Promise<string | null> {
  const result = await client.query<{ value: string }>(
    `SELECT value FROM seed_metadata WHERE key = $1`,
    [TAX_PARCEL_SEED_METADATA_KEY],
  );

  return result.rows[0]?.value ?? null;
}

async function storeTaxParcelSeedHash(
  client: {
    query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  },
  seedHash: string,
): Promise<void> {
  await client.query(
    `
      INSERT INTO seed_metadata (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [TAX_PARCEL_SEED_METADATA_KEY, seedHash],
  );
}

export async function ensureTaxParcelSeedData(client: {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}): Promise<void> {
  const counts = await getTaxParcelTableCounts(client);
  const allPopulated = TAX_PARCEL_CORE_SEED_TABLES.every((table) => (counts[table] ?? 0) > 0);
  const somePopulated = TAX_PARCEL_CORE_SEED_TABLES.some((table) => (counts[table] ?? 0) > 0);
  const sourceHash = await currentTaxParcelHash();

  if (allPopulated) {
    const storedHash = await getTaxParcelSeedHash(client);
    if (!storedHash) {
      throw new Error(buildTaxParcelMismatchMessage("Tax parcel seed metadata is missing for an already-populated database."));
    }
    if (storedHash !== sourceHash) {
      throw new Error(buildTaxParcelMismatchMessage("Tax parcel source hash changed."));
    }
    return;
  }

  if (somePopulated) {
    throw new Error(buildTaxParcelMismatchMessage("Tax parcel seed tables are partially populated."));
  }

  await importTaxParcelSeedData(client);
  await storeTaxParcelSeedHash(client, sourceHash);
}

async function importTaxParcelSeedData(client: {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}): Promise<void> {
  const [parcelRows, billRows] = await Promise.all([
    loadTaxParcelSeedRows(),
    loadTaxBillManifestRows(),
  ]);

  for (const row of parcelRows) {
    await client.query(
      `
        INSERT INTO tax_parcels (
          parcel_id,
          parcel_code,
          account_number,
          owner_name,
          property_name,
          parcel_status,
          tax_program,
          ownership_type,
          county,
          state,
          gis_acres,
          description,
          land_use_type,
          tract_name,
          notes,
          raw_properties,
          geom
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
          $16::jsonb,
          ST_Multi(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($17), 4326)))
        )
      `,
      [
        row.parcel_id,
        row.parcel_code,
        row.account_number,
        row.owner_name,
        row.property_name,
        row.parcel_status,
        row.tax_program,
        row.ownership_type,
        row.county,
        row.state,
        row.gis_acres,
        row.description,
        row.land_use_type,
        row.tract_name,
        row.notes,
        JSON.stringify(row.raw_properties),
        JSON.stringify(row.geometry),
      ],
    );
  }

  for (const row of billRows) {
    await client.query(
      `
        INSERT INTO tax_bill_manifest (
          bill_id,
          parcel_id,
          bill_year,
          file_name,
          extension,
          size_bytes,
          bill_relative_path,
          source_root_path,
          source_file_path
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        row.bill_id,
        row.parcel_id,
        row.bill_year,
        row.file_name,
        row.extension,
        row.size_bytes,
        row.bill_relative_path,
        row.source_root_path,
        row.source_file_path,
      ],
    );
  }
}

async function loadTaxParcelSeedRows(): Promise<TaxParcelSeedRow[]> {
  const sourcePath = parcelSourcePath();
  if (!await fileExists(sourcePath)) {
    throw new Error(`Tax parcel source not found: ${sourcePath}`);
  }

  const rows: TaxParcelSeedRow[] = [];
  const source = await shapefile.open(sourcePath, undefined, {
    encoding: await readDbfEncoding(),
  });

  try {
    while (true) {
      const result = await source.read();
      if (result.done) {
        break;
      }

      const feature = result.value as Feature<Geometry, GeoJsonProperties>;
      if (!feature.geometry) {
        continue;
      }

      if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") {
        continue;
      }

      const properties = (feature.properties ?? {}) as Record<string, unknown>;
      rows.push({
        parcel_id: normalizeParcelId(properties.ParcelID ?? properties.FIP_Parcel),
        parcel_code: nullableText(properties.ParcelCode ?? properties.parcelnumb),
        account_number: nullableText(properties.account_nu ?? properties.account_number),
        owner_name: nullableText(properties.OwnerName ?? properties.owner),
        property_name: nullableText(properties.PropertyNa ?? properties.PropertyName),
        parcel_status: nullableText(properties.ParcelStat ?? properties.ParcelStatus),
        tax_program: nullableText(properties.TaxProgram),
        ownership_type: nullableText(properties.OwnershipT ?? properties.OwnershipType ?? properties.owntype),
        county: nullableText(properties.County ?? properties.county),
        state: nullableText(properties.State ?? properties.state2),
        gis_acres: nullableNumber(properties.GISAcres ?? properties.gisacre ?? properties.ll_gisacre),
        description: nullableText(properties.Descriptio ?? properties.Description ?? properties.legaldesc),
        land_use_type: nullableText(properties.LandUseTyp ?? properties.LandUseType ?? properties.usedesc ?? properties.usecode),
        tract_name: nullableText(properties.Tract_Name),
        notes: nullableText(properties.Notes),
        raw_properties: properties,
        geometry: feature.geometry,
      });
    }
  } finally {
    await source.cancel().catch(() => undefined);
  }

  return rows;
}

async function loadTaxBillManifestRows(): Promise<TaxBillManifestSeedRow[]> {
  const sourceRoot = billRootPath();
  if (!await directoryExists(sourceRoot)) {
    return [];
  }

  const rows: TaxBillManifestSeedRow[] = [];
  const files = await listFilesRecursive(sourceRoot);
  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const match = /^(\d{4})_(.+?)(\.[^.]+)$/i.exec(fileName);
    if (!match) {
      continue;
    }

    const [, yearText, parcelIdText, extensionText] = match;
    const parcelId = normalizeParcelId(parcelIdText);
    const billYear = Number(yearText);
    if (!parcelId || !Number.isInteger(billYear)) {
      continue;
    }

    const relativePath = path.relative(sourceRoot, filePath).split(path.sep).join("/");
    const stat = await fs.stat(filePath);
    rows.push({
      bill_id: makeStableBillId(relativePath),
      parcel_id: parcelId,
      bill_year: billYear,
      file_name: fileName,
      extension: normalizeExtension(extensionText, fileName),
      size_bytes: stat.size,
      bill_relative_path: relativePath,
      source_root_path: sourceRoot,
      source_file_path: filePath,
    });
  }

  return rows.sort((left, right) => left.bill_relative_path.localeCompare(right.bill_relative_path));
}

function makeStableBillId(relativePath: string): string {
  return `tax-bill-${crypto.createHash("sha1").update(relativePath.toLowerCase()).digest("hex").slice(0, 16)}`;
}

function makeTaxBillUrls(billId: string): Pick<TaxBillAsset, "contentUrl" | "downloadUrl"> {
  const encoded = encodeURIComponent(billId);
  return {
    contentUrl: `/api/tax-parcels/bills/${encoded}/content`,
    downloadUrl: `/api/tax-parcels/bills/${encoded}/download`,
  };
}

function toTaxBill(asset: TaxBillAsset): TaxBill {
  return {
    billId: asset.billId,
    parcelId: asset.parcelId,
    year: asset.year,
    filename: asset.filename,
    extension: asset.extension,
    sizeBytes: asset.sizeBytes,
    hasFile: asset.hasFile,
    isPreviewable: asset.isPreviewable,
    contentUrl: asset.contentUrl,
    downloadUrl: asset.downloadUrl,
  };
}

async function buildTaxBillAsset(row: TaxBillRow): Promise<TaxBillAsset> {
  const filePath = resolveTaxBillFilePath(row.bill_relative_path);
  const hasFile = filePath ? await fileExists(filePath) : false;
  const isPreviewable = hasFile && isPreviewableExtension(row.extension, row.file_name);
  const { contentUrl, downloadUrl } = makeTaxBillUrls(row.bill_id);

  return {
    billId: row.bill_id,
    parcelId: row.parcel_id,
    year: row.bill_year,
    filename: row.file_name,
    extension: row.extension,
    sizeBytes: nullableNumber(row.size_bytes),
    hasFile,
    isPreviewable,
    contentUrl: isPreviewable ? contentUrl : null,
    downloadUrl,
    filePath,
    mimeType: isPreviewable ? mimeTypeFromExtension(row.extension, row.file_name) : null,
  };
}

export function resolveTaxBillFilePath(billRelativePath: string | null): string | null {
  if (!billRelativePath) {
    return null;
  }

  const root = billRootPath();
  const candidate = path.resolve(root, billRelativePath);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return candidate;
}

export function normalizeTaxParcelBufferFeet(value: unknown): TaxParcelBufferFeet | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return TAX_PARCEL_BUFFER_FEET_OPTIONS.includes(parsed as TaxParcelBufferFeet)
    ? (parsed as TaxParcelBufferFeet)
    : null;
}

export async function loadTaxBillAsset(billId: string): Promise<TaxBillAsset | null> {
  const result = await query<TaxBillRow>(
    `
      SELECT
        bill_id,
        parcel_id,
        bill_year,
        file_name,
        extension,
        size_bytes,
        bill_relative_path
      FROM tax_bill_manifest
      WHERE bill_id = $1
    `,
    [billId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return buildTaxBillAsset(row);
}

async function loadTaxBillsByParcelIds(parcelIds: string[]): Promise<Map<string, TaxBill[]>> {
  const uniqueParcelIds = Array.from(new Set(parcelIds.filter(Boolean)));
  if (uniqueParcelIds.length === 0) {
    return new Map();
  }

  const result = await query<TaxBillRow>(
    `
      SELECT
        bill_id,
        parcel_id,
        bill_year,
        file_name,
        extension,
        size_bytes,
        bill_relative_path
      FROM tax_bill_manifest
      WHERE parcel_id = ANY($1::text[])
      ORDER BY parcel_id, bill_year DESC, file_name
    `,
    [uniqueParcelIds],
  );

  const billsByParcelId = new Map<string, TaxBill[]>();
  for (const row of result.rows) {
    const bill = toTaxBill(await buildTaxBillAsset(row));
    const current = billsByParcelId.get(bill.parcelId) ?? [];
    current.push(bill);
    billsByParcelId.set(bill.parcelId, current);
  }

  return billsByParcelId;
}

function feetToMeters(bufferFeet: TaxParcelBufferFeet): number {
  return bufferFeet * 0.3048;
}

export async function loadTaxParcelQuestionAreaView(
  questionAreaCode: string,
  bufferFeet: TaxParcelBufferFeet,
): Promise<TaxParcelQueryResult | null> {
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

  const matchedParcels = await query<TaxParcelQueryRow>(
    `
      WITH selected AS (
        SELECT
          geom AS point_geometry,
          ST_Buffer(geom::geography, $2::double precision)::geometry AS buffer_geometry
        FROM question_areas
        WHERE code = $1
      ),
      spatial_matches AS (
        SELECT
          COALESCE(
            NULLIF(tp.parcel_id, ''),
            NULLIF(tp.parcel_code, ''),
            NULLIF(tp.account_number, ''),
            'tax-parcel-' || tp.id::text
          ) AS parcel_key,
          tp.*,
          s.point_geometry,
          s.buffer_geometry
        FROM tax_parcels tp
        CROSS JOIN selected s
        WHERE ST_Intersects(tp.geom, s.buffer_geometry)
      ),
      aggregated AS (
        SELECT
          parcel_key,
          MAX(parcel_id) FILTER (WHERE parcel_id IS NOT NULL AND parcel_id <> '') AS parcel_id,
          MAX(parcel_code) FILTER (WHERE parcel_code IS NOT NULL AND parcel_code <> '') AS parcel_code,
          MAX(account_number) FILTER (WHERE account_number IS NOT NULL AND account_number <> '') AS account_number,
          MAX(owner_name) FILTER (WHERE owner_name IS NOT NULL AND owner_name <> '') AS owner_name,
          MAX(property_name) FILTER (WHERE property_name IS NOT NULL AND property_name <> '') AS property_name,
          MAX(parcel_status) FILTER (WHERE parcel_status IS NOT NULL AND parcel_status <> '') AS parcel_status,
          MAX(tax_program) FILTER (WHERE tax_program IS NOT NULL AND tax_program <> '') AS tax_program,
          MAX(ownership_type) FILTER (WHERE ownership_type IS NOT NULL AND ownership_type <> '') AS ownership_type,
          MAX(county) FILTER (WHERE county IS NOT NULL AND county <> '') AS county,
          MAX(state) FILTER (WHERE state IS NOT NULL AND state <> '') AS state,
          MAX(gis_acres) AS gis_acres,
          MAX(description) FILTER (WHERE description IS NOT NULL AND description <> '') AS description,
          MAX(land_use_type) FILTER (WHERE land_use_type IS NOT NULL AND land_use_type <> '') AS land_use_type,
          MAX(tract_name) FILTER (WHERE tract_name IS NOT NULL AND tract_name <> '') AS tract_name,
          MAX(notes) FILTER (WHERE notes IS NOT NULL AND notes <> '') AS notes,
          SUM(ST_Area(ST_Intersection(geom, buffer_geometry)::geography)) AS overlap_area_sq_meters,
          MIN(ST_Distance(geom::geography, point_geometry::geography)) AS point_distance_meters,
          ST_AsGeoJSON(
            ST_Multi(
              ST_CollectionExtract(
                ST_UnaryUnion(ST_Collect(geom)),
                3
              )
            ),
            6
          )::jsonb AS geometry
        FROM spatial_matches
        GROUP BY parcel_key
      )
      SELECT
        parcel_key,
        parcel_id,
        parcel_code,
        account_number,
        owner_name,
        property_name,
        parcel_status,
        tax_program,
        ownership_type,
        county,
        state,
        gis_acres,
        description,
        land_use_type,
        tract_name,
        notes,
        overlap_area_sq_meters,
        point_distance_meters,
        ROW_NUMBER() OVER (
          ORDER BY
            overlap_area_sq_meters DESC NULLS LAST,
            point_distance_meters ASC NULLS LAST,
            COALESCE(parcel_code, parcel_id, account_number, parcel_key)
        ) AS primary_rank,
        geometry
      FROM aggregated
      ORDER BY primary_rank
    `,
    [questionAreaCode, feetToMeters(bufferFeet)],
  );

  const billsByParcelId = await loadTaxBillsByParcelIds(
    matchedParcels.rows.map((row) => row.parcel_id).filter((value): value is string => Boolean(value)),
  );

  const warnings: TaxParcelWarning[] = [];
  const warningKeys = new Set<string>();
  const parcels = matchedParcels.rows.map((row) => {
    const bills = row.parcel_id ? (billsByParcelId.get(row.parcel_id) ?? []) : [];
    for (const bill of bills) {
      pushTaxBillWarnings(bill, row.parcel_id, warningKeys, warnings);
    }

    return {
      parcelId: row.parcel_id,
      parcelCode: row.parcel_code,
      accountNumber: row.account_number,
      ownerName: row.owner_name,
      propertyName: row.property_name,
      parcelStatus: row.parcel_status,
      taxProgram: row.tax_program,
      ownershipType: row.ownership_type,
      county: row.county,
      state: row.state,
      gisAcres: row.gis_acres,
      description: row.description,
      landUseType: row.land_use_type,
      tractName: row.tract_name,
      notes: row.notes,
      overlapAreaSqMeters: row.overlap_area_sq_meters,
      pointDistanceMeters: row.point_distance_meters,
      primaryRank: row.primary_rank,
      isPrimaryMatch: row.primary_rank === 1,
      geometry: row.geometry,
      bills,
    } satisfies TaxParcel;
  });

  const matchedBillCount = Array.from(billsByParcelId.values()).reduce((total, bills) => total + bills.length, 0);

  return {
    questionAreaCode: areaRow.code,
    bufferValue: bufferFeet,
    bufferUnit: "feet",
    bufferGeometry: areaRow.buffer_geometry,
    matchedParcelCount: parcels.length,
    matchedBillCount,
    parcels,
    warnings,
  };
}

function pushTaxBillWarnings(
  bill: TaxBill,
  parcelId: string | null,
  warningKeys: Set<string>,
  warnings: TaxParcelWarning[],
) {
  if (!bill.hasFile) {
    const key = `missing:${bill.billId}`;
    if (!warningKeys.has(key)) {
      warningKeys.add(key);
      warnings.push({
        code: "missing_file",
        billId: bill.billId,
        parcelId,
        message: `Tax bill ${bill.filename} is missing from the configured bill folder.`,
        severity: "warning",
      });
    }
    return;
  }

  if (!bill.isPreviewable) {
    const key = `preview:${bill.billId}`;
    if (!warningKeys.has(key)) {
      warningKeys.add(key);
      warnings.push({
        code: "unsupported_preview",
        billId: bill.billId,
        parcelId,
        message: `Tax bill ${bill.filename} cannot be previewed inline.`,
        severity: "warning",
      });
    }
  }
}
