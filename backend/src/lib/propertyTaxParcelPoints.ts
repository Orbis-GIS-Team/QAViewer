import path from "node:path";

import type { Feature, FeatureCollection, GeoJsonProperties, Geometry, Point } from "geojson";
import type { PoolClient, QueryResultRow } from "pg";
import XLSX from "xlsx";

import { config } from "../config.js";
import { query } from "./db.js";
import { featureCollection } from "./utils.js";

export type CoordinateStatus = "present" | "missing" | "invalid";

export type PropertyTaxParcelPoint = {
  id: number;
  parcelCode: string | null;
  accountNumber: string | null;
  gisAcres: number | null;
  state: string | null;
  county: string | null;
  propertyName: string | null;
  tractName: string | null;
  parcelStatus: string | null;
  taxProgram: string | null;
  exemptionEnrollmentDate: string | null;
  exemptionExpirationDate: string | null;
  exemptionEligibilityDate: string | null;
  ownershipType: string | null;
  purchaseDate: string | null;
  ownerName: string | null;
  description: string | null;
  fipParcelId: string | null;
  notes: string | null;
  landUseType: string | null;
  latitude: number | null;
  longitude: number | null;
  coordinateStatus: CoordinateStatus;
  sourceWorkbookPath: string | null;
  sourceSheet: string | null;
  sourceRowNumber: number | null;
  rawProperties?: Record<string, unknown>;
  geometry?: Point | null;
};

export type RegridIdentifyResult = {
  clicked: { latitude: number; longitude: number };
  regridParcel: Feature<Geometry, GeoJsonProperties> | null;
  matches: PropertyTaxParcelPoint[];
  matchCount: number;
  joinMethod: "point-in-polygon";
  message: string | null;
};

type Queryable = {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
};

type PropertyTaxParcelPointRow = QueryResultRow & {
  id: number;
  parcel_code: string | null;
  account_number: string | null;
  gis_acres: number | null;
  state: string | null;
  county: string | null;
  property_name: string | null;
  tract_name: string | null;
  parcel_status: string | null;
  tax_program: string | null;
  exemption_enrollment_date: string | null;
  exemption_expiration_date: string | null;
  exemption_eligibility_date: string | null;
  ownership_type: string | null;
  purchase_date: string | null;
  owner_name: string | null;
  description: string | null;
  fip_parcel_id: string | null;
  notes: string | null;
  land_use_type: string | null;
  latitude: number | null;
  longitude: number | null;
  coordinate_status: CoordinateStatus;
  source_workbook_path: string | null;
  source_sheet: string | null;
  source_row_number: number | null;
  raw_properties: Record<string, unknown>;
  geometry?: Point | null;
};

type RegridMatchRow = QueryResultRow & {
  regrid_id: string | null;
  matched_point_count: string;
};

const WORKBOOK_COLUMNS = [
  "ParcelCode",
  "Account Number",
  "GISAcres",
  "State",
  "County",
  "PropertyName",
  "Tract Name",
  "ParcelStatus",
  "TaxProgram",
  "ExmpEnrollmentDate",
  "ExmpExpirationDate",
  "ExmpEligibilityDate",
  "OwnershipType",
  "PurchaseDate",
  "OwnerName",
  "Description",
  "FIP_ParcelId",
  "Notes",
  "LandUseType",
  "Latitude",
  "Longitude",
] as const;

const REGRID_OUT_FIELDS = [
  "id",
  "parcelnumb",
  "account_number",
  "owner",
  "address",
  "county",
  "state2",
  "ll_uuid",
  "ll_gisacre",
].join(",");

export function normalizePropertyTaxRegridMinZoom() {
  return Number.isFinite(config.propertyTaxRegridMinZoom) ? config.propertyTaxRegridMinZoom : 12;
}

export async function importPropertyTaxParcelPointsFromWorkbook(
  client: PoolClient,
  workbookPath = config.propertyTaxParcelWorkbookPath,
): Promise<{ inserted: number; withGeometry: number; missingGeometry: number; invalidGeometry: number }> {
  const resolvedWorkbookPath = path.resolve(workbookPath);
  const workbook = XLSX.readFile(resolvedWorkbookPath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error(`Property tax parcel workbook has no worksheets: ${resolvedWorkbookPath}`);
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  const headers = rows[0]?.map((value) => nullableText(value) ?? "") ?? [];
  const missingColumns = WORKBOOK_COLUMNS.filter((column) => !headers.includes(column));
  if (missingColumns.length > 0) {
    throw new Error(`Property tax parcel workbook is missing columns: ${missingColumns.join(", ")}`);
  }

  const columnIndex = Object.fromEntries(headers.map((header, index) => [header, index]));
  let inserted = 0;
  let withGeometry = 0;
  let missingGeometry = 0;
  let invalidGeometry = 0;

  await client.query("TRUNCATE property_tax_parcel_points RESTART IDENTITY");

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    if (row.every((value) => nullableText(value) === null)) {
      continue;
    }

    const rawProperties = Object.fromEntries(headers.map((header, index) => [header, normalizeRawValue(row[index])]));
    const latitude = nullableNumber(row[columnIndex.Latitude]);
    const longitude = nullableNumber(row[columnIndex.Longitude]);
    const coordinateStatus = classifyCoordinate(latitude, longitude, row[columnIndex.Latitude], row[columnIndex.Longitude]);
    if (coordinateStatus === "present") {
      withGeometry += 1;
    } else if (coordinateStatus === "invalid") {
      invalidGeometry += 1;
    } else {
      missingGeometry += 1;
    }

    await client.query(
      `
        INSERT INTO property_tax_parcel_points (
          parcel_code,
          account_number,
          gis_acres,
          state,
          county,
          property_name,
          tract_name,
          parcel_status,
          tax_program,
          exemption_enrollment_date,
          exemption_expiration_date,
          exemption_eligibility_date,
          ownership_type,
          purchase_date,
          owner_name,
          description,
          fip_parcel_id,
          notes,
          land_use_type,
          latitude,
          longitude,
          coordinate_status,
          source_workbook_path,
          source_sheet,
          source_row_number,
          raw_properties,
          geom
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19,
          $20, $21, $22, $23, $24, $25, $26::jsonb,
          CASE
            WHEN $22 = 'present' THEN ST_SetSRID(ST_MakePoint($21, $20), 4326)
            ELSE NULL
          END
        )
      `,
      [
        nullableText(row[columnIndex.ParcelCode]),
        normalizeIdentifier(row[columnIndex["Account Number"]]),
        nullableNumber(row[columnIndex.GISAcres]),
        nullableText(row[columnIndex.State]),
        nullableText(row[columnIndex.County]),
        nullableText(row[columnIndex.PropertyName]),
        nullableText(row[columnIndex["Tract Name"]]),
        nullableText(row[columnIndex.ParcelStatus]),
        nullableText(row[columnIndex.TaxProgram]),
        nullableText(row[columnIndex.ExmpEnrollmentDate]),
        nullableText(row[columnIndex.ExmpExpirationDate]),
        nullableText(row[columnIndex.ExmpEligibilityDate]),
        nullableText(row[columnIndex.OwnershipType]),
        nullableText(row[columnIndex.PurchaseDate]),
        nullableText(row[columnIndex.OwnerName]),
        nullableText(row[columnIndex.Description]),
        normalizeIdentifier(row[columnIndex.FIP_ParcelId]),
        nullableText(row[columnIndex.Notes]),
        nullableText(row[columnIndex.LandUseType]),
        latitude,
        longitude,
        coordinateStatus,
        resolvedWorkbookPath,
        sheetName,
        rowIndex + 1,
        JSON.stringify(rawProperties),
      ],
    );

    inserted += 1;
  }

  return { inserted, withGeometry, missingGeometry, invalidGeometry };
}

export async function loadPropertyTaxParcelPointCollection(
  bbox: [number, number, number, number] | null,
): Promise<FeatureCollection> {
  const clauses = ["geom IS NOT NULL"];
  const params: number[] = [];

  if (bbox) {
    const [west, south, east, north] = bbox;
    params.push(west, south, east, north);
    clauses.push(
      `geom && ST_MakeEnvelope($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length}, 4326)`,
    );
  }

  const result = await query<PropertyTaxParcelPointRow>(
    `
      SELECT
        *,
        ST_AsGeoJSON(geom, 6)::jsonb AS geometry
      FROM property_tax_parcel_points
      WHERE ${clauses.join(" AND ")}
      ORDER BY id
      LIMIT 10000
    `,
    params,
  );

  return featureCollection(result.rows.map((row) => pointRowToFeature(row)) as Feature[]);
}

export async function loadPropertyTaxParcelPoint(id: number): Promise<Feature<Geometry | null> | null> {
  const result = await query<PropertyTaxParcelPointRow>(
    `
      SELECT
        *,
        CASE WHEN geom IS NULL THEN NULL ELSE ST_AsGeoJSON(geom, 6)::jsonb END AS geometry
      FROM property_tax_parcel_points
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  );

  const row = result.rows[0];
  return row ? pointRowToFeature(row, true) : null;
}

export async function loadRegridParcelCollection(
  bbox: [number, number, number, number] | null,
  zoom: number,
): Promise<FeatureCollection> {
  if (!bbox || zoom < normalizePropertyTaxRegridMinZoom()) {
    return featureCollection([]);
  }

  const payload = await queryRegridGeoJson({
    geometry: bbox.join(","),
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    resultRecordCount: "1999",
  });
  const features = Array.isArray(payload.features) ? payload.features : [];
  const matchedCounts = await loadMatchedPointCountsForRegridFeatures(features as Feature[]);

  return {
    type: "FeatureCollection",
    features: (features as Feature[]).map((feature) => {
      const regridId = regridFeatureId(feature);
      const matchedPointCount = regridId ? (matchedCounts.get(regridId) ?? 0) : 0;
      return {
        ...feature,
        properties: {
          ...(feature.properties ?? {}),
          isMatched: matchedPointCount > 0,
          matchedPointCount,
        },
      };
    }),
  };
}

export async function loadRegridParcelFabricCollection(
  bbox: [number, number, number, number] | null,
  zoom: number,
): Promise<FeatureCollection> {
  if (!bbox || zoom < normalizePropertyTaxRegridMinZoom()) {
    return featureCollection([]);
  }

  return queryRegridGeoJson({
    geometry: bbox.join(","),
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    resultRecordCount: "1999",
  });
}

export async function identifyRegridParcelAtPoint(latitude: number, longitude: number): Promise<RegridIdentifyResult> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error("A valid latitude and longitude are required.");
  }

  const payload = await queryRegridGeoJson({
    geometry: `${longitude},${latitude}`,
    geometryType: "esriGeometryPoint",
    spatialRel: "esriSpatialRelIntersects",
    resultRecordCount: "5",
  });

  const features = Array.isArray(payload.features) ? (payload.features as Feature[]) : [];
  const regridParcel = features[0] ?? null;
  if (!regridParcel?.geometry) {
    return {
      clicked: { latitude, longitude },
      regridParcel: null,
      matches: [],
      matchCount: 0,
      joinMethod: "point-in-polygon",
      message: "No Regrid parcel found at this location.",
    };
  }

  const matches = await loadPointsContainedByGeometry(regridParcel.geometry);
  return {
    clicked: { latitude, longitude },
    regridParcel,
    matches,
    matchCount: matches.length,
    joinMethod: "point-in-polygon",
    message: matches.length > 0 ? null : "No workbook points found inside this Regrid parcel.",
  };
}

async function loadMatchedPointCountsForRegridFeatures(features: Feature[]): Promise<Map<string, number>> {
  if (features.length === 0) {
    return new Map();
  }

  const result = await query<RegridMatchRow>(
    `
      WITH regrid AS (
        SELECT
          feature->'properties'->>'id' AS regrid_id,
          ST_SetSRID(ST_GeomFromGeoJSON((feature->'geometry')::text), 4326) AS geom
        FROM jsonb_array_elements($1::jsonb) AS feature
        WHERE feature ? 'geometry'
          AND feature->'geometry' IS NOT NULL
      )
      SELECT
        regrid.regrid_id,
        COUNT(points.id)::text AS matched_point_count
      FROM regrid
      LEFT JOIN property_tax_parcel_points points
        ON points.geom IS NOT NULL
       AND points.geom && regrid.geom
       AND ST_Covers(regrid.geom, points.geom)
      GROUP BY regrid.regrid_id
    `,
    [JSON.stringify(features)],
  );

  return new Map(
    result.rows
      .filter((row) => row.regrid_id)
      .map((row) => [row.regrid_id as string, Number(row.matched_point_count)]),
  );
}

async function loadPointsContainedByGeometry(geometry: Geometry): Promise<PropertyTaxParcelPoint[]> {
  const result = await query<PropertyTaxParcelPointRow>(
    `
      WITH selected AS (
        SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom
      )
      SELECT
        points.*,
        ST_AsGeoJSON(points.geom, 6)::jsonb AS geometry
      FROM property_tax_parcel_points points
      CROSS JOIN selected
      WHERE points.geom IS NOT NULL
        AND points.geom && selected.geom
        AND ST_Covers(selected.geom, points.geom)
      ORDER BY points.parcel_code NULLS LAST, points.id
      LIMIT 100
    `,
    [JSON.stringify(geometry)],
  );

  return result.rows.map((row) => rowToPoint(row, true));
}

async function queryRegridGeoJson(extraParams: Record<string, string>): Promise<FeatureCollection> {
  const serviceUrl = config.regridFeatureServiceUrl.trim().replace(/\/+$/, "");
  if (!serviceUrl) {
    throw new Error("REGRID_FEATURE_SERVICE_URL is not configured.");
  }

  const params = new URLSearchParams({
    f: "geojson",
    where: "1=1",
    outFields: REGRID_OUT_FIELDS,
    returnGeometry: "true",
    inSR: "4326",
    outSR: "4326",
    ...extraParams,
  });
  const response = await fetch(`${serviceUrl}/query?${params.toString()}`);
  const payload = (await response.json()) as FeatureCollection & { error?: { message?: string } };

  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message ?? `Regrid request failed with status ${response.status}.`);
  }

  return payload;
}

function pointRowToFeature(
  row: PropertyTaxParcelPointRow,
  includeRawProperties = false,
): Feature<Geometry | null> {
  return {
    type: "Feature",
    geometry: row.geometry ?? null,
    properties: rowToPoint(row, includeRawProperties) as unknown as GeoJsonProperties,
  };
}

function rowToPoint(row: PropertyTaxParcelPointRow, includeRawProperties: boolean): PropertyTaxParcelPoint {
  return {
    id: row.id,
    parcelCode: row.parcel_code,
    accountNumber: row.account_number,
    gisAcres: toNullableNumber(row.gis_acres),
    state: row.state,
    county: row.county,
    propertyName: row.property_name,
    tractName: row.tract_name,
    parcelStatus: row.parcel_status,
    taxProgram: row.tax_program,
    exemptionEnrollmentDate: row.exemption_enrollment_date,
    exemptionExpirationDate: row.exemption_expiration_date,
    exemptionEligibilityDate: row.exemption_eligibility_date,
    ownershipType: row.ownership_type,
    purchaseDate: row.purchase_date,
    ownerName: row.owner_name,
    description: row.description,
    fipParcelId: row.fip_parcel_id,
    notes: row.notes,
    landUseType: row.land_use_type,
    latitude: toNullableNumber(row.latitude),
    longitude: toNullableNumber(row.longitude),
    coordinateStatus: row.coordinate_status,
    sourceWorkbookPath: row.source_workbook_path,
    sourceSheet: row.source_sheet,
    sourceRowNumber: row.source_row_number,
    rawProperties: includeRawProperties ? row.raw_properties : undefined,
    geometry: row.geometry ?? null,
  };
}

function regridFeatureId(feature: Feature) {
  const value = feature.properties?.id;
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return null;
}

function classifyCoordinate(
  latitude: number | null,
  longitude: number | null,
  sourceLatitude: unknown,
  sourceLongitude: unknown,
): CoordinateStatus {
  if (latitude === null && longitude === null && !nullableText(sourceLatitude) && !nullableText(sourceLongitude)) {
    return "missing";
  }

  if (
    latitude !== null &&
    longitude !== null &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  ) {
    return "present";
  }

  return "invalid";
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

function normalizeIdentifier(value: unknown): string | null {
  const text = nullableText(value);
  return text ? text.replace(/\.0+$/, "") : null;
}

function normalizeRawValue(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value === undefined ? null : value;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
