# Supabase Prepared Data Handoff and No-Rebuild Runtime Plan

Created: 2026-05-08

## Purpose

Define how prepared QAViewer data gets into Supabase and how the application runs against that durable Supabase data without rebuilding, reseeding, or re-importing source files on every startup.

This is the operational bridge between local data preparation and the deployed application.

Related plans:

- `docs/supabase-data-migration-plan.md`
- `docs/local-supabase-development-plan.md`
- `docs/vercel-application-deployment-plan.md`
- `docs/prepared-data-multitenant-postgres-plan.md`

## Core Principle

QAViewer runtime should consume prepared Supabase tables.

It should not parse source GIS packages, Excel workbooks, shapefiles, document folders, or standardized GeoJSON files during normal startup.

For the first Supabase migration, treat the currently populated local PostGIS database as the prepared dataset. The app does not need to prove the upstream ETL again during runtime migration. The immediate goal is to move the already-prepared runtime state into durable Supabase Postgres/PostGIS, then make the API validate and serve from that database.

## Target Flow

First migration flow:

```text
current populated local PostGIS database
  -> schema/data readiness check
  -> explicit dump/restore or controlled database copy
  -> persistent Supabase Postgres/PostGIS tables
  -> QAViewer API startup validation
  -> frontend/API read Supabase data
```

Longer-term prepared-package flow:

```text
source GIS/workbook/document package
  -> data preparation/validation
  -> prepared load package
  -> explicit Supabase import command
  -> persistent Supabase Postgres/PostGIS tables
  -> QAViewer API startup validation
  -> frontend/API read Supabase data
```

## Prepared Data Inputs

For the first single-tenant Supabase migration, the primary prepared input is the current populated PostGIS database. This includes the runtime tables already created and populated by the existing local Docker/PostGIS flow.

The repo-owned source assets remain useful as provenance and fallback reload inputs, but they should not be treated as normal runtime dependencies:

- `data/standardized/question_areas.geojson`
- `data/standardized/land_records.geojson`
- `data/standardized/management_areas.geojson`
- `data/standardized/manifest.json`
- Atlas workbook/document package, if included in this migration
- tax parcel shapefile/tax bill package, if included in this migration

Longer term, the source handoff should evolve into an explicit prepared-data package:

```text
prepared-package/
  manifest.json
  question_areas.geojson
  land_records.geojson
  management_areas.geojson
  atlas/
    records.csv
    documents.csv
    document_links.csv
    document_manifest.csv
  tax/
    parcels.geojson
    bill_manifest.csv
  documents/
    ...
```

## Supabase Database Setup

Before loading data:

1. Create Supabase project.
2. Enable required extensions:

```sql
create extension if not exists postgis;
create extension if not exists pg_trgm;
```

3. Run QAViewer migrations.
4. Confirm runtime tables exist.
5. Confirm no startup seed mode is required for the API to boot.

For the first proof, prefer copying the current prepared local PostGIS state into Supabase before rebuilding all import commands. A dump/restore path is acceptable if it preserves PostGIS geometries, indexes, lookup tables, comments, document metadata, users, and seed/import metadata needed by the current API.

Example operator-level flow:

```bash
pg_dump --format=custom --no-owner --no-acl <local-postgis-url> > qaviewer-prepared.dump
pg_restore --no-owner --no-acl --dbname <supabase-direct-url> qaviewer-prepared.dump
```

Exact commands should be adjusted for local Docker credentials, Supabase connection mode, and whether extensions/schema are created before restore.

## Import Command Design

After the database-copy path is working, add explicit import commands under `backend`:

```bash
npm run db:migrate
npm run db:load:standardized -- --manifest ../data/standardized/manifest.json
npm run db:load:atlas -- --workbook ../Combined_LR_Upload_First3Tabs.xlsx --documents ../LR_Documents
npm run db:load:tax-parcels -- --source ../DataBuild/pa_warren_with_report_data.shp --bills ../DataBuild/TaxBills
npm run db:validate
```

The first implementation can reuse existing loader code. The important change is that the loaders are run intentionally and are not called from `server.ts`.

These commands are still useful, but they are not the critical first step if the local PostGIS database is already accepted as the prepared dataset.

## Runtime Startup Modes

Add:

```text
STARTUP_DATA_MODE=validate|legacy-seed
```

### `validate`

Production and Supabase-backed local development.

Behavior:

- connect to database
- verify schema/migrations
- verify required tables
- verify required baseline data exists
- start API
- never read source data folders
- never import or replace application data

### `legacy-seed`

Local Docker demo only.

Behavior:

- preserve current local seed/reseed behavior
- import repo-owned data into local Docker PostGIS
- remain useful for demos and isolated development

## Application Changes

Update `backend/src/server.ts` from the current pattern:

```ts
await waitForDatabase();
await withClient(ensureSchema);
await withTransaction(ensureSeedData);
```

To the target pattern:

```ts
await waitForDatabase();
await runStartupDatabaseStep();
```

Where `runStartupDatabaseStep()` does:

- `validate`: run readiness checks only
- `legacy-seed`: run local demo schema/seed compatibility path

## Validation Checks

`db:validate` and runtime validation should check:

- database connection works
- PostGIS is installed
- required migrations have run
- required tables exist
- required runtime columns exist, including `question_areas.actionability_state`
- `question_areas` contains rows
- `land_records` contains rows when the overlay is expected
- `management_areas` contains rows when the overlay is expected
- admin user exists or an admin creation flow has run
- optional Atlas/tax tables contain rows if enabled
- database state matches the expected prepared-data baseline, either through migrations/schema version, a captured restore manifest, or existing seed/import metadata

The validation error should explain the missing step, for example:

```text
Database is reachable but question_areas is empty.
Restore the prepared PostGIS dataset or run npm run db:load:standardized before starting QAViewer in validate mode.
```

Older prepared databases can be updated for actionability symbology with:

```bash
cd backend
npm run db:apply-actionability
```

## Data Replacement Rules

For the first single-tenant migration:

- loads should be explicit
- database copies/restores should be explicit
- destructive replacement should require a flag such as `--replace`
- replacement commands should print affected tables and require confirmation outside CI
- restoring over an existing Supabase database should require an operator decision and should not be hidden inside API startup
- normal API startup must never replace data

Future multi-tenant version:

- load into tenant-scoped tables
- record a `data_releases` row
- activate a release explicitly
- keep reject records and source hashes

## Local Development Against Supabase

Local `.env` for Supabase-backed runtime:

```text
DATABASE_URL=<supabase-connection-string>
STARTUP_DATA_MODE=validate
DEMO_MODE=false
FRONTEND_ORIGIN=http://localhost:5173
```

Run:

```bash
cd backend
npm run dev

cd ../frontend
npm run dev
```

Expected result:

- backend starts without Docker PostGIS
- backend starts without reading source data folders
- frontend hits local API
- local API reads Supabase data

The first Supabase-backed local test should use the restored prepared database as-is. Any later data preparation improvements should be validated as separate import/release work, not mixed into runtime boot.

## Vercel Runtime Handoff

When deployed:

```text
Vercel frontend/API -> Supabase Postgres/PostGIS
```

Production env:

```text
DATABASE_URL=<supabase-pooled-connection-string>
STARTUP_DATA_MODE=validate
DEMO_MODE=false
FRONTEND_ORIGIN=https://<vercel-domain>
```

No production Vercel function should run a data import.

## Acceptance Criteria

- There is a documented prepared-data handoff flow into Supabase.
- Current populated local PostGIS data can be copied/restored into Supabase as the prepared runtime dataset.
- Current repo data can be loaded into Supabase through explicit commands when reload tooling is needed.
- API startup in Supabase mode performs validation only.
- API startup in Supabase mode does not read `data/standardized`, `DataBuild`, `LR_Documents`, tax bill folders, or workbooks.
- Local backend/frontend can run against Supabase data.
- Vercel deployment can use the same Supabase database without importing data.
- Destructive data reloads require explicit operator action.

## Follow-Up Work

After this plan is complete:

- move document bytes to Supabase Storage
- introduce tenant-scoped tables and memberships
- add data release tracking
- add Supabase/Vercel cost guardrails and monitoring
