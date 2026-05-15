import fs from "node:fs/promises";

import type { PoolClient, QueryResultRow } from "pg";

import { config } from "../config.js";
import { ROLES } from "./rbac.js";

type Queryable = {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
};

const REQUIRED_TABLES = [
  "users",
  "question_areas",
  "land_records",
  "management_areas",
  "atlas_land_records",
  "atlas_documents",
  "atlas_document_links",
  "atlas_featureless_docs",
  "atlas_document_manifest",
  "atlas_import_rejects",
  "tax_parcels",
  "property_tax_parcel_points",
  "tax_bill_manifest",
  "comments",
  "documents",
] as const;

const REQUIRED_DATA_TABLES = [
  "question_areas",
  "land_records",
  "management_areas",
] as const;

const REQUIRED_COLUMNS: Record<string, readonly string[]> = {
  property_tax_parcel_points: ["coordinate_status", "geom"],
  question_areas: ["actionability_state"],
  land_records: [
    "objectid",
    "state",
    "county",
    "deedacres",
    "tractkey",
    "gisacres",
    "lr_number",
    "lr_type",
    "taxparcelnum",
    "l_desc",
    "fips",
    "docnumber",
    "source",
    "sourcepageno",
    "doctype",
    "lr_status",
    "current_owner",
    "previous_owner",
    "acq_date",
    "desc_type",
    "remark",
    "keyword",
    "docname",
    "trs",
    "lr_specs",
    "tax_confirm",
    "merge_src",
    "oldlrnum",
    "propertyname",
    "fundname",
    "regionname",
    "shape_length",
    "shape_area",
    "geom",
  ],
};

const OPTIONAL_DATA_GROUPS = [
  {
    name: "Atlas",
    tables: ["atlas_land_records", "atlas_documents", "atlas_document_manifest"],
  },
  {
    name: "tax parcel",
    tables: ["tax_parcels", "tax_bill_manifest", "property_tax_parcel_points"],
  },
] as const;

export async function runStartupDatabaseStep(client: PoolClient): Promise<void> {
  await fs.mkdir(config.uploadsDir, { recursive: true });
  await validatePreparedDatabase(client);
}

export async function validatePreparedDatabase(client: Queryable): Promise<void> {
  await assertPostgisInstalled(client);
  await assertTablesExist(client);
  await assertRequiredColumnsExist(client);
  await assertUsersRoleConstraintIsCurrent(client);
  await assertRequiredDataExists(client);
  await assertAdminUserExists(client);
  await warnAboutOptionalData(client);
}

async function assertPostgisInstalled(client: Queryable): Promise<void> {
  const result = await client.query<{ installed: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'postgis'
    ) AS installed
  `);

  if (!result.rows[0]?.installed) {
    throw new Error(
      "Database is reachable but PostGIS is not installed. Restore the prepared PostGIS database or enable the postgis extension before starting QAViewer in validate mode.",
    );
  }
}

async function assertTablesExist(client: Queryable): Promise<void> {
  const result = await client.query<{ table_name: string; exists: boolean }>(
    `
      SELECT table_name, to_regclass('public.' || table_name) IS NOT NULL AS exists
      FROM unnest($1::text[]) AS table_name
    `,
    [[...REQUIRED_TABLES]],
  );
  const missing = result.rows.filter((row) => !row.exists).map((row) => row.table_name);

  if (missing.length > 0) {
    throw new Error(
      [
        `Database is reachable but required runtime tables are missing: ${missing.join(", ")}.`,
        "Restore the prepared PostGIS dataset or run the schema/load commands before starting QAViewer in validate mode.",
      ].join(" "),
    );
  }
}

async function assertRequiredColumnsExist(client: Queryable): Promise<void> {
  const entries = Object.entries(REQUIRED_COLUMNS);
  if (entries.length === 0) {
    return;
  }

  const result = await client.query<{ table_name: string; column_name: string }>(
    `
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [entries.map(([tableName]) => tableName)],
  );
  const existing = new Set(result.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = entries.flatMap(([tableName, columns]) =>
    columns
      .filter((column) => !existing.has(`${tableName}.${column}`))
      .map((column) => `${tableName}.${column}`),
  );

  if (missing.length > 0) {
    throw new Error(
      [
        `Database is reachable but required runtime columns are missing: ${missing.join(", ")}.`,
        "Run the explicit schema/data update commands or restore a prepared database with the current schema before starting QAViewer.",
      ].join(" "),
    );
  }
}

async function assertUsersRoleConstraintIsCurrent(client: Queryable): Promise<void> {
  const result = await client.query<{ check_clause: string | null }>(
    `
      SELECT cc.check_clause
      FROM information_schema.table_constraints tc
      JOIN information_schema.check_constraints cc
        ON cc.constraint_catalog = tc.constraint_catalog
       AND cc.constraint_schema = tc.constraint_schema
       AND cc.constraint_name = tc.constraint_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'users'
        AND tc.constraint_name = 'users_role_check'
    `,
  );

  const checkClause = result.rows[0]?.check_clause ?? "";
  const missingRoles = ROLES.filter((role) => !checkClause.includes(`'${role}'`));

  if (missingRoles.length > 0) {
    throw new Error(
      [
        `Database is reachable but users_role_check is missing supported roles: ${missingRoles.join(", ")}.`,
        "Run npm run db:apply-user-roles from backend or restore a prepared database with the current user-role schema before starting QAViewer.",
      ].join(" "),
    );
  }
}

async function assertRequiredDataExists(client: Queryable): Promise<void> {
  const counts = await getTableCounts(client, [...REQUIRED_DATA_TABLES]);
  const emptyTables = REQUIRED_DATA_TABLES.filter((table) => (counts[table] ?? 0) === 0);

  if (emptyTables.length > 0) {
    throw new Error(
      [
        `Database is reachable but required prepared data is empty: ${emptyTables.join(", ")}.`,
        "Restore the prepared PostGIS dataset or run the explicit data load commands before starting QAViewer in validate mode.",
      ].join(" "),
    );
  }
}

async function assertAdminUserExists(client: Queryable): Promise<void> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM users WHERE role = 'admin'`,
  );

  if (Number(result.rows[0]?.count ?? 0) === 0) {
    throw new Error(
      "Database is reachable but no admin user exists. Restore users with the prepared dataset or create an admin before starting QAViewer in validate mode.",
    );
  }
}

async function warnAboutOptionalData(client: Queryable): Promise<void> {
  for (const group of OPTIONAL_DATA_GROUPS) {
    const counts = await getTableCounts(client, [...group.tables]);
    const populatedTables = group.tables.filter((table) => (counts[table] ?? 0) > 0);

    if (populatedTables.length > 0 && populatedTables.length < group.tables.length) {
      console.warn(
        [
          `Startup validation warning: database has partially populated ${group.name} prepared data.`,
          `Related features may have incomplete results. Tables checked: ${group.tables.join(", ")}.`,
        ].join(" "),
      );
      continue;
    }

    if (populatedTables.length === 0) {
      console.warn(
        `Startup validation warning: ${group.name} prepared data is empty; related overlays or document panels may have no results.`,
      );
    }
  }
}

async function getTableCounts(
  client: Queryable,
  tables: readonly string[],
): Promise<Record<string, number>> {
  const fragments = tables.map(
    (table, index) => `SELECT $${index + 1}::text AS table_name, COUNT(*)::text AS count FROM ${table}`,
  );
  const result = await client.query<{ table_name: string; count: string }>(
    fragments.join(" UNION ALL "),
    [...tables],
  );

  return Object.fromEntries(result.rows.map((row) => [row.table_name, Number(row.count)]));
}
