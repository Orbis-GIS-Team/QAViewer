# QAViewer

QAViewer is a Docker-first GIS review app built around the NNC cutover dataset in `data/standardized/`. The application is question-area-first: reviewers work from point-based `question_areas` with `land_records` and `management_areas` available as supporting overlays.

The backend also supports a DataBuild tax parcel sidecar used for parcel lookups and tax bill attachments in the question-area workspace.

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
2. Ensure the repo root includes the DataBuild sidecar sources expected by the backend:

```text
DataBuild/
  pa_warren_with_report_data.shp
  pa_warren_with_report_data.dbf
  pa_warren_with_report_data.shx
  pa_warren_with_report_data.prj
  pa_warren_with_report_data.cpg  # when available
  TaxBills/
    YYYY_<ParcelID>.pdf
```

The API container mounts `./DataBuild` read-only at `/workspace/DataBuild` and seeds tax parcel and bill metadata from that location on first start.

3. Start the stack:

```bash
docker compose up --build
```

4. Open:

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

For local backend runs outside Docker, the default tax parcel sidecar paths are:

- `TAX_PARCEL_SOURCE_PATH=../DataBuild/pa_warren_with_report_data.shp`
- `TAX_BILL_ROOT=../DataBuild/TaxBills`

Override them in `.env` if your local layout differs.

## Seed dataset

The active app architecture reads from `data/standardized/`, not `data/generated/`.

Current canonical files:

- `question_areas.geojson`
- `land_records.geojson`
- `management_areas.geojson`
- `manifest.json`

See `docs/dataset-contract.md` for the standardized file contract and expected properties.

## Tax parcel sidecar

Tax parcel and bill support is intentionally separate from the canonical seed dataset in `data/standardized/`.

- Parcel polygons are loaded from `DataBuild/pa_warren_with_report_data.shp`.
- Tax bills are discovered recursively under `DataBuild/TaxBills`.
- Bill filenames must match `YYYY_<ParcelID>.<ext>` for manifest import.
- If the DataBuild shapefile or bill tree changes after PostGIS has already been seeded, the backend will fail fast until you reset and reseed the local database.

## Reset and reseed workflow

The current cutover is a schema break, not an in-place migration. If the standardized seed assets or DataBuild tax parcel sidecar sources change after the database has already been populated, the backend will refuse to start until you explicitly reset local PostGIS.

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
- The backend also imports the DataBuild tax parcel sidecar on first start when the tax parcel tables are empty.
- The backend refuses to start against changed standardized seed assets until the database is explicitly reset and reseeded.
- The backend applies the same fail-fast hash check to the DataBuild tax parcel sidecar sources.
- Documents are stored in `backend/uploads`.
- Admin users can switch between the review workspace and the administration console from the header.
- Older parcel-centered architecture notes are retained only as archived reference documents and should not be treated as the current implementation source of truth.
