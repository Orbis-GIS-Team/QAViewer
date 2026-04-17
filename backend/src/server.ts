import { config } from "./config.js";
import { createApp } from "./app.js";
import { pool, waitForDatabase, withClient, withTransaction } from "./lib/db.js";
import { ensureSchema } from "./lib/schema.js";
import { ensureSeedData } from "./lib/seed.js";

async function bootstrap(): Promise<void> {
  await waitForDatabase();
  await withClient(ensureSchema);
  await withTransaction(ensureSeedData);

  const app = createApp();

  app.listen(config.apiPort, config.apiHost, () => {
    console.log(`API listening on http://${config.apiHost}:${config.apiPort}`);
  });
}

bootstrap()
  .catch((error) => {
    console.error("Failed to start API", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Keep the pool open while the server is running.
    if (process.exitCode) {
      await pool.end();
    }
  });
