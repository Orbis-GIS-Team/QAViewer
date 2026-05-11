# Prepared Data and Multi-Tenant Postgres Plan

Created: 2026-05-08

## Purpose

This plan turns the data-model audit and GitHub issue #8 into a broader architecture direction:

- data preparation happens outside QAViewer
- QAViewer runs against already-prepared Postgres/PostGIS tables
- startup no longer imports source GIS/workbook/shapefile assets
- the app can support multiple tenants safely
- cloud Postgres remains cheap and easy for Codex/agent-driven development

## Current Findings

Issue #8 currently frames the next work as stabilizing the question-area schema and the prepared-data loading contract. That is still useful, but the target should shift from "make the seed loader better" to "make prepared database state the product boundary."

The local audit confirms that runtime startup currently does too much:

- `backend/src/server.ts` calls `ensureSchema` and then `ensureSeedData` before the API starts.
- `backend/src/lib/seed.ts` creates uploads storage, demo users, standardized seed data, Atlas workbook data, tax parcel data, and demo comments.
- `backend/src/lib/schema.ts` owns direct table creation and ad hoc schema mutation instead of a versioned migration system.
- routes query shared global tables directly, with no tenant filter or tenant context.
- uploaded files, Atlas documents, and tax bills are served from local folders rather than tenant-aware object storage.

That design is workable for Docker demos and cutover migration, but it is a poor production boundary. Production startup should verify that schema and required baseline data exist; it should not parse GIS packages, Excel workbooks, shapefiles, or document folders.

## Target Architecture

QAViewer should become a PostGIS-backed review application with three explicit layers:

1. Data prep layer outside the app
   - owned by GIS/data automation
   - reads geodatabases, shapefiles, workbooks, tax bills, document folders, and client exports
   - validates and transforms source data into an agreed prepared contract
   - loads prepared rows/files into tenant-scoped database/object storage

2. Database/application storage layer
   - Postgres/PostGIS is the runtime source of truth
   - tables are migrated with versioned SQL migrations
   - all tenant-owned rows are scoped by `tenant_id`
   - prepared-data loads are tracked as versioned batches/releases

3. QAViewer app layer
   - Express API reads/writes only runtime tables
   - frontend remains decoupled from PostGIS
   - app startup runs migrations or schema validation, not ETL
   - legacy loaders remain available as explicit migration/dev commands during transition

## Recommended Multi-Tenant Model

Use a shared database with shared tables and mandatory `tenant_id` columns. Do not start with one database or schema per tenant.

Reasons:

- current table count is modest
- shared tables are simpler for app code, migrations, dashboarding, and support
- tenant isolation can be enforced consistently in API queries
- cloud Postgres free/cheap tiers are easier to use with one database
- if a future tenant needs hard isolation, that can become an enterprise deployment option later

Core tenancy tables:

```sql
tenants (
  id uuid primary key,
  slug text not null unique,
  name text not null,
  status text not null,
  created_at timestamptz not null default now()
)

tenant_memberships (
  tenant_id uuid not null references tenants(id),
  user_id integer not null references users(id),
  role text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
)
```

Tenant-scoped tables should include `tenant_id`:

- `question_areas`
- `land_records`
- `management_areas`
- `comments`
- `documents`
- `atlas_land_records`
- `atlas_documents`
- `atlas_document_links`
- `atlas_featureless_docs`
- `atlas_document_manifest`
- `atlas_import_rejects`
- `tax_parcels`
- `tax_bill_manifest`
- new import/load history tables

Important constraints:

- `question_areas.code` should become unique per tenant: `UNIQUE (tenant_id, code)`.
- document rows should carry `tenant_id` in addition to `question_area_id` for direct authorization checks and object-storage pathing.
- `users.email` can remain globally unique at first.
- tenant role should move out of `users.role` and into `tenant_memberships.role`; a user can then be an admin for one tenant and viewer for another.

Tenant context should be resolved once per request after authentication. Every route should then add tenant scope explicitly:

```sql
WHERE qa.tenant_id = $tenant_id
```

Postgres row-level security can be added later, especially if Supabase Auth/PostgREST becomes part of the stack. For the current Express API, the first implementation should enforce tenant scope in query helpers and tests.

## Prepared Data Contract

Keep the standardized dataset concept, but change its role.

Today:

- `data/standardized/*.geojson` are repo-mounted seed files
- backend startup imports and hash-checks them

Target:

- prepared data is loaded into Postgres before the app starts
- the contract defines database tables, required columns, geometry type/SRID, indexes, and file-object references
- GeoJSON remains a convenient interchange option, not the only production path

Recommended prepared inputs:

- SQL migration-compatible table loads, preferred for production
- GeoPackage or GeoJSON for GIS-friendly exchange
- CSV plus WKB/WKT for bulk tabular geometry loads
- object-storage manifest for PDFs/images/documents
- JSON manifest describing tenant, dataset version, row counts, source hashes, validation results, and loader version

Add explicit load history:

```sql
data_releases (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  name text not null,
  source_manifest jsonb not null,
  status text not null,
  created_by integer references users(id),
  created_at timestamptz not null default now(),
  activated_at timestamptz
)

data_load_rejects (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id),
  data_release_id uuid references data_releases(id),
  entity_type text not null,
  source_ref text,
  reject_reason text not null,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
)
```

The app should be able to answer: "which prepared data release is this tenant looking at, who loaded it, what source hashes were used, what was rejected, and when did it become active?"

## Migration Strategy

Use versioned SQL migrations. A lightweight tool is enough; options are node-pg-migrate, Drizzle migrations without adopting the whole ORM, or plain SQL files plus a small migration runner.

Recommended path:

1. Add `backend/migrations/`.
2. Create a migration table such as `schema_migrations`.
3. Move `CREATE EXTENSION`, table creation, constraints, and indexes out of `ensureSchema`.
4. Keep `ensureSchema` temporarily as a compatibility shim that warns or no-ops after migrations are in place.
5. Add `npm run db:migrate`.
6. Change startup to either:
   - run migrations automatically in local/dev only, or
   - fail with a clear message when migrations are pending.

For production and multi-agent work, prefer explicit migration commands in CI/deploy rather than hidden startup mutation.

## Loader Strategy

Split current startup loading into explicit commands:

- `npm run db:seed:demo`
- `npm run db:load:standardized -- --tenant=<slug> --manifest=<path>`
- `npm run db:load:atlas -- --tenant=<slug> --package=<path>`
- `npm run db:load:tax-parcels -- --tenant=<slug> --package=<path>`
- `npm run db:validate -- --tenant=<slug>`

During transition, reuse the current TypeScript parsing code for migration/dev loading, but remove it from API startup.

Longer term, move the heavy data prep fully outside this repo. QAViewer should receive prepared tables and object manifests, not source GIS workbooks.

## File Storage Strategy

Local `backend/uploads` is fine for Docker development but not for multi-tenant cloud production.

Move document content to object storage:

- Supabase Storage if Supabase is selected
- Cloudflare R2 or S3-compatible storage if Neon/Render/Railway is selected
- local filesystem adapter only for development

Document-like tables should store:

- `tenant_id`
- `bucket`
- `object_key`
- `original_name`
- `mime_type`
- `size_bytes`
- `sha256`
- source/load metadata

Use object keys shaped like:

```text
tenants/{tenant_id}/question-areas/{question_area_id}/uploads/{document_id}/{filename}
tenants/{tenant_id}/data-releases/{release_id}/atlas/{document_number}/{filename}
tenants/{tenant_id}/data-releases/{release_id}/tax-bills/{bill_id}/{filename}
```

## Cloud Postgres Recommendation

### Best fit for Codex/agent-heavy development: Neon

Neon is the best default choice for the database if the priority is cheap Postgres, PostGIS, and branchable development environments.

Why:

- free tier supports many small projects, 100 CU-hours monthly per project, 0.5 GB storage per project, autoscaling, branching, read replicas, and unlimited team members
- PostGIS is listed in Neon's extension library
- compute can scale to zero when idle, which fits intermittent dev/staging usage
- database branching maps well to Codex work: create a branch per feature/PR, run migrations/loaders safely, then discard it

Tradeoffs:

- not an all-in-one app backend
- document storage needs R2/S3/Supabase Storage separately
- auth remains app-owned unless adopting Neon Auth separately

Recommended use:

- Neon Postgres for dev/staging/early production
- R2 or S3-compatible storage for files
- keep Express API and custom auth for now

### Best all-in-one option: Supabase

Supabase is the best fit if the app should also adopt hosted auth, dashboarded table browsing, SQL editor, object storage, and a common managed-app platform.

Why:

- every project gets a dedicated Postgres database
- PostGIS can be enabled through Supabase's extension workflow
- free tier can work for small demos, though the 500 MB database-size read-only threshold is tight for GIS data
- Pro starts at a predictable baseline around $25/month, with included disk and storage useful for document-heavy workflows
- Supabase Storage is a natural replacement for `backend/uploads`, Atlas PDFs, and tax bills

Tradeoffs:

- database branching is not part of the free plan
- free tier is likely too small once real land records, management layers, tax parcel data, and document metadata grow
- adopting Supabase Auth/RLS would be a larger architectural decision

Recommended use:

- choose Supabase if integrated Auth + Storage + Postgres matters more than database branching
- otherwise, use Supabase only as a reference point or possible storage/auth future

### Acceptable app-hosting options: Railway or Render

Railway and Render can work, especially if the goal is to host the whole Docker-ish app cheaply.

Railway:

- usage-based pricing
- PostGIS is available through template marketplace images, but Railway docs describe those templates as options rather than the default managed Postgres path
- better for app hosting and quick deployment than long-term managed geospatial database governance

Render:

- managed Postgres docs explicitly call out PostGIS support
- straightforward app hosting story
- less compelling than Neon for branchable database development

### Later-stage production option: AWS RDS

RDS PostgreSQL supports PostGIS and is a strong production platform, but it is not the best first choice for this project if free/cheap and agent-friendly development are priorities. Use it later if customer/security requirements demand AWS-native networking, backups, IAM, and compliance controls.

## Recommended Decision

Use Neon for Postgres first, keep the Express API, and add an S3-compatible object store for documents.

This keeps the application closest to its current architecture while solving the biggest problem: the database becomes a real external runtime dependency rather than a Docker volume populated by API startup.

Revisit Supabase if one of these becomes more important than database branching:

- hosted auth
- built-in object storage
- dashboard-driven data operations for non-engineers
- RLS-first app architecture

## Implementation Plan

### Phase 1: Stop API startup from owning ETL

Goal: API startup validates runtime readiness; loading is explicit.

Tasks:

- add a config flag such as `STARTUP_DATA_MODE=validate|legacy-seed`, defaulting to `validate` outside local dev
- extract `ensureSeedData` calls into CLI entry points
- preserve legacy seed commands for local reset/reseed and migration support
- update Docker defaults to use legacy seed only for local demo mode
- add readiness checks for required tables, tenant count, and active data release
- document reset/reseed as a dev-only workflow

Acceptance criteria:

- production-like startup does not read `data/standardized`, `Combined_LR_Upload_First3Tabs.xlsx`, `LR_Documents`, `DataBuild`, or tax bill folders
- local demo can still be seeded intentionally
- changed source files cannot break API startup unless a legacy load command is being run

### Phase 2: Add migrations

Goal: schema changes become explicit and reviewable.

Tasks:

- choose migration runner
- create baseline migration from current `schema.ts`
- migrate indexes and extensions
- remove ad hoc schema mutation from application startup
- add `npm run db:migrate` and CI/build documentation
- add migration smoke test against local PostGIS

Acceptance criteria:

- fresh database can be built from migrations
- existing local Docker flow still works
- schema changes are visible as migration files

### Phase 3: Introduce tenant model

Goal: tenant-safe data access without changing every UI workflow at once.

Tasks:

- add `tenants` and `tenant_memberships`
- add `tenant_id` to tenant-owned tables
- create a default tenant migration and backfill existing rows
- move user role semantics from `users.role` toward tenant memberships
- include tenant claims/context in authenticated requests
- add query helpers to require tenant-scoped filtering
- update all routes and supporting query functions
- add smoke tests proving tenant A cannot read tenant B's question areas, documents, Atlas rows, or tax parcels

Acceptance criteria:

- all question-area, layer, dashboard, admin, Atlas, tax parcel, comment, and document queries are tenant-scoped
- existing single-tenant demo still works through a default tenant
- unique constraints are tenant-correct

### Phase 4: Define prepared database contract

Goal: issue #8 becomes a database/data-release contract rather than only a GeoJSON seed contract.

Tasks:

- finalize first-class `question_areas` columns
- decide which values remain in `raw_properties`
- update `docs/dataset-contract.md` into a prepared-data contract
- add `data_releases` and `data_load_rejects`
- define staging table names and load/activation semantics
- document row-count/hash validation
- document object manifest format

Acceptance criteria:

- an external process can prepare/load tenant data without changing application code
- QAViewer can show load metadata and reject summaries
- loader behavior is idempotent and auditable

### Phase 5: Move document content to object storage

Goal: files are tenant-aware and cloud-safe.

Tasks:

- add storage abstraction for local filesystem and S3-compatible storage
- update upload/download routes to use storage adapter
- migrate `documents.stored_name` to object-storage metadata
- move Atlas and tax bill file serving behind object keys
- add checksums to document manifests

Acceptance criteria:

- production no longer depends on local mounted document folders
- each file read/write is tenant-authorized
- local development still works with filesystem storage

### Phase 6: Cloud database proof of concept

Goal: prove QAViewer can run against managed Postgres.

Tasks:

- create Neon project and enable PostGIS
- run migrations
- load one tenant's prepared NNC dataset
- point local API at Neon with `DATABASE_URL`
- verify API health, login, map layers, question-area detail, Atlas/tax parcel panels, comments, and document metadata
- create a Neon branch and run an experimental migration/load there

Acceptance criteria:

- app runs with Docker PostGIS and Neon Postgres using the same migrations
- no source data files are required by the API in validate mode
- branch database workflow is documented for Codex tasks

### Phase 7: Cleanup historical ETL

Goal: reduce confusion without losing migration history.

Tasks:

- mark old BTG/DataStandardiztion/generated flows as archived
- remove runtime references to source ETL paths from production config
- keep legacy loaders under a clear `tools/legacy-loaders` or `backend/src/legacy-loaders` boundary if still needed
- update README, AGENTS.md, cutover docs, and roadmap issues

Acceptance criteria:

- new contributors can tell which data prep is external, which loader is legacy, and which tables are runtime product tables
- production app docs no longer imply source-file seeding is normal operation

## Suggested GitHub Issue Split

Replace or expand issue #8 with child issues:

1. Add migration framework and baseline schema migration.
2. Split startup seed/import into explicit CLI load commands.
3. Add tenant tables, default tenant backfill, and request tenant context.
4. Tenant-scope question-area, layer, dashboard, document, Atlas, and tax parcel routes.
5. Define prepared-data release tables and update dataset contract.
6. Add object-storage adapter for uploaded/source documents.
7. Prove managed PostGIS deployment on Neon.
8. Archive/rename legacy ETL docs and loaders.

## Open Decisions

- Whether external data prep loads directly with SQL/ogr2ogr or calls QAViewer-owned loader commands.
- Whether Atlas and tax parcel support are long-term first-class product modules or transitional sidecars.
- Whether reviewer assignments should point to `users.id` instead of free-text `assigned_reviewer`.
- Whether tenant admins can manage their own users or only memberships.
- Whether production auth remains custom JWT or moves to Supabase Auth/Auth0/Clerk later.
- Whether to model data releases as replace-in-place, active/inactive versions, or temporal history.

## Source Notes

- Local handoff: `docs/data-model-audit-handoff.md`
- Current issue: https://github.com/Orbis-GIS-Team/QAViewer/issues/8
- Current startup path: `backend/src/server.ts`, `backend/src/lib/seed.ts`
- Current schema path: `backend/src/lib/schema.ts`
- Current dataset contract: `docs/dataset-contract.md`
- Neon pricing and capabilities: https://neon.com/pricing
- Supabase pricing and platform docs: https://supabase.com/pricing, https://supabase.com/docs/guides/platform/database-size, https://supabase.com/docs/guides/platform/compute-and-disk
- Supabase extension docs: https://supabase.com/docs/guides/database/extensions
- Railway pricing and Postgres docs: https://railway.com/pricing, https://docs.railway.com/databases/postgresql
- Render Postgres docs: https://render.com/docs/postgresql
- AWS RDS PostGIS docs: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.PostGIS.html
