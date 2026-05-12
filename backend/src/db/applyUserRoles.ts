import dotenv from "dotenv";
import path from "node:path";
import type { PoolClient } from "pg";
import { Pool } from "pg";

import { ROLES } from "../lib/rbac.js";

dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://qaviewer:qaviewer@localhost:5432/qaviewer",
});

const ROLE_SQL_LIST = ROLES.map((role) => `'${role}'`).join(", ");

async function applyUserRoles(client: PoolClient): Promise<void> {
  await client.query("BEGIN");

  try {
    await client.query(`
      ALTER TABLE users
      DROP CONSTRAINT IF EXISTS users_role_check
    `);

    await client.query(
      `
        UPDATE users
        SET role = 'other'
        WHERE role <> ALL($1::text[])
      `,
      [[...ROLES]],
    );

    await client.query(`
      ALTER TABLE users
      ADD CONSTRAINT users_role_check
      CHECK (role IN (${ROLE_SQL_LIST}))
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

withClient(applyUserRoles)
  .then(() => {
    console.log(`User role constraint is ready for roles: ${ROLES.join(", ")}`);
  })
  .catch((error) => {
    console.error("Failed to apply user role constraint update.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
