import dotenv from "dotenv";
import path from "node:path";
import type { PoolClient } from "pg";
import { Pool } from "pg";

dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://qaviewer:qaviewer@localhost:5432/qaviewer",
});

const ACTIONABILITY_STATES = ["normal", "high_pain", "no_parcel_data", "in_progress"] as const;

async function applyActionabilityStates(client: PoolClient): Promise<void> {
  await client.query("BEGIN");

  try {
    await client.query(`
      ALTER TABLE question_areas
      ADD COLUMN IF NOT EXISTS actionability_state TEXT
    `);

    await client.query(`
      ALTER TABLE question_areas
      DROP CONSTRAINT IF EXISTS question_areas_actionability_state_check
    `);

    await client.query(
      `
        UPDATE question_areas
        SET actionability_state = ($1::text[])[1 + floor(random() * array_length($1::text[], 1))::int]
        WHERE actionability_state IS NULL
          OR actionability_state <> ALL($1::text[])
      `,
      [[...ACTIONABILITY_STATES]],
    );

    await client.query(`
      ALTER TABLE question_areas
      ALTER COLUMN actionability_state SET DEFAULT 'normal',
      ALTER COLUMN actionability_state SET NOT NULL
    `);

    await client.query(`
      ALTER TABLE question_areas
      ADD CONSTRAINT question_areas_actionability_state_check
      CHECK (actionability_state IN ('normal', 'high_pain', 'no_parcel_data', 'in_progress'))
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS question_areas_actionability_state_idx
      ON question_areas (actionability_state)
    `);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function withClient(callback: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await callback(client);
  } finally {
    client.release();
  }
}

withClient(applyActionabilityStates)
  .then(() => {
    console.log("Question-area actionability_state column is ready.");
  })
  .catch((error) => {
    console.error("Failed to apply question-area actionability_state update.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
