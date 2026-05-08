# Data Model Audit Handoff

Created: 2026-04-24

## Purpose

This handoff captures the current investigation state for a larger data model / ETL audit of QAViewer. The goal is to help decide whether to keep the current baked-in import/seed approach or simplify the app so prepared data is loaded directly into PostGIS and the application only reads, displays, edits, and manages it.

## User's Main Questions

The user wants to understand:

- how data is structured, stored, created, updated, loaded, transformed, and used
- whether the current ETL/import process is necessary
- what the ETL is doing
- whether it can be simplified or removed
- what the simplest reasonable database structure would be
- how prepared data could be loaded directly instead
- where all data is stored
- how to access the data directly for exploration

The requested final output is a broad report with sections for high-level summary, entities, storage locations, relationships, ETL/import process, simpler loading option, data flow, database layer, API/backend, frontend usage, ERD, problems, recommendations, and final plain-English explanation.

## Important Early Finding

The active runtime data model is broader than the current NNC cutover docs alone imply.

The core standardized seed model is:

- `question_areas`
- `land_records`
- `management_areas`

But backend startup also automatically seeds two sidecar models:

- Atlas workbook/documents into `atlas_*` tables
- DataBuild tax parcels/tax bills into `tax_parcels` and `tax_bill_manifest`

So the running application currently depends on three import families:

1. standardized GeoJSON files in `data/standardized/`
2. Atlas workbook and document folder from repo root
3. tax parcel shapefile and tax bill folder from `DataBuild/`

There is also historical/retired ETL still present:

- `data/generated/`
- `scripts/export_seed_data.py`
- older BTG docs
- `DataStandardiztion/`
- `BTG_PTV_Implementation.gdb`
- `tmp/` generated geodatabase work folders

The docs explicitly mark some of this as historical, but the sidecar loaders are active code.

## Files Already Inspected

Backend:

- `backend/src/server.ts`
- `backend/src/app.ts`
- `backend/src/config.ts`
- `backend/src/lib/db.ts`
- `backend/src/lib/schema.ts`
- `backend/src/lib/seed.ts`
- `backend/src/lib/atlas.ts`
- `backend/src/lib/taxParcels.ts`
- `backend/src/lib/utils.ts`
- `backend/src/lib/search.ts`
- `backend/src/lib/auth.ts`
- `backend/src/routes/questionAreas.ts`
- `backend/src/routes/layers.ts`
- `backend/src/routes/dashboard.ts`
- `backend/src/routes/auth.ts`
- `backend/src/routes/admin.ts`
- `backend/src/routes/atlas.ts`
- `backend/src/routes/taxParcels.ts`

Frontend:

- `frontend/src/App.tsx`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/atlas.ts`
- `frontend/src/lib/taxParcels.ts`
- `frontend/src/components/MapWorkspace.tsx`

Docs/config:

- `AGENTS.md`
- `README.md`
- `.env.example`
- `docker-compose.yml`
- `docs/dataset-contract.md`
- `docs/nnc-cutover-plan.md`
- `docs/gis-data-flow.md`
- `docs/gis-architecture-implementation-plan.md`
- `docs/atlas-workbook-doc-tree-plan.md`
- `docs/tax-parcel-workspace-v1-handoff.md`

Data/import files:

- `data/standardized/manifest.json`
- `data/standardized/question_areas.geojson`
- `data/standardized/land_records.geojson`
- `data/standardized/management_areas.geojson`
- `data/generated/manifest.json`
- `scripts/export_seed_data.py`
- `DataStandardiztion/*.mjs`
- `Combined_LR_Upload_First3Tabs.xlsx`
- `DataBuild/pa_warren_with_report_data.shp`
- `DataBuild/TaxBills/`
- `LR_Documents/`
- `backend/uploads/`

## Runtime Startup Flow Found

`backend/src/server.ts`:

1. waits for Postgres
2. calls `ensureSchema`
3. calls `ensureSeedData` inside a transaction
4. starts Express

`backend/src/lib/schema.ts` creates schema directly in TypeScript. There are no separate migration files found in the repo.

`backend/src/lib/seed.ts` calls:

1. `seedUsers`
2. `ensureStandardSeedData`
3. `ensureAtlasSeedData`
4. `ensureTaxParcelSeedData`
5. `seedComments`

This means startup can fail if any configured active seed source changed after PostGIS was populated.

## Database System

Database:

- PostgreSQL + PostGIS
- Docker image: `postgis/postgis:16-3.4`
- volume: `pgdata`
- default connection: `postgres://qaviewer:qaviewer@db:5432/qaviewer`
- local fallback in code: `postgres://qaviewer:qaviewer@localhost:5432/qaviewer`

Extensions created:

- `postgis`
- `pg_trgm`

## Tables Found In Schema

Core/app:

- `users`
- `question_areas`
- `seed_metadata`
- `land_records`
- `management_areas`
- `comments`
- `documents`

Atlas sidecar:

- `atlas_land_records`
- `atlas_documents`
- `atlas_document_links`
- `atlas_featureless_docs`
- `atlas_document_manifest`
- `atlas_import_rejects`

Tax parcel sidecar:

- `tax_parcels`
- `tax_bill_manifest`

## Key Relationships Found

Database-enforced:

- `comments.question_area_id -> question_areas.id ON DELETE CASCADE`
- `comments.author_id -> users.id`
- `documents.question_area_id -> question_areas.id ON DELETE CASCADE`
- `documents.uploaded_by -> users.id`
- `atlas_document_links.lr_number -> atlas_land_records.lr_number ON DELETE CASCADE`
- `atlas_document_links.document_number -> atlas_documents.document_number ON DELETE CASCADE`
- `atlas_featureless_docs.document_number -> atlas_documents.document_number ON DELETE CASCADE`

Code-enforced / implied:

- `atlas_land_records.geom` is hydrated from `land_records.geom` by exact key match:
  - `land_records.record_number = atlas_land_records.lr_number`
- Atlas spatial match is runtime buffer intersection:
  - selected `question_areas.geom` buffered by fixed feet options
  - intersecting `atlas_land_records.geom`
- Tax parcel match is runtime buffer intersection:
  - selected `question_areas.geom` buffered by fixed feet options
  - intersecting `tax_parcels.geom`
  - ranked by overlap area then point distance
- Tax bills link by text only:
  - `tax_bill_manifest.parcel_id` to normalized `tax_parcels.parcel_id`
  - no foreign key in schema
- `atlas_document_manifest.document_number` links to `atlas_documents.document_number` in queries, but no FK is declared in schema.

## Standardized Seed Details Observed

`data/standardized/manifest.json`:

- `question_areas`: 75 features, Point
- `land_records`: 1,316 features, MultiPolygon
- `management_areas`: 340 features, MultiPolygon

Sample `question_areas` properties:

- `code`
- `source_layer`
- `status`
- `severity`
- `title`
- `summary`
- `description`
- `county`
- `state`
- `parcel_code`
- `owner_name`
- `property_name`
- `tract_name`
- `fund_name`
- `land_services`
- `tax_bill_acres`
- `gis_acres`
- `exists_in_legal_layer`
- `exists_in_management_layer`
- `exists_in_client_tabular_bill_data`
- `assigned_reviewer`
- `search_keywords`

The seed loader also stores the full properties object in `raw_properties`.

## Atlas Import Details Observed

Source defaults:

- workbook: `Combined_LR_Upload_First3Tabs.xlsx`
- docs root: `LR_Documents`

Env vars:

- `ATLAS_WORKBOOK_PATH`
- `ATLAS_DOCUMENT_ROOT`

Workbook sheets detected:

- `LR Info Template`
- `LR Documents Template`
- `Document Link Template`

Loader:

- `backend/src/lib/atlas.ts`
- `ensureAtlasSeedData`
- `loadAtlasWorkbookImport`
- `importAtlasSeedData`
- `hydrateAtlasGeometryFromLandRecords`

What it does:

- reads workbook tabs using `xlsx`
- validates strict cross-sheet references
- rejects bad rows into `atlas_import_rejects`
- imports documents, land records, child links, featureless docs
- scans `LR_Documents` recursively by exact filename
- builds `atlas_document_manifest`
- hydrates geometry from `land_records` by exact LR number
- stores a seed hash in `seed_metadata` under `atlas_workbook_sha256`

Important docs:

- `docs/atlas-workbook-doc-tree-plan.md`

Known facts from docs after final reseed:

- 1,693 Atlas land records
- 497 documents
- 2,703 child links
- 0 featureless docs
- 489 matched document files with sizes
- 390 Atlas land records missing geometry
- 609 workbook rows rejected by strict validation

## Tax Parcel Import Details Observed

Source defaults:

- shapefile: `DataBuild/pa_warren_with_report_data.shp`
- tax bill root: `DataBuild/TaxBills`

Env vars:

- `TAX_PARCEL_SOURCE_PATH`
- `TAX_BILL_ROOT`

Loader:

- `backend/src/lib/taxParcels.ts`
- `ensureTaxParcelSeedData`
- `loadTaxParcelSeedRows`
- `loadTaxBillManifestRows`

What it does:

- reads shapefile with the `shapefile` npm package
- reads `.cpg` encoding sidecar if present
- accepts Polygon/MultiPolygon only
- normalizes a selected set of shapefile/DBF properties into `tax_parcels`
- preserves full DBF attributes in `raw_properties`
- scans `DataBuild/TaxBills` recursively
- accepts bill filenames matching `YYYY_<ParcelID>.<ext>`
- creates stable hashed bill ids from relative file paths
- stores a seed hash in `seed_metadata` under `tax_parcel_source_sha256`

Observed source facts:

- shapefile has 6 features
- geometry types: 4 Polygon, 2 MultiPolygon
- tax bill folder has 8 PDFs:
  - `2024_58565.pdf`
  - `2024_58566.pdf`
  - `2024_58567.pdf`
  - `2024_58568.pdf`
  - `2025_58565.pdf`
  - `2025_58566.pdf`
  - `2025_58567.pdf`
  - `2025_58568.pdf`

## Historical / Retired ETL

`scripts/export_seed_data.py`:

- targets old BTG geodatabase flow
- default source: `BTG_PTV_Implementation.gdb`
- output: `data/generated`
- produces old files such as `question_areas.geojson`, `primary_parcels.geojson`, `parcel_points.geojson`, `management_tracts.geojson`, `manifest.json`
- docs say this is retired from active architecture

`data/generated/manifest.json`:

- old BTG model
- 557 question areas
- primary parcels, parcel points, management tracts
- should be treated as historical unless code is found still reading it

`DataStandardiztion/`:

- contains ad hoc `.mjs` scripts using `@oai/artifact-tool`
- joins `ParcelsListingReport.xlsx` to `PTA_SpatialOverlayResults_NNC_Timber_31Mar2026.xlsx`
- creates XY columns, points GeoJSON, CSV, audit workbook outputs
- appears exploratory/preparation-side, not runtime app code

## API Routes Found

Auth/admin:

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:id`
- `DELETE /api/admin/users/:id`

Question area / review:

- `GET /api/question-areas`
- `GET /api/question-areas/:code`
- `PATCH /api/question-areas/:code`
- `POST /api/question-areas/:code/comments`
- `POST /api/question-areas/:code/documents`
- `GET /api/question-areas/documents/:id/download`

Supporting layers:

- `GET /api/layers/:layerKey`
- `GET /api/layers/:layerKey/:id`
- active layer keys are only `land_records` and `management_areas`

Dashboard/search:

- `GET /api/dashboard/summary`
- `GET /api/dashboard/search`

Atlas:

- `GET /api/question-areas/:code/atlas?buffer=<100|500|1000|5000>&unit=feet`
- `GET /api/atlas/featureless-docs`
- `GET /api/atlas/import-report`
- `GET /api/atlas/documents/:documentNumber/content`
- `GET /api/atlas/documents/:documentNumber/download`

Tax parcels:

- `GET /api/question-areas/:code/tax-parcels?buffer=<100|500|1000|5000>&unit=feet`
- `GET /api/tax-parcels/bills/:billId/content`
- `GET /api/tax-parcels/bills/:billId/download`

## Frontend Data Usage Found

Session:

- `frontend/src/App.tsx`
- stores session in browser `localStorage` key `qaviewer.session`
- JWT is sent as Bearer token on API requests

Review workspace:

- `frontend/src/components/MapWorkspace.tsx`
- stores most UI state in React memory:
  - selected question area
  - map bbox
  - layer visibility
  - loaded question areas
  - loaded overlay data
  - edit draft
  - comment draft
  - upload file selection
  - Atlas/tax parcel tab and buffer settings

Frontend API helper:

- `frontend/src/lib/api.ts`

Atlas hook/types:

- `frontend/src/lib/atlas.ts`
- calls `/question-areas/:code/atlas`
- normalizes backend payload defensively

Tax parcel hook/types:

- `frontend/src/lib/taxParcels.ts`
- calls `/question-areas/:code/tax-parcels`
- normalizes backend payload defensively

## Storage Locations Found

Authoritative or runtime-important:

- PostGIS volume `pgdata`
- `data/standardized/*.geojson`
- `data/standardized/manifest.json`
- `Combined_LR_Upload_First3Tabs.xlsx`
- `LR_Documents/`
- `DataBuild/pa_warren_with_report_data.*`
- `DataBuild/TaxBills/`
- `backend/uploads/`
- browser `localStorage` key `qaviewer.session`

Historical/generated/temp:

- `data/generated/`
- `BTG_PTV_Implementation.gdb`
- `scripts/export_seed_data.py`
- `DataStandardiztion/`
- `tmp/`
- `DataBuild/Archive/`

## Current Concerns To Investigate Further

- The backend auto-creates and mutates schema in application startup code instead of migrations.
- Startup has mandatory seed/import behavior, not just schema validation.
- Atlas and tax parcel sidecars make the app dependent on workbook, document folder, shapefile, and tax bill file availability.
- Changing any active seed source requires PostGIS reset/reseed.
- `seed_metadata` keys are hash checks, not full import history.
- Some relationships are only implied in code, not enforced by database constraints.
- `atlas_document_manifest.document_number` is not a foreign key.
- `tax_bill_manifest.parcel_id` is not a foreign key.
- No status history/audit table for question-area status edits.
- `documents` metadata and on-disk uploaded files can drift if files are removed manually.
- `backend/uploads/` currently contains uploaded/test files, not just `.gitkeep`.
- Docs and code are partially out of sync: NNC docs describe core model, while README and code include tax parcel sidecar, and Atlas sidecar is active too.

## Suggested Next Window Plan

Recommended split:

1. Current Runtime Data Model
   - entities, storage, relationships, backend/frontend flow

2. ETL / Import Audit
   - standardized seed loader
   - Atlas workbook/doc loader
   - tax parcel shapefile/bill loader
   - historical BTG/DataStandardiztion scripts
   - active vs retired

3. Simpler Target Model
   - minimum tables
   - required fields
   - prepared input formats
   - direct database loading options

4. Cleanup / Migration Plan
   - keep/simplify/remove/investigate recommendations
   - concrete steps

## Likely Direction For Recommendations

Early recommendation direction, pending full write-up:

- Keep PostGIS as runtime store.
- Keep `question_areas`, `land_records`, `management_areas`, users, comments, documents.
- Consider moving all GIS/data preparation outside the app.
- Replace automatic startup imports with explicit load commands or SQL/GDAL/Python loaders.
- Treat `data/standardized` as a prepared-data input format, or load equivalent prepared data directly to PostGIS.
- If Atlas and tax parcel support remain product requirements, decide whether they are true app features or external prepared support tables.
- If they remain app features, load their prepared tables directly instead of parsing Excel/shapefiles during API startup.
- Add schema contract/migrations and startup validation.
- Add clearer documentation separating active runtime sources from archived historical files.

## Useful Direct Inspection Commands

With Docker stack running:

```bash
docker compose exec db psql -U qaviewer -d qaviewer
```

Example SQL:

```sql
\dt
SELECT key, value, updated_at FROM seed_metadata ORDER BY key;
SELECT COUNT(*) FROM question_areas;
SELECT COUNT(*) FROM land_records;
SELECT COUNT(*) FROM management_areas;
SELECT COUNT(*) FROM atlas_land_records;
SELECT COUNT(*) FROM atlas_documents;
SELECT COUNT(*) FROM atlas_import_rejects;
SELECT COUNT(*) FROM tax_parcels;
SELECT COUNT(*) FROM tax_bill_manifest;
SELECT code, status, severity, title, ST_AsText(geom) FROM question_areas LIMIT 5;
```

Backend API smoke:

```bash
curl http://localhost:3001/api/health
cd backend
npm run test:smoke
```

## Important Source References

Most important code files for the next pass:

- `backend/src/lib/schema.ts`
- `backend/src/lib/seed.ts`
- `backend/src/lib/atlas.ts`
- `backend/src/lib/taxParcels.ts`
- `backend/src/routes/questionAreas.ts`
- `backend/src/routes/layers.ts`
- `frontend/src/components/MapWorkspace.tsx`
- `frontend/src/lib/atlas.ts`
- `frontend/src/lib/taxParcels.ts`
- `docs/dataset-contract.md`
- `docs/atlas-workbook-doc-tree-plan.md`
- `README.md`
