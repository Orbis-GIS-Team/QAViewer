# Supabase Prepared Data Handoff and No-Rebuild Runtime Plan

Created: 2026-05-08

## Purpose

Define how prepared QAViewer data gets into Supabase and how the application runs against that durable Supabase data without rebuilding, reseeding, or re-importing source files on every startup.

This is the operational bridge between local data preparation and the deployed application.

Related plans:

- `docs/supabase-data-migration-plan.md`
- `docs/local-supabase-development-plan.md`
- `docs/render-supabase-deployment-plan.md`
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

Current dev project for the first proof:

```text
Name: QAViewer Dev
Project ref: lfkuwbcmdlhkefnmdcsj
Organization: Orbis GIS (mpcactsemsrbqujvzcyn)
Region: us-east-1
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
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm;
```

PostGIS should not remain in the exposed `public` schema for Supabase environments. New projects should install it into `extensions` from the start. If an older Supabase project already has `postgis` in `public`, relocate it before production promotion using the Supabase-documented path below; this may require elevated privileges or Supabase Support:

```sql
begin;
  update pg_extension
    set extrelocatable = true
    where extname = 'postgis';

  alter extension postgis
    set schema extensions;

  alter extension postgis
    update to '<POSTGIS_VERSION>next';

  alter extension postgis update;

  update pg_extension
    set extrelocatable = false
    where extname = 'postgis';
commit;
```

3. Run QAViewer migrations.
4. Confirm runtime tables exist.
5. Confirm no startup seed mode is required for the API to boot.
6. Confirm PostGIS objects are not left in `public`, including `public.spatial_ref_sys`.

For the first proof, prefer copying the current prepared local PostGIS state into Supabase before rebuilding all import commands. A dump/restore path is acceptable if it preserves PostGIS geometries, indexes, lookup tables, comments, document metadata, users, and seed/import metadata needed by the current API.

Example operator-level flow:

```bash
pg_dump --format=custom --no-owner --no-acl <local-postgis-url> > qaviewer-prepared.dump
pg_restore --no-owner --no-acl --dbname <supabase-direct-url> qaviewer-prepared.dump
```

Exact commands should be adjusted for local Docker credentials, Supabase connection mode, and whether extensions/schema are created before restore.

Repo helper commands:

```bash
cd backend
npm run db:dump:prepared

SUPABASE_DIRECT_DATABASE_URL="<supabase-direct-url>" npm run db:restore:supabase
DATABASE_URL="<supabase-runtime-or-direct-url>" npm run db:validate
DATABASE_URL="<supabase-runtime-or-direct-url>" npm run db:counts
```

`db:dump:prepared` reads from the running local Docker PostGIS container by default. `db:restore:supabase` intentionally requires an operator-provided Supabase database connection string. It defaults to `PREPARED_RESTORE_MODE=app-data`, which truncates and restores only QAViewer runtime tables in dependency order. If the direct host is IPv6-only from Docker, use the Supabase Session pooler URL for restore. Use a pooled/runtime connection string for normal API runtime after the restore is complete.

## Future Import Command Design

The current migration path uses the prepared database dump/restore flow above. If source-package reload tooling is needed later, add explicit import commands under `backend`:

```bash
npm run db:migrate
npm run db:load:standardized -- --manifest ../data/standardized/manifest.json
npm run db:load:atlas -- --workbook ../Combined_LR_Upload_First3Tabs.xlsx --documents ../LR_Documents
npm run db:load:tax-parcels -- --source ../DataBuild/pa_warren_with_report_data.shp --bills ../DataBuild/TaxBills
npm run db:validate
```

The first implementation can reuse existing loader code. The important change is that the loaders are run intentionally and are not called from `server.ts`.

These commands are still useful, but they are not the critical first step if the local PostGIS database is already accepted as the prepared dataset.

## Runtime Startup Mode

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

`STARTUP_DATA_MODE` currently supports `validate` only. Legacy seed/import code has been archived and should not be part of normal startup.

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

Where `runStartupDatabaseStep()` runs readiness checks only.

## Validation Checks

`db:validate` and runtime validation should check:

- database connection works
- PostGIS is installed
- backend connection search path resolves `extensions` so PostGIS types/functions work after relocation
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

Older prepared databases can be updated for new persisted user roles with:

```bash
cd backend
npm run db:apply-user-roles
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
DATABASE_SSL_REJECT_UNAUTHORIZED=false
STARTUP_DATA_MODE=validate
DEMO_MODE=false
FRONTEND_ORIGIN=http://localhost:5173
```

Use the Supabase owner/runtime database connection for the Express API. The migration enables RLS on public runtime tables without browser-facing policies because QAViewer does not use the Supabase Data API as its application surface; all user authorization stays behind the API.

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

## Render Runtime Handoff

When deployed:

```text
Render frontend/API -> Supabase Postgres/PostGIS
```

Production env:

```text
DATABASE_URL=<supabase-runtime-connection-string>
STARTUP_DATA_MODE=validate
DEMO_MODE=false
FRONTEND_ORIGIN=https://<render-frontend-domain>
```

No production Render application startup should run a data import.

## Acceptance Criteria

- There is a documented prepared-data handoff flow into Supabase.
- Current populated local PostGIS data can be copied/restored into Supabase as the prepared runtime dataset.
- Current prepared database dumps can be restored into Supabase through explicit commands.
- API startup in Supabase mode performs validation only.
- API startup in Supabase mode does not read `data/standardized`, `DataBuild`, `LR_Documents`, tax bill folders, or workbooks.
- Local backend/frontend can run against Supabase data.
- Render deployment can use the same Supabase database without importing data.
- Destructive data reloads require explicit operator action.

## Follow-Up Work

After this plan is complete:

- migrate Atlas package documents, tax-bill PDFs, source workbooks, or spreadsheet packages only if the pilot later needs hosted package document access; Postgres dump/restore does not include object-storage bytes
- introduce tenant-scoped tables and memberships
- add data release tracking
- add Supabase/Render cost guardrails and monitoring
