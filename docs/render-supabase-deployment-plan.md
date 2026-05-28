# Render + Supabase Deployment Plan

Created: 2026-05-15

## Purpose

Deploy QAViewer using managed services without taking on VPS operations.

This plan replaces the earlier Vercel-first deployment direction for the MVP. The target is a straightforward managed deployment:

- Render hosts the Vite frontend.
- Render hosts the Express API as a long-running web service.
- Supabase hosts Postgres/PostGIS.
- Supabase Storage hosts MVP document/PDF files.

The goal is to keep the deployment easy to operate, avoid serverless API rewrites, preserve the existing local Docker development workflow, and keep a clean path to Azure later if the application graduates beyond MVP/client pilot use.

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

Paid Render hosting is the intended client-pilot path. The free web-service tier is useful only for throwaway smoke tests because it spins down when idle and its filesystem is ephemeral. For client sharing, use at least a paid Render web service plan so the API stays warm and predictable. The frontend can remain a Render Static Site unless usage or team requirements force a higher tier.

The repository may remain private. Render deployment should use the Render GitHub App with access granted to the private QAViewer repository.

Local Docker development remains supported and should stay the default day-to-day developer workflow. Docker Compose runs the backend and frontend dev servers against the prepared Supabase/Postgres `DATABASE_URL`; hosted Render services are the pilot deployment target, not a replacement for local development.

Use Git-backed Render services so hosted deployments follow the normal GitHub workflow. Each Render service should link to the deployment branch, initially `main` unless a separate `production` branch is introduced. Render auto-deploys from the linked branch by default, so pushes or merges to that branch rebuild and redeploy the affected service. Keep auto-deploy enabled for the pilot unless CI gating is added, then switch to deploy after checks pass.

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

### 0. Configure GitHub-Backed Render Deploys

- Keep the QAViewer repository private if desired.
- Install or configure the Render GitHub App with access to the QAViewer repository.
- Create separate Render services for the monorepo:

```text
frontend -> Render Static Site, root directory frontend
backend  -> Render Web Service, root directory backend
```

- Link both services to the same deployment branch, initially `main`.
- Leave auto-deploy enabled so pushes or merges to the linked branch redeploy the service.
- Prefer root-directory scoping so frontend-only changes redeploy only the static site and backend-only changes redeploy only the API.
- Use manual deploys only for controlled rollback/retry cases.
- If CI is added, configure Render auto-deploys to wait for CI checks before deploying.

### 1. Prepare Supabase Project

- Create Supabase project.
- Enable required extensions:

```sql
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm;
```

- Keep PostGIS out of the exposed `public` schema. `public.spatial_ref_sys` with RLS disabled is a known Supabase advisory when PostGIS is installed in `public`.
- If the target Supabase project already has PostGIS in `public`, relocate it before production signoff using Supabase's documented `ALTER EXTENSION ... SET SCHEMA extensions` workflow. This may require elevated privileges or Supabase Support.

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

Current implementation:

- Uploaded question-area documents go through `backend/src/lib/documentStorage.ts`.
- If `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET` are all set, the API stores new question-area upload bytes in the private Supabase Storage bucket and stores the storage object key in `documents.stored_name`.
- If those variables are omitted, local Docker/dev keeps writing upload bytes under `backend/uploads`.
- Partial Supabase Storage configuration is invalid and should fail startup.

Pilot target:

- Store document metadata in Postgres.
- Store file bytes in Supabase Storage.
- Store storage keys, not public URLs, in database rows.
- Generate download URLs through the API.
- Keep buckets private.
- Do not migrate Atlas package documents, tax-bill PDFs, source workbooks, or spreadsheet packages in this pass.
- Hosted Render Atlas/tax-bill package document preview/download remains deferred unless a later explicit object-storage migration loads those files and updates the package routes to use the storage adapter.

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

That module owns question-area upload, download, delete, and local/Supabase selection. Route handlers should not know whether the backing store is local disk, Supabase Storage, R2, or Azure Blob Storage.

### 4. Deploy API To Render

Use a Render Web Service for `backend`.

Recommended first deployment shape:

```text
Runtime: Node
Root: backend
Build: npm install && npm run build
Start: npm run start
Health check: /api/health
Plan: Starter or higher for client pilot use
Branch: main unless a production branch is introduced
Auto-deploy: enabled
```

Do not use the current backend Dockerfile for production Render deployment without changing it first. It is intentionally development-oriented for local Docker Compose and starts `npm run dev`. If using Docker on Render later, create a production Dockerfile that builds TypeScript and starts `npm run start`.

Production API environment:

```text
DATABASE_URL=<supabase-runtime-connection>
JWT_SECRET=<strong-production-secret>
STARTUP_DATA_MODE=validate
DEMO_MODE=false
API_HOST=0.0.0.0
FRONTEND_ORIGIN=https://<render-frontend-host>
SUPABASE_URL=<supabase-project-url>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_STORAGE_BUCKET=qaviewer-documents
DATABASE_SSL_REJECT_UNAUTHORIZED=false
```

Important API requirements:

- Bind to `0.0.0.0`.
- Respect Render's provided `PORT`. The backend accepts `API_PORT` for local/dev overrides and falls back to `PORT` for hosted Render runtime.
- Do not depend on local source-data folders.
- Do not depend on `backend/uploads` for durable production files.
- Keep Atlas/tax-bill package document routes out of the pilot acceptance path unless those object files are explicitly migrated later.

### 5. Deploy Frontend To Render

Use a Render Static Site for `frontend`.

Recommended settings:

```text
Root Directory: frontend
Build Command: npm install && npm run build
Publish Directory: dist
Plan: Static Site unless traffic/team requirements require an upgrade
Branch: main unless a production branch is introduced
Auto-deploy: enabled
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
- Verify PostGIS extension objects live in `extensions`, not `public`, before production signoff.
- Keep Supabase Storage bucket private.
- Restrict Supabase service role key to backend environment only.
- Supabase DB password rotation is complete as of 2026-05-20; use only the refreshed secret in local `.env`, Render, and any restore/runtime profiles.
- Add rate limiting for login, exports, and document downloads.
- Add document download audit logging before broad client use.
- Enable Supabase spend cap/cost alerts.
- Enable Render usage/billing notifications.
- Document the restore procedure for Supabase Postgres.
- Document the document-storage backup/export procedure.

## Cost Posture

Expected MVP cost model:

- Render static site: static-site tier unless traffic/team requirements require an upgrade.
- Render web service: paid fixed service tier; use Starter or higher before client sharing.
- Supabase project: fixed base plan plus metered overages.
- Supabase Storage: acceptable while document storage and egress are moderate.

Avoid relying on a free Render web service for the client pilot. The API should not spin down while a client is reviewing records, and local uploaded files are not durable on Render's ephemeral filesystem.

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
- Render services are connected to the private GitHub repository through the Render GitHub App.
- Backend and frontend services auto-deploy from the selected deployment branch.
- API starts in `STARTUP_DATA_MODE=validate` against Supabase.
- API is deployed on Render as a paid web service.
- Frontend is deployed on Render as a static site.
- Frontend points at the Render API.
- API CORS allows only the Render frontend origin.
- Local Docker Compose still runs backend and frontend dev services against the configured `DATABASE_URL`.
- Documents are not durably stored in `backend/uploads` in production.
- Supabase Storage upload/download works for question-area documents.
- Main authenticated reviewer workflow works from the Render frontend URL.
- Production deployment does not read local source data folders during startup.

## Open Questions

- Whether to use Render Postgres instead of Supabase if the team decides it wants one vendor for app and database hosting.
- Atlas package documents are deferred for the pilot; migrate them only through a later explicit object-storage package workflow.
- Tax-bill PDFs are deferred for the pilot; migrate them only through a later explicit object-storage package workflow.
- Whether to keep demo users for pilot access or replace them with explicit named client accounts before sharing.
- Whether to add a staging Supabase project before production client data is loaded.
