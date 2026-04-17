# QAViewer

QAViewer is a Docker-first GIS review app built from the provided PRD and reusable GIS seed schema. The app centers on question areas derived from mismatch layers, with supporting parcel, point, and management layers exported into normalized seed assets.

## Stack

- Frontend: React + Vite + Leaflet
- Backend: Express + TypeScript
- Database: PostgreSQL + PostGIS
- Seed pipeline: Python (`geopandas` / `pyogrio`) export from a source `.gdb` or compatible vector dataset

## Project structure

- `scripts/export_seed_data.py`: reads a source dataset and writes normalized GeoJSON seed assets into `data/generated`
- `backend/`: API, auth, PostGIS schema, seed loader, comments, and document upload/download endpoints
- `frontend/`: Leaflet review workspace with search, layer toggles, details, comments, and document management
- `data/generated/`: exported GIS seed layers used by the backend on first start

## Run with Docker

1. Copy `.env.example` to `.env` if you want to override the defaults.
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

## Regenerate GIS seed data

The app consumes normalized files from `data/generated/`; source datasets should be exported into that same schema. See `docs/dataset-contract.md` for the required logical layers and fields.

To rebuild with the default source path and layer names:

```bash
.venv/bin/python scripts/export_seed_data.py
```

To use a different dataset or layer names:

```bash
.venv/bin/python scripts/export_seed_data.py \
  --source path/to/source.gdb \
  --primary-mismatch-layer Primary_Mismatch \
  --comparison-mismatch-layer Comparison_Mismatch \
  --primary-parcels-layer Primary_Parcels \
  --parcel-points-layer Parcel_Points \
  --management-tracts-layer Management_Tracts
```

The backend stores a hash of `data/generated/manifest.json` after seeding. If generated seed assets change while PostGIS is already populated, startup fails with a reseed message instead of silently serving stale GIS data. For local development, reset and reseed explicitly:

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
- Leaflet map viewer
- Question area layer and supporting GIS overlays
- Search and selection
- Details/review panel
- Comments
- Document upload/list/download
- Basic status tracking
- Admin console for user creation, role management, and guarded account deletion

## Notes

- The backend imports the seed layers automatically on first start if the database is empty.
- The backend refuses to start against changed generated seed assets until the database is explicitly reset/reseeded.
- Documents are stored in `backend/uploads`.
- Admin users can switch between the review workspace and the administration console from the header.
- The question-area exporter defaults to `BTG_Spatial_Fix_Primary_Erase` and `BTG_Spatial_Fix_Comparison_Erase`, but source path and layer names can be overridden for compatible datasets.
