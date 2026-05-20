# QAViewer

QAViewer is a Docker-first GIS review app built around a prepared PostgreSQL/PostGIS runtime database. The application is question-area-first: reviewer-capable users work from point-based `question_areas` where property tax boundaries may not match legal deed retracement or the management/ownership data clients use to represent what they own and manage. Viewer-only users can browse the same records without workflow mutation controls. `land_records` and `management_areas` are available as supporting overlays.

The backend also supports tax parcel and Atlas land-record views from prepared database tables.

## Stack

- Frontend: React + Vite + Leaflet
- Backend: Express + TypeScript
- Database: PostgreSQL + PostGIS
- Runtime data: existing PostgreSQL/PostGIS tables

## Project structure

- `archive/legacy-etl-2026-05-09/`: archived legacy source-data and seed-loader assets
- `backend/`: API, auth, PostGIS schema, validation, comments, and document endpoints
- `frontend/`: review workspace and admin UI
- `backend/uploads/`: local-dev fallback storage for uploaded question-area documents
- `docs/nnc-cutover-plan.md`: phased NNC cutover record and remaining cleanup tasks

## Run with Docker

1. Copy `.env.example` to `.env` if you need to override runtime defaults.
2. Set `DATABASE_URL` in `.env` to the prepared Supabase/Postgres runtime database.
3. Start the app containers:

```bash
docker compose up --build
```

The compose stack talks to whatever database `DATABASE_URL` points at in your local `.env`. For the current setup, that should be the Supabase runtime/pooler connection string, not a local Postgres container.

The dev containers mount source code and keep `node_modules` in Docker volumes. Because of that, dependency changes can drift from older volumes. The compose services now run `npm install` on startup to self-heal after package changes. If a container still behaves oddly after dependency or lockfile changes, reset the dev volumes explicitly:

```bash
docker compose down -v
docker compose up --build
```

The compose stack now runs `api` and `web` only. It does not start a local PostGIS container. The API uses `STARTUP_DATA_MODE=validate`, which validates the already-prepared database and does not import seed/source files during startup.

Local Docker remains the recommended development workflow even when the hosted pilot runs on Render. Docker Compose uses `API_PORT=3001`; the deployed Render web service uses Render's injected `PORT`.

4. Open:

- Web app: `http://localhost:5173`
- API health: `http://localhost:3001/api/health`

## Archived source data

Legacy source-data and ETL preparation assets have been moved under `archive/legacy-etl-2026-05-09/`. The application no longer mounts or imports those files during normal startup.

## Demo credentials

These accounts are expected to exist in the prepared database when using the local demo dataset:

- `admin@qaviewer.local` / `admin123!` - full admin and review access
- `client@qaviewer.local` / `client123!` - viewer-only question-area access by default

Internal reviewer-capable roles are packaged through the persisted `users.role` field and mapped to explicit permissions in the backend and frontend RBAC helpers.

## Local development without Docker

Backend:

```bash
cd backend
npm install
npm run dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

You still need a prepared PostGIS database available at `DATABASE_URL`. Use `STARTUP_DATA_MODE=validate` for normal runtime and Supabase-backed development.

## Runtime database validation

Normal startup validates the prepared database only. It checks that PostGIS is enabled, required runtime tables exist, core question-area/land-record/management-area data is present, and at least one admin user exists.

Run the same validation directly with:

```bash
cd backend
npm run db:validate
```

## Supabase dev database handoff

The first Supabase migration path copies the already-prepared local Docker PostGIS database into a Supabase dev project. It does not rebuild data from source GIS files, workbooks, or document folders.

The current dev project created for this workflow is:

- Supabase project: `QAViewer Dev`
- Project ref: `lfkuwbcmdlhkefnmdcsj`
- Region: `us-east-1`
- Organization: `Orbis GIS`

Create a local dump from the running Docker database:

```bash
cd backend
npm run db:dump:prepared
```

Restore that dump into Supabase with the direct database URL from the Supabase dashboard:

```bash
cd backend
SUPABASE_DIRECT_DATABASE_URL="<supabase-direct-url>" npm run db:restore:supabase
DATABASE_URL="<supabase-runtime-or-direct-url>" npm run db:validate
DATABASE_URL="<supabase-runtime-or-direct-url>" npm run db:counts
```

The restore helper defaults to `PREPARED_RESTORE_MODE=app-data`, which truncates and restores only the QAViewer runtime tables in dependency order. If the direct database hostname is IPv6-only from Docker, use Supabase's Session pooler connection string for `SUPABASE_DIRECT_DATABASE_URL`. Use the pooled/runtime connection string for normal app runtime and deployed services.

The expected prepared source counts for this first dev migration are:

```text
users: 5
question_areas: 77
land_records: 1316
management_areas: 340
atlas_land_records: 1693
atlas_documents: 497
atlas_document_links: 2703
atlas_document_manifest: 497
atlas_import_rejects: 609
tax_parcels: 6
tax_bill_manifest: 8
property_tax_parcel_points: 4606
comments: 0
documents: 0
```

To run the local app against Supabase:

```text
DATABASE_URL=<supabase-runtime-or-direct-url>
DATABASE_SSL_REJECT_UNAUTHORIZED=false
STARTUP_DATA_MODE=validate
DEMO_MODE=false
FRONTEND_ORIGIN=http://localhost:5173
```

Use the Supabase owner/runtime database connection for the backend. The Supabase migrations enable RLS on public runtime tables as Data API defense-in-depth, but the Express API is still the application authorization boundary and connects as the database owner/service role.

Then run:

```bash
docker compose up --build
```

That keeps local development aligned with the deployed architecture:

- Local Docker: frontend + API containers on your machine
- Supabase: shared runtime database and optional document storage
- GitHub: source control and deployment trigger
- Render: hosted frontend/API built from pushed commits and its own environment variables

The important boundary is that local `.env` drives local Docker only, while Render environment variables drive hosted services only. Pushing code to GitHub should deploy application changes, not overwrite your local database settings.

## Render deployment

The intended client-pilot deployment is:

- Render Static Site for `frontend`
- Render paid Web Service for `backend`
- Supabase Postgres/PostGIS for runtime data
- Supabase Storage for durable document bytes

Frontend settings:

```text
Root Directory: frontend
Build Command: npm install && npm run build
Publish Directory: dist
VITE_API_BASE_URL=https://<render-api-host>/api
```

Backend settings:

```text
Root Directory: backend
Runtime: Node
Build Command: npm install && npm run build
Start Command: npm run start
Health Check Path: /api/health
Plan: Starter or higher for client pilot use
```

Backend environment:

```text
DATABASE_URL=<supabase-runtime-connection>
JWT_SECRET=<strong-production-secret>
STARTUP_DATA_MODE=validate
DEMO_MODE=false
API_HOST=0.0.0.0
FRONTEND_ORIGIN=https://<render-frontend-host>
DATABASE_SSL_REJECT_UNAUTHORIZED=false
SUPABASE_URL=<supabase-project-url>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_STORAGE_BUCKET=qaviewer-documents
```

The backend accepts Render's injected `PORT`; keep `API_PORT` for local overrides only. Do not use the current development Dockerfiles as Render production images without changing them to build and start production output. Keep `SUPABASE_SERVICE_ROLE_KEY` only in the backend Render service; never expose it to the frontend.

Question-area uploads use `backend/src/lib/documentStorage.ts`. Local/dev runs without Supabase Storage env vars continue writing to `backend/uploads`; hosted Render should set all three Supabase Storage env vars so new uploads are stored in the private bucket. Atlas package documents, tax-bill PDFs, source workbooks, and spreadsheet packages are not migrated or stored by this path for the pilot.

If an older prepared database is missing question-area actionability symbols, apply the explicit compatibility update before validation:

```bash
cd backend
npm run db:apply-actionability
```

## Legacy seed dataset

The active app runtime reads prepared PostGIS tables. The old seed files, DataBuild sidecar, Atlas workbook, document package, and seed loader are archived for provenance and migration reference only.

## Database replacement workflow

Runtime startup does not rebuild data. To replace local or Supabase data, restore a prepared PostGIS database dump or run an explicit future import command outside API startup.

Restores are operator actions. They should never be hidden inside `npm run dev`, API startup, or Docker startup.

## Smoke tests

With the Docker stack running:

```bash
cd backend
npm run test:smoke
```

Set `QA_SMOKE_API_URL` to target a non-default API base URL.

## Implemented MVP scope

- Basic login/access control
- Question-area-first Leaflet review workspace
- Search and filter controls for question areas
- `land_records` and `management_areas` overlay toggles
- Question-area detail, status, comments, and document handling
- Basic status tracking
- Admin console for user creation, role management, and guarded account deletion

## Notes

- The backend validates prepared PostGIS data by default and does not import source files during normal startup.
- `STARTUP_DATA_MODE` currently supports `validate` only.
- Legacy source-data and seed-loader assets are kept in `archive/legacy-etl-2026-05-09/` for reference.
- Question-area upload metadata is stored in Postgres. File bytes are stored in `backend/uploads` for local/dev fallback or in Supabase Storage when the backend has `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET`.
- Admin users can switch between the review workspace and the administration console from the header.
- Older parcel-centered architecture notes are retained only as archived reference documents and should not be treated as the current implementation source of truth.
