// Set required env vars before any module is imported.
// This prevents config.ts from throwing on the JWT_SECRET guard.
process.env["JWT_SECRET"] = "test-secret-for-vitest-do-not-use-in-prod";
process.env["DATABASE_URL"] = "postgres://test:test@localhost:5432/test";
