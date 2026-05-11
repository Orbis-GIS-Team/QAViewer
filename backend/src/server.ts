import { config } from "./config.js";
import { createApp } from "./app.js";
import { pool, waitForDatabase, withClient } from "./lib/db.js";
import { runStartupDatabaseStep } from "./lib/startupDatabase.js";

async function bootstrap(): Promise<void> {
  await waitForDatabase();
  await withClient(runStartupDatabaseStep);

  const app = createApp();

  app.listen(config.apiPort, config.apiHost, () => {
    console.log(
      `API listening on http://${config.apiHost}:${config.apiPort} (STARTUP_DATA_MODE=${config.startupDataMode})`,
    );
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
