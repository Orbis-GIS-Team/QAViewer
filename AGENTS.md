# QAViewer Agent Guide

## Project purpose

QAViewer is a Docker-first GIS review application built from the PRD in `question_area_review_web_app_prd.md` and a prepared PostgreSQL/PostGIS runtime database.

A question area is a location where property tax boundaries may not match the legal retracement of deeds or the management/ownership data the client uses to represent what they own and manage.

The active app is centered on:

- `question_areas` as point-based review items
- `land_records` as a supporting overlay/data layer
- `management_areas` as a supporting overlay/data layer

The older BTG/generated-seed/parcel-centered architecture is no longer the active runtime model.

## Repo layout

- `archive/legacy-etl-2026-05-09/`: archived legacy source-data and seed-loader assets
- `backend/`: Express/TypeScript API, PostGIS schema bootstrap, auth, comments, documents
- `frontend/`: React/Vite/Leaflet viewer/reviewer workspace UI
- `backend/uploads/`: uploaded documents stored by the API
- `docker-compose.yml`: local dev stack for PostGIS, API, and frontend
- `docs/nnc-cutover-plan.md`: cutover status and remaining cleanup tasks

## Source of truth

- The app consumes the prepared PostgreSQL/PostGIS database at `DATABASE_URL`.
- Runtime startup validates existing tables/data and must not import source GIS packages, workbooks, shapefiles, document folders, or standardized GeoJSON.
- Legacy source-data assets are archived under `archive/legacy-etl-2026-05-09/` for provenance only.
- Replace runtime data through an explicit database restore/import workflow outside API startup.

## Key commands

Start the full stack:

```bash
docker compose up --build
```

Reset local PostGIS only when replacing the prepared database volume:

```bash
docker compose down -v
docker compose up --build
```

Backend dev/build:

```bash
cd backend
npm install
npm run dev
npm run build
npm run test:smoke
```

Frontend dev/build:

```bash
cd frontend
npm install
npm run dev
npm run build
```

## Runtime defaults

- Frontend: `http://localhost:5173`
- API: `http://localhost:3001/api`
- PostGIS: `localhost:5432`

Demo users seeded by the backend:

- `admin@qaviewer.local` / `admin123!` - admin and reviewer-capable
- `client@qaviewer.local` / `client123!` - viewer-only by default

## Important implementation notes

- The backend starts in `STARTUP_DATA_MODE=validate` and checks the prepared database before serving.
- Legacy seed/import code and source assets have been archived and are not part of normal runtime startup.
- Document files are stored on disk in `backend/uploads`; metadata is stored in Postgres.
- The frontend is designed around an authenticated single-screen viewer/reviewer workspace:
  map, search/filter rail, and question-area details rail, with workflow controls gated by explicit permissions.

## When changing the app

- If you change persisted backend fields, update the PostGIS schema and prepared database handoff/restore documentation.
- If you change question-area payloads, update both backend route responses and frontend types.
- If you introduce a new explicit import workflow, keep it outside API startup and document its operator steps.
- Prefer keeping the browser decoupled from PostGIS; all data access should stay behind the API.

## Verification

Useful checks after changes:

```bash
cd backend && npm run build
cd frontend && npm run build
curl http://localhost:3001/api/health
curl -I http://localhost:5173
```
