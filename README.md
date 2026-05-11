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
- `backend/uploads/`: uploaded document storage
- `docs/nnc-cutover-plan.md`: phased NNC cutover record and remaining cleanup tasks

## Run with Docker

1. Copy `.env.example` to `.env` if you need to override runtime defaults.
2. Start the stack against the existing Docker PostGIS volume:

```bash
docker compose up --build
```

By default the API uses `STARTUP_DATA_MODE=validate`, which validates the already-prepared database and does not import seed/source files during startup.

3. Open:

- Web app: `http://localhost:5173`
- API health: `http://localhost:3001/api/health`

## Archived source data

Legacy source-data and ETL preparation assets have been moved under `archive/legacy-etl-2026-05-09/`. The application no longer mounts or imports those files during normal startup.

## Demo credentials

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

If an older prepared database is missing question-area actionability symbols, apply the explicit compatibility update before validation:

```bash
cd backend
npm run db:apply-actionability
```

## Legacy seed dataset

The active app runtime reads prepared PostGIS tables. The old seed files, DataBuild sidecar, Atlas workbook, document package, and seed loader are archived for provenance and migration reference only.

## Database replacement workflow

Runtime startup does not rebuild data. To replace local or Supabase data, restore a prepared PostGIS database dump or run an explicit future import command outside API startup.

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
- Documents are stored in `backend/uploads`.
- Admin users can switch between the review workspace and the administration console from the header.
- Older parcel-centered architecture notes are retained only as archived reference documents and should not be treated as the current implementation source of truth.
