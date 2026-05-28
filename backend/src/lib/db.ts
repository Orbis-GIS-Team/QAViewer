import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

import { config } from "../config.js";

function buildPoolConfig(): ConstructorParameters<typeof Pool>[0] {
  const parsed = new URL(config.databaseUrl);
  const sslMode = parsed.searchParams.get("sslmode");
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("uselibpqcompat");
  const options = parsed.searchParams.get("options");
  const searchPathOption = "-c search_path=public,extensions";

  if (!options?.includes("search_path=")) {
    parsed.searchParams.set("options", options ? `${options} ${searchPathOption}` : searchPathOption);
  }

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

  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true";

  return {
    connectionString: parsed.toString(),
    ssl: {
      rejectUnauthorized,
    },
  };
}

export const pool = new Pool(buildPoolConfig());

export async function query<T extends QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, values);
}

export async function withClient<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await handler(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await handler(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function waitForDatabase(maxAttempts = 30, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
