import { pool, waitForDatabase } from "../lib/db.js";

const TABLES = [
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
  "tax_bill_manifest",
  "property_tax_parcel_points",
  "comments",
  "documents",
] as const;

type CountRow = {
  table_name: string;
  count: string;
};

async function main(): Promise<void> {
  await waitForDatabase();

  const fragments = TABLES.map(
    (table, index) => `SELECT $${index + 1}::text AS table_name, COUNT(*)::text AS count FROM ${table}`,
  );
  const result = await pool.query<CountRow>(fragments.join(" UNION ALL "), [...TABLES]);
  const counts = new Map(result.rows.map((row) => [row.table_name, Number(row.count)]));

  console.log("QAViewer runtime table counts:");
  for (const table of TABLES) {
    console.log(`${table}: ${counts.get(table) ?? 0}`);
  }
}

main()
  .catch((error) => {
    console.error("Runtime count report failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
