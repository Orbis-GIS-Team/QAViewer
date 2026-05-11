import { pool, waitForDatabase, withClient } from "../lib/db.js";
import { validatePreparedDatabase } from "../lib/startupDatabase.js";

async function main(): Promise<void> {
  await waitForDatabase();
  await withClient(validatePreparedDatabase);
  console.log("Prepared database validation passed.");
}

main()
  .catch((error) => {
    console.error("Prepared database validation failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
