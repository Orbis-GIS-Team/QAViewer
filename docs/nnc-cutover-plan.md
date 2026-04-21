# NNC Cutover Plan

This document tracks the phased cutover from the original BTG-style generated seed pipeline to the new NNC data model based on `NNC_Data/Data.gdb`.

## Goal

Rebuild QAViewer so the app is centered on NNC `QuestionAreas` as point-based review items, with `LandRecords` and `Management` available as supporting map layers, while removing the old parcel-centric runtime assumptions.

## Canonical Data Model

The app should use a standardized seed dataset stored in `data/standardized/` and loaded into PostGIS.

Current canonical layers:

- `question_areas`
- `land_records`
- `management_areas`

The old `scripts/export_seed_data.py` and `data/generated/` pipeline is being retired from the active architecture.

## Phase Plan

### Phase 1: Canonical Seed Dataset

Replace the old generated/export-script flow with a repo-owned standardized seed dataset built from `NNC_Data/Data.gdb`.

Deliverables:

- `data/standardized/question_areas.geojson`
- `data/standardized/land_records.geojson`
- `data/standardized/management_areas.geojson`
- `data/standardized/manifest.json`

Status: completed

### Phase 2: Backend Cutover

Rebuild the backend data model and active API surface around:

- `question_areas` as point geometry and the primary review entity
- `land_records` as an overlay/data layer
- `management_areas` as an overlay/data layer

Remove parcel-specific review flows from the active backend path.

Status: completed

Implemented backend changes:

- `backend/src/config.ts` now points `seedDir` at `data/standardized`
- `backend/src/lib/schema.ts` defines `question_areas`, `land_records`, and `management_areas`
- `backend/src/lib/seed.ts` seeds the new standardized layers
- `backend/src/routes/layers.ts` exposes `land_records` and `management_areas`
- `backend/src/routes/questionAreas.ts` now serves point-based question areas
- parcel-only backend modules were removed from the active app path

Verification:

- `cd backend && npm run build`

### Phase 3: Frontend Cutover

Rebuild the review workspace so it is question-area-first and no longer parcel-driven.

Deliverables:

- Question areas remain the primary selectable review layer
- `land_records` overlay toggle
- `management_areas` overlay toggle
- Remove parcel detail/status/comment flows from the review UI
- Update frontend types and API calls to match the Phase 2 backend

Status: completed

Implemented frontend changes:

- `frontend/src/components/MapWorkspace.tsx` is now question-area-first and uses only the active NNC backend routes
- the review workspace keeps `question_areas` as the primary selectable entity
- overlay toggles now target `land_records` and `management_areas`
- parcel-specific detail, comment, and status flows were removed from the active UI path
- frontend search/filter controls were aligned with the current `question_areas` search API
- admin frontend types were aligned with the current backend user payloads

Verification:

- `cd frontend && npx tsc -b --pretty false`
- `cd frontend && npm run build`

### Phase 4: Runtime and Docs Cleanup

Update the remaining runtime and documentation references to the old model.

Deliverables:

- Update Docker mounts and backend image copy paths if needed
- Update `.env.example`
- Update `README.md`
- Update `AGENTS.md`
- Remove or archive docs that describe the old parcel-centered/generated-seed architecture
- Document required reset/reseed workflow for the schema break

Status: completed

Implemented cleanup:

- `docker-compose.yml` now mounts `data/standardized`
- `backend/Dockerfile` now copies `data/standardized`
- `.env.example` was reduced to active runtime env vars only
- `README.md` and `AGENTS.md` now describe the standardized NNC architecture
- `docs/dataset-contract.md` was rewritten around `question_areas`, `land_records`, and `management_areas`
- older parcel-centered architecture docs were explicitly marked as archived historical reference
- reset/reseed guidance was preserved and clarified for the schema break

Verification:

- `cd backend && npm run build`
- `cd frontend && npm run build`

## Important Reset Note

This cutover is a schema break, not an in-place migration. Any existing local PostGIS volume seeded with the old schema must be reset before the rebuilt app can run correctly.

Local reset workflow:

```bash
docker compose down -v
docker compose up --build
```

## Next Recommended Step

The cutover plan is complete. The next useful thread would be end-to-end runtime validation with the Docker stack and smoke tests against a fresh PostGIS volume.
