import { config } from "../config.js";
import { waitForDatabase, withTransaction, pool } from "../lib/db.js";
import { ensureSchema } from "../lib/schema.js";
import { importPropertyTaxParcelPointsFromWorkbook } from "../lib/propertyTaxParcelPoints.js";

waitForDatabase()
  .then(() => withTransaction(async (client) => {
    await ensureSchema(client);
    return importPropertyTaxParcelPointsFromWorkbook(client, config.propertyTaxParcelWorkbookPath);
  }))
  .then((result) => {
    console.log(
      [
        `Imported ${result.inserted} property tax parcel point records.`,
        `${result.withGeometry} records have valid coordinates.`,
        `${result.missingGeometry} records have missing coordinates.`,
        `${result.invalidGeometry} records have invalid coordinates.`,
      ].join(" "),
    );
  })
  .catch((error) => {
    console.error("Failed to import property tax parcel point records.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
