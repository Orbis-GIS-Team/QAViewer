# Supabase Data Migration and Runtime ETL Removal Plan

Created: 2026-05-08

## Purpose

Move QAViewer's durable runtime data into Supabase Postgres/PostGIS and stop the API from rebuilding application data during startup.

This is the first cloud migration step. The goal is not to make the application multi-tenant yet; it is to make the current single-tenant application run against a persistent Supabase database that already contains prepared data.

Related long-term plan: `docs/prepared-data-multitenant-postgres-plan.md`.

## Current Problem

The backend currently treats startup as both application boot and ETL:

- `backend/src/server.ts` waits for Postgres, creates schema, and calls `ensureSeedData`.
- `backend/src/lib/seed.ts` seeds demo users, standardized GeoJSON data, Atlas workbook data, tax parcel data, document manifests, and comments.
- Runtime startup depends on repo-local folders such as `data/standardized/`, `LR_Documents/`, and `DataBuild/`.
- The app can fail to start when local source data changes, even though production should be reading an already-prepared database.

That is acceptable for local Docker demos, but it is not the right production boundary for Supabase.

## Target State

- Supabase Postgres/PostGIS is the durable runtime database.
- Runtime startup only validates database readiness.
- Data loading is explicit and operator-driven.
- Existing seed and import logic remains available for local/demo/import commands during transition.
- The current single-tenant app continues to work before the multi-tenant refactor.

## Scope

In scope:

- Supabase database setup.
- PostGIS and `pg_trgm` enablement.
- Migration framework.
- Production startup validation mode.
- Explicit CLI commands for seeding/loading.
- Single-tenant data import into Supabase.
- Documentation for local and cloud database workflows.

Out of scope:

- Multi-tenant authorization.
- Vercel deployment.
- Supabase Storage document migration, except for documenting the handoff point.
- Supabase Auth/RLS adoption.

## Implementation Steps

### 1. Create Supabase Project

- Create a Supabase project for QAViewer.
- Enable PostGIS.
- Enable `pg_trgm`.
- Store these secrets outside the repo:
  - `DATABASE_URL`
  - Supabase direct connection string for migrations, if needed.
  - Supabase pooled connection string for serverless/API runtime.

### 2. Add Migration Framework

- Add `backend/migrations/`.
- Add a `schema_migrations` table.
- Move schema from `backend/src/lib/schema.ts` into a baseline migration.
- Include extensions, tables, constraints, and indexes.
- Add:

```bash
cd backend
npm run db:migrate
```

Recommended first migrations:

```text
001_extensions.sql
002_baseline_schema.sql
003_runtime_validation_metadata.sql
```

### 3. Split Startup Modes

Add a production-safe config flag:

```text
STARTUP_DATA_MODE=validate|legacy-seed
```

Behavior:

- `validate`: startup checks database readiness only.
- `legacy-seed`: current Docker/local demo behavior.

Recommended defaults:

- Docker/local demo: `legacy-seed`.
- Supabase/cloud: `validate`.

### 4. Add Runtime Database Validation

Create a validator that checks:

- database connectivity
- required extensions
- required tables
- at least one usable admin user
- question area tables contain data
- document metadata tables exist

The validator should fail with a clear operational message, not start hidden ETL.

### 5. Convert Seed Logic Into CLI Commands

Preserve current import code, but run it intentionally:

```bash
npm run db:seed:demo
npm run db:load:standardized -- --manifest ../data/standardized/manifest.json
npm run db:load:atlas -- --workbook ../Combined_LR_Upload_First3Tabs.xlsx --documents ../LR_Documents
npm run db:load:tax-parcels -- --source ../DataBuild/pa_warren_with_report_data.shp --bills ../DataBuild/TaxBills
npm run db:validate
```

The first implementation can keep these as TypeScript scripts that reuse existing loader functions.

### 6. Load Supabase With Current Dataset

- Run migrations against Supabase.
- Run import commands once.
- Confirm row counts match local Docker database.
- Confirm QAViewer can authenticate, load question areas, overlays, Atlas data, tax parcels, comments, and document metadata.

### 7. Update Documentation

Update:

- `README.md`
- `.env.example`
- `AGENTS.md`
- `docs/dataset-contract.md`
- `docs/prepared-data-multitenant-postgres-plan.md` if implementation decisions diverge

## Acceptance Criteria

- Production-like startup does not read `data/standardized`, `Combined_LR_Upload_First3Tabs.xlsx`, `LR_Documents`, `DataBuild`, or tax bill folders.
- Fresh Supabase database can be created by running migrations and explicit load commands.
- Current single-tenant app works against Supabase Postgres/PostGIS.
- Local Docker demo still works through explicit legacy seeding.
- Changed local source data cannot break API startup in Supabase mode.

## Risks

- Existing schema creation is embedded in code and may require careful baseline migration extraction.
- Some loader behavior assumes local filesystem paths.
- Supabase serverless/API runtime should use a pooled connection string to avoid exhausting database connections.
- Document bytes still need a later storage migration; this phase only makes database state durable.

## Handoff To Next Plan

After this plan is complete, the app should be ready for Vercel implementation work because the backend no longer depends on local ETL or local seed folders during startup.
