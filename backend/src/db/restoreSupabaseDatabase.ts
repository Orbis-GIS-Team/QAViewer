import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Client } from "pg";

const repoRoot = path.resolve(process.cwd(), "..");
const dumpPath = path.resolve(
  process.cwd(),
  process.env.PREPARED_DUMP_PATH ?? path.join(repoRoot, "qaviewer-prepared.dump"),
);
const databaseUrl = process.env.SUPABASE_DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const pgRestoreBin = process.env.PG_RESTORE_BIN ?? "pg_restore";
const restoreMode = process.env.PREPARED_RESTORE_MODE ?? "app-data";
const pgRestoreDockerImage = process.env.PG_RESTORE_DOCKER_IMAGE ?? "postgis/postgis:16-3.4";
const pgRestoreDockerDns = (process.env.PG_RESTORE_DOCKER_DNS ?? "1.1.1.1,8.8.8.8")
  .split(",")
  .map((server) => server.trim())
  .filter(Boolean);

const APP_TABLES = [
  "users",
  "question_areas",
  "seed_metadata",
  "land_records",
  "management_areas",
  "atlas_land_records",
  "atlas_documents",
  "atlas_document_links",
  "atlas_featureless_docs",
  "atlas_document_manifest",
  "atlas_import_rejects",
  "tax_parcels",
  "tax_bill_manifest",
  "property_tax_parcel_points",
  "comments",
  "documents",
] as const;

function restoreArgs(targetDumpPath: string, table?: string): string[] {
  const modeArgs = restoreMode === "full"
    ? ["--clean", "--if-exists"]
    : restoreMode === "data-only" || restoreMode === "app-data"
      ? ["--data-only"]
      : undefined;

  if (!modeArgs) {
    throw new Error('Invalid PREPARED_RESTORE_MODE. Expected "app-data", "data-only", or "full".');
  }

  return [
    "--no-owner",
    "--no-acl",
    "--exit-on-error",
    ...modeArgs,
    ...(table ? ["--table", table] : []),
    "--dbname",
    databaseUrl as string,
    targetDumpPath,
  ];
}

function buildClientConfig(targetDatabaseUrl: string): ConstructorParameters<typeof Client>[0] {
  const parsed = new URL(targetDatabaseUrl);
  const sslMode = parsed.searchParams.get("sslmode");
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("uselibpqcompat");

  const needsSsl =
    sslMode === "require" ||
    sslMode === "verify-ca" ||
    sslMode === "verify-full" ||
    parsed.hostname.endsWith(".supabase.co") ||
    parsed.hostname.includes(".pooler.supabase.com");

  if (!needsSsl || sslMode === "disable") {
    return {
      connectionString: parsed.toString(),
    };
  }

  return {
    connectionString: parsed.toString(),
    ssl: {
      rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true",
    },
  };
}

async function runCommand(command: string, args: string[]): Promise<number | null> {
  const child = spawn(command, args, { stdio: "inherit" });

  return new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
}

async function runLocalPgRestore(table?: string): Promise<number | null> {
  return runCommand(pgRestoreBin, restoreArgs(dumpPath, table));
}

async function runDockerPgRestore(table?: string): Promise<number | null> {
  const dumpDir = path.dirname(dumpPath);
  const dumpFile = path.basename(dumpPath);
  const containerDumpPath = `/dump/${dumpFile}`;

  console.log(`Local pg_restore was not found. Falling back to Docker image ${pgRestoreDockerImage}.`);

  return runCommand("docker", [
    "run",
    "--rm",
    ...pgRestoreDockerDns.flatMap((server) => ["--dns", server]),
    "-v",
    `${dumpDir}:/dump:ro`,
    pgRestoreDockerImage,
    "pg_restore",
    ...restoreArgs(containerDumpPath, table),
  ]);
}

async function runRestore(table?: string): Promise<void> {
  let exitCode: number | null;
  try {
    exitCode = await runLocalPgRestore(table);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    exitCode = await runDockerPgRestore(table);
  }

  if (exitCode !== 0) {
    throw new Error(`pg_restore failed with exit code ${exitCode ?? "unknown"}.`);
  }
}

async function truncateAppTables(): Promise<void> {
  const client = new Client(buildClientConfig(databaseUrl as string));
  await client.connect();
  try {
    await client.query(`
      TRUNCATE TABLE ${APP_TABLES.map((table) => `public.${table}`).join(", ")}
      RESTART IDENTITY CASCADE
    `);
  } finally {
    await client.end();
  }
}

async function resetAppSequences(): Promise<void> {
  const client = new Client(buildClientConfig(databaseUrl as string));

  await client.connect();
  try {
    await client.query(`
      SELECT setval('public.users_id_seq', COALESCE((SELECT MAX(id) FROM public.users), 1), (SELECT COUNT(*) > 0 FROM public.users));
      SELECT setval('public.question_areas_id_seq', COALESCE((SELECT MAX(id) FROM public.question_areas), 1), (SELECT COUNT(*) > 0 FROM public.question_areas));
      SELECT setval('public.management_areas_id_seq', COALESCE((SELECT MAX(id) FROM public.management_areas), 1), (SELECT COUNT(*) > 0 FROM public.management_areas));
      SELECT setval('public.atlas_document_links_id_seq', COALESCE((SELECT MAX(id) FROM public.atlas_document_links), 1), (SELECT COUNT(*) > 0 FROM public.atlas_document_links));
      SELECT setval('public.atlas_document_manifest_id_seq', COALESCE((SELECT MAX(id) FROM public.atlas_document_manifest), 1), (SELECT COUNT(*) > 0 FROM public.atlas_document_manifest));
      SELECT setval('public.atlas_import_rejects_id_seq', COALESCE((SELECT MAX(id) FROM public.atlas_import_rejects), 1), (SELECT COUNT(*) > 0 FROM public.atlas_import_rejects));
      SELECT setval('public.tax_parcels_id_seq', COALESCE((SELECT MAX(id) FROM public.tax_parcels), 1), (SELECT COUNT(*) > 0 FROM public.tax_parcels));
      SELECT setval('public.property_tax_parcel_points_id_seq', COALESCE((SELECT MAX(id) FROM public.property_tax_parcel_points), 1), (SELECT COUNT(*) > 0 FROM public.property_tax_parcel_points));
      SELECT setval('public.comments_id_seq', COALESCE((SELECT MAX(id) FROM public.comments), 1), (SELECT COUNT(*) > 0 FROM public.comments));
      SELECT setval('public.documents_id_seq', COALESCE((SELECT MAX(id) FROM public.documents), 1), (SELECT COUNT(*) > 0 FROM public.documents));
    `);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  if (!databaseUrl) {
    throw new Error(
      "Set SUPABASE_DIRECT_DATABASE_URL to the Supabase direct connection string before restoring.",
    );
  }

  await fs.promises.access(dumpPath, fs.constants.R_OK);

  console.log(`Restoring prepared database dump from ${dumpPath}`);
  console.log(`Restore mode: ${restoreMode}`);
  console.log("Target: Supabase direct database URL from SUPABASE_DIRECT_DATABASE_URL or DATABASE_URL");

  if (restoreMode === "app-data") {
    console.log("Truncating QAViewer runtime tables before app-data restore.");
    await truncateAppTables();
    for (const table of APP_TABLES) {
      console.log(`Restoring table public.${table}`);
      await runRestore(table);
    }
    console.log("Resetting QAViewer runtime table sequences.");
    await resetAppSequences();
  } else {
    await runRestore();
  }

  console.log("Supabase restore complete. Run npm run db:validate with the same DATABASE_URL.");
}

main().catch((error) => {
  console.error("Supabase restore failed.", error);
  process.exitCode = 1;
});
