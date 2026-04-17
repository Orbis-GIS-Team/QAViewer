# Backend Test Suite

**Isolation strategy: mock the `pg` Pool at the boundary.**

The `pg` Pool is instantiated at module load in `src/lib/db.ts`. Since a live `DATABASE_URL_TEST` would require PostGIS and seed data, all tests mock `pg` via `vi.mock('pg')` and stub `Pool.prototype.query` per-test. This makes every test self-contained and runnable without any database. Tests that need DB access (e.g. full integration) are out of scope and should be added once `DATABASE_URL_TEST` is available.

Set `JWT_SECRET=test-secret-for-vitest` in `.env.test` (or inline via `process.env`) before running if the default guard fires.
