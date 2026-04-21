# QAViewer Agent Guide

## Project purpose

QAViewer is a Docker-first GIS review application built from the PRD in `question_area_review_web_app_prd.md` and the NNC cutover dataset stored in `data/standardized/`.

The active app is centered on:

- `question_areas` as point-based review items
- `land_records` as a supporting overlay/data layer
- `management_areas` as a supporting overlay/data layer

The older BTG/generated-seed/parcel-centered architecture is no longer the active runtime model.

## Repo layout

- `data/standardized/`: canonical seed GeoJSON + manifest used by the backend seed loader
- `backend/`: Express/TypeScript API, PostGIS schema bootstrap, auth, comments, documents
- `frontend/`: React/Vite/Leaflet reviewer UI
- `backend/uploads/`: uploaded documents stored by the API
- `docker-compose.yml`: local dev stack for PostGIS, API, and frontend
- `docs/nnc-cutover-plan.md`: cutover status and remaining cleanup tasks

## Source of truth

- The app consumes only the standardized files in `data/standardized/`.
- Keep new GIS-derived seed datasets compatible with `docs/dataset-contract.md`.
- Do not hand-edit files in `data/standardized/` unless there is a very specific reason.
- If the standardized seed assets change, local PostGIS must be reset and reseeded before the app will start successfully.

## Key commands

Start the full stack:

```bash
docker compose up --build
```

Reset local PostGIS after a schema or seed break:

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

- `admin@qaviewer.local` / `admin123!`
- `client@qaviewer.local` / `client123!`

## Important implementation notes

- The backend seeds the database automatically on first start when the standardized seed tables are empty.
- The backend stores a hash of `data/standardized/manifest.json` and fails fast if the standardized seed assets change while PostGIS is already populated. For local development, explicitly reset with `docker compose down -v && docker compose up --build`.
- Geometry import assumes EPSG:4326 in the standardized seed files.
- Document files are stored on disk in `backend/uploads`; metadata is stored in Postgres.
- The frontend is designed around an authenticated single-screen review workspace:
  map, search/filter rail, and question-area details rail.

## When changing the app

- If you change persisted backend fields, update both the PostGIS schema and the seed loader.
- If you change question-area payloads, update both backend route responses and frontend types.
- If you change the standardized seed contract, update `docs/dataset-contract.md` in the same pass.
- Prefer keeping the browser decoupled from PostGIS; all data access should stay behind the API.

## Verification

Useful checks after changes:

```bash
cd backend && npm run build
cd frontend && npm run build
curl http://localhost:3001/api/health
curl -I http://localhost:5173
```
