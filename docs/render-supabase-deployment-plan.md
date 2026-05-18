# Render + Supabase Deployment Plan

Created: 2026-05-15

## Purpose

Deploy QAViewer using managed services without taking on VPS operations.

This plan replaces the earlier Vercel-first deployment direction for the MVP. The target is a straightforward managed deployment:

- Render hosts the Vite frontend.
- Render hosts the Express API as a long-running web service.
- Supabase hosts Postgres/PostGIS.
- Supabase Storage hosts MVP document/PDF files.

The goal is to keep the deployment easy to operate, avoid serverless API rewrites, and preserve a clean path to Azure later if the application graduates beyond MVP/client pilot use.

## Related Plans

- `docs/supabase-data-migration-plan.md`
- `docs/supabase-prepared-data-handoff-runtime-plan.md`
- `docs/local-supabase-development-plan.md`
- `docs/prepared-data-multitenant-postgres-plan.md`
- `docs/archive/vercel-application-deployment-plan.md` - archived superseded Vercel-first plan

## Architecture Decision

Use Render for application hosting and Supabase for durable data.

Render is preferred over Vercel for the MVP API because QAViewer already has a normal Express backend and Docker-first local architecture. A Render web service can run the API as a long-running process without adapting it to serverless functions.

Supabase is preferred for the MVP database because QAViewer needs managed Postgres with PostGIS. Supabase Storage is acceptable for MVP document storage as long as document volume and egress stay within moderate pilot usage. If PDF volume or download traffic grows beyond that, move document bytes to Cloudflare R2 or, later, Azure Blob Storage.

## Target State

```text
Browser
  -> Render Static Site
       Vite React frontend
       VITE_API_BASE_URL=https://<render-api-host>/api

  -> Render Web Service
       Express API
       STARTUP_DATA_MODE=validate
       DEMO_MODE=false
       reads/writes Supabase Postgres
       uploads/downloads documents through storage adapter

  -> Supabase
       Postgres + PostGIS
       private document storage bucket
```

## Scope

In scope:

- Render static site deployment.
- Render API web service deployment.
- Supabase Postgres/PostGIS setup.
- Supabase Storage bucket setup for MVP document/PDF storage.
- Production environment variables.
- Database restore/import handoff.
- Health checks and smoke checks.
- Cost and usage guardrails.

Out of scope:

- VPS deployment.
- Vercel deployment.
- GeoServer deployment.
- Azure production migration.
- Full multi-tenant authorization.
- Large-scale document archive design beyond keeping storage swappable.

## Implementation Phases

### 1. Prepare Supabase Project

- Create Supabase project.
- Enable required extensions:

```sql
create extension if not exists postgis;
create extension if not exists pg_trgm;
```

- Create a private storage bucket for QAViewer documents, for example:

```text
qaviewer-documents
```

- Capture secrets outside the repo:

```text
DATABASE_URL
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET=qaviewer-documents
```

Use the direct database URL for migrations and controlled restore/import work. Use the appropriate pooled/runtime URL for the deployed API if connection pressure becomes a concern.

### 2. Load Prepared Runtime Data

Use the current prepared local PostGIS database as the first MVP runtime dataset unless an explicit reload workflow is ready.

Operator-level flow:

```bash
pg_dump --format=custom --no-owner --no-acl <local-postgis-url> > qaviewer-prepared.dump
pg_restore --no-owner --no-acl --dbname <supabase-direct-url> qaviewer-prepared.dump
```

Then validate:

```bash
cd backend
npm run db:validate
```

Runtime startup must remain validation-only. It must not import GIS packages, Excel workbooks, shapefiles, source document folders, or standardized GeoJSON.

### 3. Move Runtime Documents Off Local Disk

Current production risk:

- Uploaded question-area documents are written to `backend/uploads`.
- Atlas document content may still resolve to local package paths depending on the prepared data.

MVP target:

- Store document metadata in Postgres.
- Store file bytes in Supabase Storage.
- Store storage keys, not public URLs, in database rows.
- Generate download/preview URLs through the API.
- Keep buckets private.

Recommended environment variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET
```

Recommended implementation boundary:

```text
backend/src/lib/documentStorage.ts
```

That module should own upload, download, signed URL, delete, and existence checks. Route handlers should not know whether the backing store is local disk, Supabase Storage, R2, or Azure Blob Storage.

### 4. Deploy API To Render

Use a Render Web Service for `backend`.

Recommended first deployment shape:

```text
Runtime: Docker or Node
Root: backend
Build: npm install && npm run build
Start: npm run start
Health check: /api/health
```

If using the repository-level Dockerfile path, configure Render to build from `backend/Dockerfile`.

Production API environment:

```text
DATABASE_URL=<supabase-runtime-connection>
JWT_SECRET=<strong-production-secret>
STARTUP_DATA_MODE=validate
DEMO_MODE=false
API_HOST=0.0.0.0
API_PORT=<Render-provided-or-expected-port>
FRONTEND_ORIGIN=https://<render-frontend-host>
SUPABASE_URL=<supabase-project-url>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_STORAGE_BUCKET=qaviewer-documents
```

Important API requirements:

- Bind to `0.0.0.0`.
- Respect Render's provided port if Render injects `PORT`.
- Do not depend on local source-data folders.
- Do not depend on `backend/uploads` for durable production files.

### 5. Deploy Frontend To Render

Use a Render Static Site for `frontend`.

Recommended settings:

```text
Root Directory: frontend
Build Command: npm install && npm run build
Publish Directory: dist
```

Frontend environment:

```text
VITE_API_BASE_URL=https://<render-api-host>/api
```

After the frontend URL is known, update API `FRONTEND_ORIGIN` to the exact Render frontend origin.

### 6. Verify Production Workflows

Run these checks after deployment:

```bash
curl https://<render-api-host>/api/health
curl -I https://<render-frontend-host>
```

Manual smoke checks:

- Login works.
- Question areas load.
- Map bbox queries load.
- `land_records` overlay loads.
- `management_areas` overlay loads.
- Question-area detail rail loads.
- Comments work.
- Status/severity/reviewer updates work with permissions.
- Export works within configured limits.
- Document upload works.
- Document preview/download works.
- Admin user management works.

Backend smoke tests can target the hosted API if credentials and test data are safe:

```bash
cd backend
QA_SMOKE_API_URL=https://<render-api-host>/api npm run test:smoke
```

### 7. Add Guardrails Before Client Sharing

- Disable demo mode.
- Use a strong `JWT_SECRET`.
- Set exact `FRONTEND_ORIGIN`; do not allow wildcard CORS.
- Keep Supabase Storage bucket private.
- Restrict Supabase service role key to backend environment only.
- Add rate limiting for login, exports, and document downloads.
- Add document download audit logging before broad client use.
- Enable Supabase spend cap/cost alerts.
- Enable Render usage/billing notifications.
- Document the restore procedure for Supabase Postgres.
- Document the document-storage backup/export procedure.

## Cost Posture

Expected MVP cost model:

- Render static site: low fixed/free tier depending on chosen plan.
- Render web service: fixed service tier.
- Supabase project: fixed base plan plus metered overages.
- Supabase Storage: acceptable while document storage and egress are moderate.

Moderate Supabase Storage usage for this MVP means roughly:

- under 100 GB stored documents
- under 250 GB monthly egress
- small internal/client reviewer group
- no public high-traffic document portal behavior

If document traffic grows materially, move document bytes to Cloudflare R2 while keeping the same `documentStorage` API. If the product graduates to enterprise cloud hosting, move app/runtime to Azure and document bytes to Azure Blob Storage.

## GeoServer Decision

Do not add GeoServer for the MVP deployment.

Current overlays are served from PostGIS through API bbox-filtered GeoJSON endpoints. That is simpler to deploy and sufficient for pilot validation. Revisit GeoServer only if QAViewer needs OGC services, external GIS client access, server-side GIS styling, tile caching, or raster/coverage workflows.

## Acceptance Criteria

- Supabase contains the prepared QAViewer runtime database.
- API starts in `STARTUP_DATA_MODE=validate` against Supabase.
- API is deployed on Render as a web service.
- Frontend is deployed on Render as a static site.
- Frontend points at the Render API.
- API CORS allows only the Render frontend origin.
- Documents are not durably stored in `backend/uploads` in production.
- Supabase Storage upload/download works for question-area documents.
- Main authenticated reviewer workflow works from the Render frontend URL.
- Production deployment does not read local source data folders during startup.

## Open Questions

- Whether to use Render Postgres instead of Supabase if the team decides it wants one vendor for app and database hosting.
- Whether Atlas package documents should be migrated to Supabase Storage in the same pass as uploaded question-area documents or handled as a separate migration.
- Whether to keep demo users for pilot access or replace them with explicit named client accounts before sharing.
- Whether to add a staging Supabase project before production client data is loaded.
