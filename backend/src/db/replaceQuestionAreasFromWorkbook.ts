import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import type { PoolClient } from "pg";
import type * as XlsxModule from "xlsx";

import { config } from "../config.js";
import { pool, waitForDatabase, withClient, withTransaction } from "../lib/db.js";
import { ensureSchema } from "../lib/schema.js";

const DEFAULT_WORKBOOK_PATH = path.join(
  config.repoRoot,
  "DataBuild",
  "PTA_SpatialOverlayResults_NNC_Timber_28May2026.xlsx",
);
const SOURCE_SHEET = "Combined";
const EXPECTED_HEADERS = [
  "Source Sheet",
  "Parcel Code",
  "State",
  "County",
  "Tax Bill Acres",
  "Calculated GIS Tax Acres",
  "Spatial Overlay Notes",
  "Land Services",
  "Risk",
  "Exists in Legal Layer",
  "Exists in Mgt. Layer",
  "Exists in Client Tabular/Bill Data",
  "Latitude",
  "Longitude",
  "Fund Name",
  "Property Name",
  "Tract Name",
  "Owner Name",
  "Legal Description",
] as const;
const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof XlsxModule;
type ExpectedHeader = (typeof EXPECTED_HEADERS)[number];

type WorkbookRow = {
  code: string;
  sourceLayer: string;
  status: "review";
  severity: "high" | "medium" | "low";
  actionabilityState: "normal";
  title: string;
  summary: string;
  description: string | null;
  county: string | null;
  state: string | null;
  parcelCode: string;
  ownerName: string | null;
  propertyName: string | null;
  tractName: string | null;
  fundName: string | null;
  landServices: string | null;
  taxBillAcres: number | null;
  gisAcres: number | null;
  spatialOverlayNotes: string | null;
  legalDescription: string | null;
  risk: string | null;
  latitude: number | null;
  longitude: number | null;
  questionnaireSource: string;
  existsInLegalLayer: boolean | null;
  existsInManagementLayer: boolean | null;
  existsInClientTabularBillData: boolean | null;
  assignedReviewer: string | null;
  searchKeywords: string;
  rawProperties: Record<string, unknown>;
};

type ExistingCoordinate = {
  parcel_code: string;
  latitude: number | null;
  longitude: number | null;
};

type HeaderIndexes = Record<ExpectedHeader, number>;

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const text = String(value).replace(/,/g, "").trim();
  if (!text) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBoolean(value: unknown): boolean | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "yes") {
    return true;
  }
  if (text === "no") {
    return false;
  }
  return null;
}

function normalizeRisk(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  const normalized = text.toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return text;
}

function riskToSeverity(risk: string | null): "high" | "medium" | "low" {
  if (risk === "high" || risk === "medium" || risk === "low") {
    return risk;
  }
  return "medium";
}

function getCell(row: unknown[], index: number): unknown {
  return row[index] ?? null;
}

function normalizeHeader(value: unknown): string | null {
  const text = normalizeText(value);
  return text ? text.replace(/\s+/g, " ") : null;
}

function buildHeaderIndexes(headers: unknown[]): HeaderIndexes {
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));

  if (normalizedHeaders.length !== EXPECTED_HEADERS.length) {
    throw new Error(
      `Workbook header count mismatch. Expected ${EXPECTED_HEADERS.length} columns but found ${normalizedHeaders.length}.`,
    );
  }

  for (const [index, expectedHeader] of EXPECTED_HEADERS.entries()) {
    if (normalizedHeaders[index] !== expectedHeader) {
      throw new Error(
        `Workbook header mismatch at column ${index + 1}. Expected "${expectedHeader}" but found "${normalizedHeaders[index] ?? ""}".`,
      );
    }
  }

  return Object.fromEntries(
    EXPECTED_HEADERS.map((header, index) => [header, index]),
  ) as HeaderIndexes;
}

function buildSearchKeywords(row: WorkbookRow): string {
  return [
    row.code,
    row.parcelCode,
    row.state,
    row.county,
    row.propertyName,
    row.tractName,
    row.fundName,
    row.ownerName,
    row.spatialOverlayNotes,
    row.landServices,
    row.legalDescription,
    row.risk,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function buildRawProperties(headers: unknown[], row: unknown[]): Record<string, unknown> {
  return Object.fromEntries(
    headers.map((header, index) => {
      const label = normalizeText(header) ?? `Column ${index + 1}`;
      const value = row[index];
      return [label.replace(/\s+/g, " "), value ?? null];
    }),
  );
}

function loadWorkbookRows(workbookPath: string): WorkbookRow[] {
  const workbook = XLSX.readFile(workbookPath, { cellDates: false });
  const sheet = workbook.Sheets[SOURCE_SHEET];
  if (!sheet) {
    throw new Error(`Workbook is missing required sheet "${SOURCE_SHEET}".`);
  }

  const values = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const headers = values[0] ?? [];
  const headerIndexes = buildHeaderIndexes(headers);
  const rows: WorkbookRow[] = [];
  const seenParcelCodes = new Set<string>();

  for (const [index, row] of values.slice(1).entries()) {
    if (!row.some((cell) => normalizeText(cell))) {
      continue;
    }

    const parcelCode = normalizeText(getCell(row, headerIndexes["Parcel Code"]));
    if (!parcelCode) {
      throw new Error(`Workbook row ${index + 2} is missing Parcel Code.`);
    }
    if (seenParcelCodes.has(parcelCode)) {
      throw new Error(`Workbook contains duplicate Parcel Code "${parcelCode}".`);
    }
    seenParcelCodes.add(parcelCode);

    const spatialOverlayNotes = normalizeText(getCell(row, headerIndexes["Spatial Overlay Notes"]));
    const landServices = normalizeText(getCell(row, headerIndexes["Land Services"]));
    const risk = normalizeRisk(getCell(row, headerIndexes["Risk"]));
    const propertyName = normalizeText(getCell(row, headerIndexes["Property Name"]));
    const legalDescription = normalizeText(getCell(row, headerIndexes["Legal Description"]));
    const code = `QA-${String(rows.length + 1).padStart(4, "0")}`;

    const workbookRow: WorkbookRow = {
      code,
      sourceLayer: "PTA Spatial Overlay Results",
      status: "review",
      severity: riskToSeverity(risk),
      actionabilityState: "normal",
      title: propertyName ?? parcelCode,
      summary: "",
      description: null,
      county: normalizeText(getCell(row, headerIndexes["County"])),
      state: normalizeText(getCell(row, headerIndexes["State"])),
      parcelCode,
      ownerName: normalizeText(getCell(row, headerIndexes["Owner Name"])),
      propertyName,
      tractName: normalizeText(getCell(row, headerIndexes["Tract Name"])),
      fundName: normalizeText(getCell(row, headerIndexes["Fund Name"])),
      landServices,
      taxBillAcres: normalizeNumber(getCell(row, headerIndexes["Tax Bill Acres"])),
      gisAcres: normalizeNumber(getCell(row, headerIndexes["Calculated GIS Tax Acres"])),
      spatialOverlayNotes,
      legalDescription,
      risk,
      latitude: normalizeNumber(getCell(row, headerIndexes["Latitude"])),
      longitude: normalizeNumber(getCell(row, headerIndexes["Longitude"])),
      questionnaireSource: `${path.basename(workbookPath)}:${SOURCE_SHEET}`,
      existsInLegalLayer: normalizeBoolean(getCell(row, headerIndexes["Exists in Legal Layer"])),
      existsInManagementLayer: normalizeBoolean(getCell(row, headerIndexes["Exists in Mgt. Layer"])),
      existsInClientTabularBillData: normalizeBoolean(
        getCell(row, headerIndexes["Exists in Client Tabular/Bill Data"]),
      ),
      assignedReviewer: null,
      searchKeywords: "",
      rawProperties: buildRawProperties(headers, row),
    };

    workbookRow.searchKeywords = buildSearchKeywords(workbookRow);
    rows.push(workbookRow);
  }

  return rows;
}

async function fillMissingCoordinates(client: PoolClient, rows: WorkbookRow[]): Promise<void> {
  const missing = rows.filter((row) => row.latitude === null || row.longitude === null);
  if (missing.length === 0) {
    return;
  }

  const parcelCodes = missing.map((row) => row.parcelCode);
  const result = await client.query<ExistingCoordinate>(
    `
      SELECT parcel_code, ST_Y(geom) AS latitude, ST_X(geom) AS longitude
      FROM question_areas
      WHERE parcel_code = ANY($1::text[])
    `,
    [parcelCodes],
  );
  const existingCoordinates = new Map(result.rows.map((row) => [row.parcel_code, row]));

  for (const row of missing) {
    const coordinate = existingCoordinates.get(row.parcelCode);
    if (coordinate?.latitude === null || coordinate?.longitude === null || !coordinate) {
      throw new Error(
        `Workbook row for Parcel Code "${row.parcelCode}" is missing coordinates and no existing database fallback was found.`,
      );
    }
    row.latitude = coordinate.latitude;
    row.longitude = coordinate.longitude;
    row.rawProperties["Coordinate Fallback"] = "Existing question_areas geometry";
  }
}

async function insertQuestionArea(client: PoolClient, row: WorkbookRow): Promise<void> {
  if (row.latitude === null || row.longitude === null) {
    throw new Error(`Question area ${row.code} still has missing coordinates.`);
  }

  await client.query(
    `
      INSERT INTO question_areas (
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
        search_keywords,
        raw_properties,
        geom
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26, $27, $28, $29,
        $30,
        ST_SetSRID(ST_MakePoint($23, $22), 4326)
      )
    `,
    [
      row.code,
      row.sourceLayer,
      row.status,
      row.severity,
      row.actionabilityState,
      row.title,
      row.summary,
      row.description,
      row.county,
      row.state,
      row.parcelCode,
      row.ownerName,
      row.propertyName,
      row.tractName,
      row.fundName,
      row.landServices,
      row.taxBillAcres,
      row.gisAcres,
      row.spatialOverlayNotes,
      row.legalDescription,
      row.risk,
      row.latitude,
      row.longitude,
      row.questionnaireSource,
      row.existsInLegalLayer,
      row.existsInManagementLayer,
      row.existsInClientTabularBillData,
      row.assignedReviewer,
      row.searchKeywords,
      JSON.stringify(row.rawProperties),
    ],
  );
}

async function deleteStoredDocumentFiles(storedNames: string[]): Promise<void> {
  for (const storedName of storedNames) {
    const filePath = path.join(config.uploadsDir, storedName);
    await fs.unlink(filePath).catch((error: unknown) => {
      console.warn(`Warning: could not delete uploaded file ${filePath}:`, error);
    });
  }
}

async function main(): Promise<void> {
  const workbookPath = path.resolve(process.argv[2] ?? DEFAULT_WORKBOOK_PATH);
  const rows = loadWorkbookRows(workbookPath);
  if (rows.length === 0) {
    throw new Error("Workbook did not contain any question-area rows.");
  }

  await waitForDatabase();
  await withClient(ensureSchema);

  let storedNames: string[] = [];
  await withTransaction(async (client) => {
    await fillMissingCoordinates(client, rows);

    const documents = await client.query<{ stored_name: string }>(
      `SELECT stored_name FROM documents`,
    );
    storedNames = documents.rows.map((row) => row.stored_name);

    await client.query(`TRUNCATE TABLE question_areas RESTART IDENTITY CASCADE`);

    for (const row of rows) {
      await insertQuestionArea(client, row);
    }

    const count = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM question_areas`,
    );
    if (Number(count.rows[0]?.count ?? 0) !== rows.length) {
      throw new Error(`Expected ${rows.length} inserted question areas but found ${count.rows[0]?.count}.`);
    }
  });

  await deleteStoredDocumentFiles(storedNames);
  console.log(`Replaced question_areas with ${rows.length} rows from ${workbookPath}.`);
}

main()
  .catch((error) => {
    console.error("Question-area workbook replacement failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
