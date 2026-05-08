import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import type { PoolClient } from "pg";

import { config } from "../config.js";
import { ensureAtlasSeedData } from "./atlas.js";
import { hashPassword } from "./auth.js";
import { ensureTaxParcelSeedData } from "./taxParcels.js";
import { loadFeatureCollection, parseBoolean } from "./utils.js";

const DEMO_USERS = [
  {
    name: "Avery Counsel",
    email: "admin@qaviewer.local",
    password: "admin123!",
    role: "admin",
  },
  {
    name: "Cameron Client",
    email: "client@qaviewer.local",
    password: "client123!",
    role: "client",
  },
];

const SEED_TABLES = [
  "question_areas",
  "land_records",
  "management_areas",
] as const;

const MANIFEST_METADATA_KEY = "generated_manifest_sha256";

async function tableCounts(client: PoolClient): Promise<Record<string, number>> {
  const result = await client.query<{ tbl: string; count: string }>(`
    SELECT tbl, count FROM (
      SELECT 'question_areas' AS tbl, COUNT(*)::text AS count FROM question_areas
      UNION ALL
      SELECT 'land_records', COUNT(*)::text FROM land_records
      UNION ALL
      SELECT 'management_areas', COUNT(*)::text FROM management_areas
    ) sub
  `);
  return Object.fromEntries(result.rows.map((r) => [r.tbl, Number(r.count)]));
}

async function currentManifestHash(): Promise<string> {
  const manifest = await fs.readFile(path.join(config.seedDir, "manifest.json"));
  return crypto.createHash("sha256").update(manifest).digest("hex");
}

async function storedManifestHash(client: PoolClient): Promise<string | null> {
  const result = await client.query<{ value: string }>(
    `SELECT value FROM seed_metadata WHERE key = $1`,
    [MANIFEST_METADATA_KEY],
  );
  return result.rows[0]?.value ?? null;
}

async function storeManifestHash(client: PoolClient, hash: string): Promise<void> {
  await client.query(
    `
      INSERT INTO seed_metadata (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [MANIFEST_METADATA_KEY, hash],
  );
}

function seedMismatchMessage(reason: string): string {
  return [
    reason,
    "The standardized GIS seed assets no longer match the populated PostGIS seed metadata.",
    "For local development, reset and reseed the database explicitly, for example: docker compose down -v && docker compose up --build.",
  ].join(" ");
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function ensureSeedData(client: PoolClient): Promise<void> {
  await fs.mkdir(config.uploadsDir, { recursive: true });

  await seedUsers(client);
  await ensureStandardSeedData(client);
  await ensureAtlasSeedData(client);
  await ensureTaxParcelSeedData(client);
  await seedComments(client);
}

async function ensureStandardSeedData(client: PoolClient): Promise<void> {
  const manifestHash = await currentManifestHash();
  const counts = await tableCounts(client);
  const allPopulated = SEED_TABLES.every((t) => (counts[t] ?? 0) > 0);
  const somePopulated = SEED_TABLES.some((t) => (counts[t] ?? 0) > 0);
  if (allPopulated) {
    const storedHash = await storedManifestHash(client);
    if (!storedHash) {
      throw new Error(seedMismatchMessage("Seed metadata is missing for an already-populated database."));
    }
    if (storedHash !== manifestHash) {
      throw new Error(seedMismatchMessage("Standardized seed manifest hash changed."));
    }
    return;
  }

  if (somePopulated) {
    throw new Error(seedMismatchMessage("Seed tables are partially populated."));
  }

  const questionAreas = await loadFeatureCollection("question_areas.geojson");
  const landRecords = await loadFeatureCollection("land_records.geojson");
  const managementAreas = await loadFeatureCollection("management_areas.geojson");

  if ((counts["question_areas"] ?? 0) === 0) {
    for (const feature of questionAreas.features) {
      await insertQuestionArea(client, feature);
    }
  }

  if ((counts["land_records"] ?? 0) === 0) {
    for (const feature of landRecords.features) {
      await insertLandRecord(client, feature);
    }
  }

  if ((counts["management_areas"] ?? 0) === 0) {
    for (const feature of managementAreas.features) {
      await insertManagementArea(client, feature);
    }
  }

  await storeManifestHash(client, manifestHash);
}

async function seedUsers(client: PoolClient): Promise<void> {
  if (!config.demoMode) {
    return;
  }

  for (const user of DEMO_USERS) {
    const passwordHash = await hashPassword(user.password);
    await client.query(
      `
        INSERT INTO users (name, email, password_hash, role)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (email) DO NOTHING
      `,
      [user.name, user.email, passwordHash, user.role],
    );
  }
}

async function insertQuestionArea(
  client: PoolClient,
  feature: Feature<Geometry, GeoJsonProperties>,
): Promise<void> {
  if (!feature.geometry) {
    return;
  }
  const properties = feature.properties ?? {};
  await client.query(
    `
      INSERT INTO question_areas (
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
        search_keywords,
        raw_properties,
        geom
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23::jsonb,
        ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($24), 4326))
      )
    `,
    [
      properties.code,
      properties.source_layer,
      properties.status,
      properties.severity,
      properties.title,
      properties.summary,
      properties.description,
      properties.county,
      properties.state,
      properties.parcel_code,
      properties.owner_name,
      properties.property_name,
      properties.tract_name,
      properties.fund_name,
      properties.land_services,
      parseNullableNumber(properties.tax_bill_acres),
      parseNullableNumber(properties.gis_acres),
      parseBoolean(properties.exists_in_legal_layer),
      parseBoolean(properties.exists_in_management_layer),
      parseBoolean(properties.exists_in_client_tabular_bill_data),
      properties.assigned_reviewer,
      properties.search_keywords,
      JSON.stringify(properties),
      JSON.stringify(feature.geometry),
    ],
  );
}

async function insertLandRecord(
  client: PoolClient,
  feature: Feature<Geometry, GeoJsonProperties>,
): Promise<void> {
  if (!feature.geometry) {
    return;
  }
  const properties = feature.properties ?? {};
  await client.query(
    `
      INSERT INTO land_records (
        state,
        county,
        parcel_number,
        deed_acres,
        gis_acres,
        fips,
        description,
        record_type,
        tract_key,
        record_number,
        document_number,
        source_name,
        source_page_number,
        document_type,
        record_status,
        current_owner,
        previous_owner,
        acquisition_date,
        description_type,
        remark,
        keyword,
        document_name,
        trs,
        record_specs,
        tax_confirmed,
        merge_source,
        old_record_number,
        property_name,
        fund_name,
        region_name,
        raw_properties,
        geom
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31::jsonb, ST_Multi(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($32), 4326)))
      )
    `,
    [
      properties.state,
      properties.county,
      properties.parcel_number,
      parseNullableNumber(properties.deed_acres),
      parseNullableNumber(properties.gis_acres),
      properties.fips,
      properties.description,
      properties.record_type,
      properties.tract_key,
      properties.record_number,
      properties.document_number,
      properties.source_name,
      properties.source_page_number,
      properties.document_type,
      properties.record_status,
      properties.current_owner,
      properties.previous_owner,
      properties.acquisition_date,
      properties.description_type,
      properties.remark,
      properties.keyword,
      properties.document_name,
      properties.trs,
      properties.record_specs,
      parseBoolean(properties.tax_confirmed),
      properties.merge_source,
      properties.old_record_number,
      properties.property_name,
      properties.fund_name,
      properties.region_name,
      JSON.stringify(properties),
      JSON.stringify(feature.geometry),
    ],
  );
}

async function insertManagementArea(
  client: PoolClient,
  feature: Feature<Geometry, GeoJsonProperties>,
): Promise<void> {
  if (!feature.geometry) {
    return;
  }
  const properties = feature.properties ?? {};
  await client.query(
    `
      INSERT INTO management_areas (
        effective_date,
        status,
        property_code,
        property_name,
        portfolio,
        fund_name,
        original_acquisition_date,
        full_disposition_date,
        management_type,
        country,
        investment_manager,
        property_coordinates,
        region,
        state,
        county,
        business_unit,
        crops,
        tillable_acres,
        gross_acres,
        arable_hectares,
        gross_hectares,
        gis_acres,
        gis_hectares,
        raw_properties,
        geom
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24::jsonb,
        ST_Multi(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($25), 4326)))
      )
    `,
    [
      properties.effective_date,
      properties.status,
      properties.property_code,
      properties.property_name,
      properties.portfolio,
      properties.fund_name,
      properties.original_acquisition_date,
      properties.full_disposition_date,
      properties.management_type,
      properties.country,
      properties.investment_manager,
      properties.property_coordinates,
      properties.region,
      properties.state,
      properties.county,
      properties.business_unit,
      properties.crops,
      parseNullableNumber(properties.tillable_acres),
      parseNullableNumber(properties.gross_acres),
      parseNullableNumber(properties.arable_hectares),
      parseNullableNumber(properties.gross_hectares),
      parseNullableNumber(properties.gis_acres),
      parseNullableNumber(properties.gis_hectares),
      JSON.stringify(properties),
      JSON.stringify(feature.geometry),
    ],
  );
}

async function seedComments(client: PoolClient): Promise<void> {
  const existingComments = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM comments`,
  );

  if (Number(existingComments.rows[0]?.count ?? 0) > 0) {
    return;
  }

  const { rows: users } = await client.query<{ id: number; email: string }>(
    `SELECT id, email FROM users WHERE email IN ($1, $2) ORDER BY email`,
    ["admin@qaviewer.local", "client@qaviewer.local"],
  );
  const userMap = new Map(users.map((user) => [user.email, user.id]));

  const { rows: questionAreas } = await client.query<{ id: number; code: string; title: string }>(
    `SELECT id, code, title FROM question_areas ORDER BY code ASC LIMIT 3`,
  );

  const cannedComments = [
    "Initial review queued. Compare the tax boundary against deed retracement and management data before sign-off.",
    "Ownership reference looks consistent, but the mapped boundary conflict needs a second pass before sign-off.",
    "Document request opened for legal support. Attach deed retracement or management source evidence when available.",
  ];

  for (const [index, area] of questionAreas.entries()) {
    const authorId =
      index % 2 === 0
        ? userMap.get("client@qaviewer.local")
        : userMap.get("admin@qaviewer.local");

    if (!authorId) {
      continue;
    }

    await client.query(
      `INSERT INTO comments (question_area_id, author_id, body) VALUES ($1, $2, $3)`,
      [area.id, authorId, cannedComments[index] ?? "Review note added during seed load."],
    );
  }
}
