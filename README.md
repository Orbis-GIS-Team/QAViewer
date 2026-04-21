# QAViewer

QAViewer is a Docker-first GIS review app built around the NNC cutover dataset in `data/standardized/`. The application is question-area-first: reviewers work from point-based `question_areas` with `land_records` and `management_areas` available as supporting overlays.

## Stack

- Frontend: React + Vite + Leaflet
- Backend: Express + TypeScript
- Database: PostgreSQL + PostGIS
- Seed dataset: repo-owned GeoJSON files in `data/standardized/`

## Project structure

- `data/standardized/`: canonical seed dataset loaded into PostGIS on first start
- `backend/`: API, auth, PostGIS schema, seed loader, comments, and document endpoints
- `frontend/`: review workspace and admin UI
- `backend/uploads/`: uploaded document storage
- `docs/nnc-cutover-plan.md`: phased NNC cutover record and remaining cleanup tasks

## Run with Docker

1. Copy `.env.example` to `.env` if you need to override runtime defaults.
2. Start the stack:

```bash
docker compose up --build
```

3. Open:

- Web app: `http://localhost:5173`
- API health: `http://localhost:3001/api/health`

## Demo credentials

- `admin@qaviewer.local` / `admin123!`
- `client@qaviewer.local` / `client123!`

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

You still need a PostGIS database available at `DATABASE_URL`.

## Seed dataset

The active app architecture reads from `data/standardized/`, not `data/generated/`.

Current canonical files:

- `question_areas.geojson`
- `land_records.geojson`
- `management_areas.geojson`
- `manifest.json`

See `docs/dataset-contract.md` for the standardized file contract and expected properties.

## Reset and reseed workflow

The current cutover is a schema break, not an in-place migration. If the standardized seed assets change after the database has already been populated, the backend will refuse to start until you explicitly reset local PostGIS.

Reset locally with:

```bash
docker compose down -v
docker compose up --build
```

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

- The backend imports the standardized seed layers automatically on first start if the database is empty.
- The backend refuses to start against changed standardized seed assets until the database is explicitly reset and reseeded.
- Documents are stored in `backend/uploads`.
- Admin users can switch between the review workspace and the administration console from the header.
- Older parcel-centered architecture notes are retained only as archived reference documents and should not be treated as the current implementation source of truth.
