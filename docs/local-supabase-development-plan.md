# Local Development With Supabase Data Plan

Created: 2026-05-08

## Purpose

Make QAViewer work locally while using Supabase as the durable database. This lets development continue against production-like data before the Render application deployment is complete.

This is the bridge between Supabase data migration and Render deployment.

Related plans:

- `docs/supabase-data-migration-plan.md`
- `docs/render-supabase-deployment-plan.md`
- `docs/prepared-data-multitenant-postgres-plan.md`

## Target State

- Local backend and frontend run normally.
- Local backend connects to Supabase Postgres/PostGIS.
- Local startup uses `STARTUP_DATA_MODE=validate`.
- Developers can optionally run Docker PostGIS for isolated local testing.
- There is one clear `.env` profile for Supabase-backed local development.

## Scope

In scope:

- Local `.env` conventions.
- Supabase database connectivity.
- Local API and frontend workflow.
- Local validation and smoke tests.
- Documentation for switching between Docker PostGIS and Supabase.

Out of scope:

- Render deployment.
- Multi-tenant authorization.
- Full Supabase Storage migration, unless already completed by the data migration phase.

## Environment Profiles

### Local Docker Prepared Database

Used when the developer wants everything local:

```text
DATABASE_URL=postgres://qaviewer:qaviewer@localhost:5432/qaviewer
STARTUP_DATA_MODE=validate
DEMO_MODE=true
```

The local Docker database must already contain the prepared QAViewer data. Runtime startup does not rebuild it from archived source assets.

### Local App Against Supabase

Used for production-like local development:

```text
DATABASE_URL=<supabase-pooled-or-direct-dev-connection>
DATABASE_SSL_REJECT_UNAUTHORIZED=false
STARTUP_DATA_MODE=validate
DEMO_MODE=false
FRONTEND_ORIGIN=http://localhost:5173
```

For local long-running Node development, the direct connection can work. For deployed Render runtime, use the runtime connection string selected for the API service.
The backend expects an owner/service database connection. RLS is enabled on public runtime tables to keep accidental Supabase Data API access closed; app authorization remains in the Express API.

Current dev proof target:

```text
Supabase project: QAViewer Dev
Project ref: lfkuwbcmdlhkefnmdcsj
Region: us-east-1
```

Use the Supabase session pooler connection string only for controlled restore/migration work when the direct host is IPv6-only from the local machine or Docker:

```bash
cd backend
SUPABASE_DIRECT_DATABASE_URL="<supabase-direct-url>" npm run db:restore:supabase
```

The restore helper defaults to `PREPARED_RESTORE_MODE=app-data` after migrations have created the Supabase schema.

Use `DATABASE_URL` for validation and runtime:

```bash
cd backend
DATABASE_URL="<supabase-runtime-or-direct-url>" npm run db:validate
DATABASE_URL="<supabase-runtime-or-direct-url>" npm run db:counts
npm run dev
```

## Implementation Steps

### 1. Add Env Documentation

Update `.env.example` to document:

- local Docker values
- local Supabase values
- Render production values

Do not commit real Supabase credentials.

### 2. Run Migrations Against Supabase

Apply the SQL files in `supabase/migrations/` to the Supabase project before restoring data. The current dev project has already applied:

- `20260519151703_enable_postgis_pg_trgm`
- `20260519152255_baseline_schema`
- `20260519152351_enable_runtime_table_rls`

### 3. Restore Current Single-Tenant Data

Restore the prepared database dump with the repo helper:

```bash
cd backend
SUPABASE_DIRECT_DATABASE_URL="<supabase-session-pooler-or-direct-url>" npm run db:restore:supabase
DATABASE_URL="<supabase-runtime-url>" npm run db:validate
DATABASE_URL="<supabase-runtime-url>" npm run db:counts
```

Confirm:

- question area count matches local expected count
- land records count matches expected count
- management areas count matches expected count
- Atlas and tax parcel support table counts match the prepared dump

### 4. Run Local Backend Against Supabase

```bash
cd backend
npm run dev
```

Expected behavior:

- API starts without reading source GIS/workbook/document folders.
- `/api/health` returns OK.
- startup fails clearly if migrations or data are missing.

### 5. Run Local Frontend Against Local Backend

```bash
cd frontend
npm run dev
```

Use:

```text
VITE_API_BASE_URL=http://localhost:3001/api
```

### 6. Verify Main Workflows

Check:

- login
- session refresh
- question area list
- map bounds/layer queries
- question area detail
- comments
- status updates
- admin users
- Atlas panel
- tax parcel panel
- export
- document metadata/download behavior depending on storage migration state

### 7. Add Smoke Test Target

Extend or document smoke tests so they can target Supabase-backed local API:

```bash
cd backend
QA_SMOKE_API_URL=http://localhost:3001/api npm run test:smoke
```

## Acceptance Criteria

- Developer can run local frontend/backend against Supabase without Docker PostGIS.
- Developer can still run a local Docker database when it contains prepared data.
- Runtime startup in Supabase mode does not run ETL.
- Smoke tests pass against Supabase-backed local API.
- Docs clearly explain which environment variables to use.

## Risks

- Local changes could accidentally touch shared Supabase data if separate dev/staging/prod projects are not used.
- Direct database credentials need careful handling.
- Without multi-tenancy, local Supabase should be treated as a single-tenant staging/pilot database.

## Recommended Safety Rules

- Use separate Supabase projects for development/staging and production when budget allows.
- Do not point local development at production client data unless explicitly needed.
- Keep destructive loader commands out of normal `npm run dev`.
- Require confirmation or explicit flags for any data replacement command.

## Handoff To Multi-Tenant Work

After local Supabase development and Render deployment are stable, start the multi-tenant implementation from `docs/prepared-data-multitenant-postgres-plan.md`.
