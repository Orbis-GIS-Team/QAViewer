# QAViewer Data Model and Import Audit

Created: 2026-04-24

This report consolidates the current data model audit from `docs/data-model-audit-handoff.md`. It describes how QAViewer stores, loads, transforms, and uses data today, and what a simpler direct-load architecture could look like.

## High-level summary

QAViewer is a PostGIS-backed review application. The browser does not read GIS files directly. It signs in, calls the Express API, and the API reads and writes PostgreSQL/PostGIS plus a few configured file folders.

The main review model is question-area-first:

- `question_areas` are point review records and are the primary workflow objects.
- `land_records` and `management_areas` are supporting map/data layers.
- `users`, `comments`, and `documents` support review workflow state.

The important audit finding is that the active runtime is broader than the NNC cutover docs alone imply. The core standardized seed model is loaded from `data/standardized/`, but backend startup also actively imports two sidecar models:

- Atlas workbook and document-folder data into `atlas_*` tables.
- DataBuild tax parcel shapefile and tax bill files into `tax_parcels` and `tax_bill_manifest`.

So the app currently has three active import families:

1. Standardized GeoJSON in `data/standardized/`
2. Atlas workbook and document folder from repo root
3. Tax parcel shapefile and tax bill folder from `DataBuild/`

The old BTG/generated-seed/parcel-centered flow still exists in the repository, but it is not the active runtime model.

## Plain-English answer

The database is the real runtime store. The seed files, Excel workbook, shapefile, PDF folders, and historical scripts are ways to populate that database.

The current app does more import work during startup than it needs to. It creates tables, checks seed hashes, imports GIS features, parses an Atlas workbook, scans document folders, reads a tax parcel shapefile, scans tax bill folders, and only then starts the API.

That works for a Docker demo and local reseeding, but it couples application boot to data preparation. A simpler architecture would keep PostGIS, keep the API, and move all heavy data preparation into explicit load steps. The API should normally start by verifying schema and data availability, not by transforming source files.

## Current entities

| Table | Purpose | Source or writer | Runtime mutability |
| --- | --- | --- | --- |
| `users` | Login identity and role | Demo seed or admin API | Mutable through admin UI |
| `question_areas` | Primary review items, point geometry | `data/standardized/question_areas.geojson` | Status, summary, description, reviewer are mutable |
| `land_records` | Legal/land-record overlay, polygon geometry | `data/standardized/land_records.geojson` | Seeded read-only in UI |
| `management_areas` | Management overlay, polygon geometry | `data/standardized/management_areas.geojson` | Seeded read-only in UI |
| `comments` | Review comments on question areas | API/UI | Mutable only by inserts today |
| `documents` | Uploaded review document metadata | API/UI | Mutable only by inserts/downloads today |
| `seed_metadata` | Current seed/import hashes | Backend seed loaders | Mutated by startup import |
| `atlas_land_records` | Atlas LR workbook records plus hydrated geometry | Atlas workbook plus `land_records` | Seeded read-only in UI |
| `atlas_documents` | Atlas document metadata | Atlas workbook | Seeded read-only in UI |
| `atlas_document_links` | Atlas LR-to-document child links | Atlas workbook | Seeded read-only in UI |
| `atlas_featureless_docs` | Atlas documents not tied to a feature | Atlas workbook | Seeded read-only in UI |
| `atlas_document_manifest` | Matched files in `LR_Documents` | Recursive file scan | Seeded read-only in UI |
| `atlas_import_rejects` | Rows rejected during Atlas import | Atlas import validation | Seeded read-only in UI |
| `tax_parcels` | Tax parcel polygons and normalized attributes | DataBuild shapefile | Seeded read-only in UI |
| `tax_bill_manifest` | Tax bill file metadata | `DataBuild/TaxBills` scan | Seeded read-only in UI |

## Storage locations

### Runtime storage

- PostGIS database in Docker volume `pgdata`
- Uploaded review files in `backend/uploads/`
- Atlas source documents in `LR_Documents/`, served directly through the API
- Tax bill files in `DataBuild/TaxBills/`, served directly through the API
- Browser session in `localStorage` key `qaviewer.session`
- React UI state in memory for map viewport, filters, selected record, edit drafts, upload selection, panel state, and buffer choices

### Active source inputs

- `data/standardized/question_areas.geojson`
- `data/standardized/land_records.geojson`
- `data/standardized/management_areas.geojson`
- `data/standardized/manifest.json`
- `Combined_LR_Upload_First3Tabs.xlsx`
- `LR_Documents/`
- `DataBuild/pa_warren_with_report_data.*`
- `DataBuild/TaxBills/`

### Historical or preparation-side inputs

- `data/generated/`
- `scripts/export_seed_data.py`
- `BTG_PTV_Implementation.gdb`
- `DataStandardiztion/`
- `tmp/`
- `DataBuild/Archive/`

## Current relationships

### Database-enforced relationships

- `comments.question_area_id -> question_areas.id`
- `comments.author_id -> users.id`
- `documents.question_area_id -> question_areas.id`
- `documents.uploaded_by -> users.id`
- `atlas_document_links.lr_number -> atlas_land_records.lr_number`
- `atlas_document_links.document_number -> atlas_documents.document_number`
- `atlas_featureless_docs.document_number -> atlas_documents.document_number`

### Code-enforced or implied relationships

- Atlas geometry is hydrated by exact text match:
  - `land_records.record_number = atlas_land_records.lr_number`
- Atlas records are matched to a selected question area by runtime spatial buffer:
  - selected `question_areas.geom` buffered by 100, 500, 1000, or 5000 feet
  - intersecting `atlas_land_records.geom`
- Tax parcels are matched to a selected question area by runtime spatial buffer:
  - selected `question_areas.geom` buffered by 100, 500, 1000, or 5000 feet
  - intersecting `tax_parcels.geom`
  - ranked by overlap area, then point distance
- Tax bills link by text:
  - `tax_bill_manifest.parcel_id` to normalized `tax_parcels.parcel_id`
  - no database foreign key
- Atlas file manifest links by text:
  - `atlas_document_manifest.document_number` to `atlas_documents.document_number`
  - no database foreign key
- Standard overlay layers relate to question areas spatially and visually, not by foreign key.

## Conceptual ERD

This ERD mixes database-enforced relationships and important runtime relationships. The relationship notes call out where the relationship is text/spatial instead of a foreign key.

```mermaid
erDiagram
  USERS ||--o{ COMMENTS : authors
  USERS ||--o{ DOCUMENTS : uploads
  QUESTION_AREAS ||--o{ COMMENTS : has
  QUESTION_AREAS ||--o{ DOCUMENTS : has

  ATLAS_LAND_RECORDS ||--o{ ATLAS_DOCUMENT_LINKS : linked_by_fk
  ATLAS_DOCUMENTS ||--o{ ATLAS_DOCUMENT_LINKS : linked_by_fk
  ATLAS_DOCUMENTS ||--o| ATLAS_FEATURELESS_DOCS : featureless_fk

  LAND_RECORDS ||--o{ ATLAS_LAND_RECORDS : record_number_to_lr_number_text
  ATLAS_DOCUMENTS ||--o{ ATLAS_DOCUMENT_MANIFEST : document_number_text
  TAX_PARCELS ||--o{ TAX_BILL_MANIFEST : parcel_id_text

  QUESTION_AREAS ||--o{ LAND_RECORDS : spatial_context
  QUESTION_AREAS ||--o{ MANAGEMENT_AREAS : spatial_context
  QUESTION_AREAS ||--o{ ATLAS_LAND_RECORDS : buffer_intersects
  QUESTION_AREAS ||--o{ TAX_PARCELS : buffer_intersects
```

## Startup and import flow

`backend/src/server.ts` starts the API like this:

1. Wait for PostgreSQL.
2. Run `ensureSchema`.
3. Run `ensureSeedData` inside one database transaction.
4. Start Express.

`ensureSeedData` does this:

1. Ensure `backend/uploads/` exists.
2. Seed demo users when `DEMO_MODE=true`.
3. Load/check standardized seed data.
4. Load/check Atlas workbook and document-folder data.
5. Load/check tax parcel shapefile and bill-folder data.
6. Seed demo comments.

This means application startup is also a schema bootstrapper and data import process.

## What the current ETL does

### Standardized seed loader

The standardized loader is the lightest import family. It reads prepared GeoJSON files from `data/standardized/`, inserts features into PostGIS, coerces booleans/numbers, forces geometry to EPSG:4326, and stores the original properties in `raw_properties`.

It stores a hash under `seed_metadata.generated_manifest_sha256`. The hash is of `manifest.json`, not a full content hash of every GeoJSON file. If data files changed without a manifest update, the hash check would not catch that.

### Atlas loader

The Atlas loader is heavier. It reads `Combined_LR_Upload_First3Tabs.xlsx`, parses workbook sheets, validates cross-sheet references, rejects bad rows into `atlas_import_rejects`, imports land records, documents, child links, featureless document links, and scans `LR_Documents/` recursively.

It also hydrates Atlas geometry from the already-loaded `land_records` table by exact LR number match. Atlas records that do not match `land_records.record_number` remain in `atlas_land_records` with `geom IS NULL` and are excluded from spatial matching.

The Atlas hash includes the workbook contents and the document folder file paths, sizes, and modification times. That protects against changed packages, but also means touching files can invalidate startup even when file contents are unchanged.

### Tax parcel loader

The tax parcel loader reads `DataBuild/pa_warren_with_report_data.shp` with the `shapefile` npm package, reads `.cpg` encoding when available, accepts Polygon and MultiPolygon features, maps selected DBF attributes into normalized columns, keeps all original attributes in `raw_properties`, and loads geometry into PostGIS.

It scans `DataBuild/TaxBills/` recursively and imports files whose names match `YYYY_<ParcelID>.<ext>`. It creates stable `bill_id` values from hashed relative paths.

One current risk: the loader treats both `tax_parcels` and `tax_bill_manifest` as core seed tables, but an absent or empty bill folder produces zero bill rows without failing. That can lead to parcels being imported, the hash being stored, and a later startup treating the seed as partially populated.

### Historical ETL

`scripts/export_seed_data.py` targets the old BTG geodatabase flow and writes `data/generated/`. It is not used by the active app.

`DataStandardiztion/` contains workbook/GIS preparation scripts and outputs. It appears to be preparation-side analysis, not runtime code.

## Data flow

```mermaid
flowchart LR
  A["data/standardized GeoJSON"] --> B["Backend startup seed"]
  C["Atlas workbook"] --> D["Atlas import"]
  E["LR_Documents folder"] --> D
  F["DataBuild shapefile"] --> G["Tax parcel import"]
  H["DataBuild/TaxBills folder"] --> G

  B --> I["PostGIS"]
  D --> I
  G --> I

  J["Reviewer browser"] --> K["Express API"]
  K --> I
  K --> L["backend/uploads"]
  K --> E
  K --> H
```

## Backend/API usage

The API is the only path the browser uses for data access.

Core review routes:

- `GET /api/question-areas`
- `GET /api/question-areas/:code`
- `PATCH /api/question-areas/:code`
- `POST /api/question-areas/:code/comments`
- `POST /api/question-areas/:code/documents`
- `GET /api/question-areas/documents/:id/download`

Supporting layer routes:

- `GET /api/layers/land_records`
- `GET /api/layers/land_records/:id`
- `GET /api/layers/management_areas`
- `GET /api/layers/management_areas/:id`

Search/dashboard routes:

- `GET /api/dashboard/summary`
- `GET /api/dashboard/search`

Sidecar routes:

- `GET /api/question-areas/:code/atlas`
- `GET /api/atlas/featureless-docs`
- `GET /api/atlas/import-report`
- `GET /api/atlas/documents/:documentNumber/content`
- `GET /api/atlas/documents/:documentNumber/download`
- `GET /api/question-areas/:code/tax-parcels`
- `GET /api/tax-parcels/bills/:billId/content`
- `GET /api/tax-parcels/bills/:billId/download`

## Frontend usage

The frontend stores only the authenticated session persistently in `localStorage`. All durable application data comes from API calls.

The review workspace loads:

- dashboard summary counts
- question-area GeoJSON features for the current map extent/filter
- `land_records` and `management_areas` overlay features for the current map extent
- selected question-area detail, comments, and uploaded documents
- Atlas matches and document tree for the selected question area and active buffer
- tax parcel matches and bills for the selected question area and active buffer

The UI edits only question-area workflow fields, comments, uploaded documents, and admin users. It does not edit the seeded GIS layers, Atlas data, or tax parcel data.

## Simplest reasonable target model

If the product goal is a review workspace with support overlays, the simplest database can be:

### Required workflow tables

- `users`
- `question_areas`
- `comments`
- `documents`

### Required GIS support tables

- `land_records`
- `management_areas`

### Optional feature tables

Keep these only if Atlas and tax parcel workflows remain product requirements:

- `atlas_land_records`
- `atlas_documents`
- `atlas_document_links`
- `atlas_document_files`
- `atlas_import_rejects` or `data_load_rejects`
- `tax_parcels`
- `tax_bills`

For a cleaner target model, sidecar file manifest tables should use enforced relationships where practical:

- `atlas_document_files.document_number -> atlas_documents.document_number`
- `tax_bills.tax_parcel_id -> tax_parcels.id`, or a validated unique parcel key if parcel IDs are not stable

## Direct database loading option

The app does not need to parse GeoJSON, Excel, or shapefiles during API startup. A simpler model is:

1. Prepare data outside the app into agreed formats.
2. Run explicit migration and load commands.
3. Start the API after the database is populated.

Possible load approaches:

- Use `ogr2ogr` to load prepared GeoJSON/shapefiles into PostGIS staging tables.
- Use `psql`/SQL scripts to transform staging tables into final app tables.
- Use a Node or Python loader as a command-line task, not as API startup code.
- Use a checked database dump or `pg_restore` for known demo datasets.
- Keep document files in a stable folder or object store and load only metadata plus safe relative paths.

The important change is not which tool loads the data. The important change is that loading becomes explicit and repeatable, instead of mandatory API startup work.

## Railway deployment preparation

The planned Railway deployment should reinforce the same split: app runtime, database, object storage, and explicit data loading should be separate concerns.

Recommended Railway shape:

- Railway web/API services run the QAViewer frontend and backend.
- Railway PostGIS service stores all runtime tables.
- Railway Storage Bucket stores large document assets.
- One-off Railway commands or jobs run migrations and data-load scripts.
- API startup validates schema/data readiness and starts serving. It should not import source data as part of normal boot.

Hosted file storage should move away from local-only folders:

- `LR_Documents/` should become bucket objects under a stable prefix such as `atlas/LR_Documents/`.
- `DataBuild/TaxBills/` should become bucket objects under a stable prefix such as `tax-bills/`.
- `backend/uploads/` should either move to the same bucket or use a dedicated app-upload bucket prefix.
- Database file tables should store object metadata, not machine-specific filesystem paths.

Suggested file metadata columns for hosted storage:

- `storage_provider`
- `bucket`
- `object_key`
- `file_name`
- `extension`
- `content_type`
- `size_bytes`
- `etag` or `content_hash`
- `created_at` / `loaded_at`

This implies a cleaner table naming pass while the import model is already changing:

- Rename or replace `atlas_document_manifest` with `atlas_document_files`.
- Rename or replace `tax_bill_manifest` with `tax_bills`.
- Keep foreign keys where practical, for example `atlas_document_files.document_number -> atlas_documents.document_number`.
- Keep source/audit fields in `data_load_runs` instead of relying on current seed hash keys alone.

The hosted document route should work like this:

1. Authenticate the user.
2. Look up the file row in PostGIS.
3. Generate a short-lived presigned bucket URL, or proxy the file through the API when access control requires it.
4. Return or redirect to the file.

For cost and deployment reliability, do not bake the full `LR_Documents/` folder into the backend Docker image. It is a large asset folder and belongs in object storage or another persistent file store.

## Local development after Railway

Local development should not require every developer action to talk to Railway. The app should support two document-storage modes:

- `DOCUMENT_STORAGE=local` for normal local development.
- `DOCUMENT_STORAGE=s3` for Railway and production-like testing.

In local mode:

- Keep using local paths such as `LR_Documents/`, `DataBuild/TaxBills/`, and `backend/uploads/`.
- Loaders should write the same final database rows as hosted mode, but with `storage_provider = 'local'` and safe relative paths.
- Docker Compose can mount local folders for convenience, but the API should not require a rescan on every startup.
- Developers can reset and reload data explicitly when source files change.

In hosted/S3 mode:

- Loaders list bucket objects by prefix and write object keys into file tables.
- The API serves files through presigned URLs or controlled proxy routes.
- Source files do not need to exist inside the app container.

The goal is one runtime data model with two storage adapters, not two different applications. The frontend should not care whether a PDF came from a local folder or a Railway bucket.

## Recommended target startup flow

The API should eventually start like this:

1. Wait for PostgreSQL.
2. Verify required extensions.
3. Verify schema version from migrations.
4. Verify required data sets are present and compatible.
5. Start Express.

Data loading should be separate:

```bash
npm run db:migrate
npm run data:load:standardized
npm run data:load:atlas
npm run data:load:tax-parcels
npm run data:verify
npm run dev
```

The exact scripts can be added later. The architectural goal is to separate "prepare/load data" from "serve the app."

For Railway, the same flow should be runnable as one-off commands:

```bash
npm run db:migrate
npm run data:load:all
npm run data:verify
```

The normal Railway start command should only start the API service after those steps have succeeded.

## Direct access for exploration

With Docker running:

```bash
docker compose exec db psql -U qaviewer -d qaviewer
```

Useful SQL:

```sql
\dt

SELECT key, value, updated_at
FROM seed_metadata
ORDER BY key;

SELECT COUNT(*) FROM question_areas;
SELECT COUNT(*) FROM land_records;
SELECT COUNT(*) FROM management_areas;
SELECT COUNT(*) FROM atlas_land_records;
SELECT COUNT(*) FROM atlas_documents;
SELECT COUNT(*) FROM atlas_import_rejects;
SELECT COUNT(*) FROM tax_parcels;
SELECT COUNT(*) FROM tax_bill_manifest;

SELECT code, status, severity, title, ST_AsText(geom)
FROM question_areas
ORDER BY code
LIMIT 5;
```

From the host, the default local connection is:

```text
postgres://qaviewer:qaviewer@localhost:5432/qaviewer
```

## Problems and risks

1. API startup does too much work.
   The server boot path creates/mutates schema and imports/checks three data families.

2. There are no migration files.
   Schema is created and patched directly in `backend/src/lib/schema.ts`.

3. Import state is only a set of current hashes.
   `seed_metadata` is useful for fail-fast checks, but it is not an import history or audit log.

4. Standardized seed hashing only hashes `manifest.json`.
   If GeoJSON files change without a manifest update, the mismatch check can miss it.

5. Sidecar loaders are mandatory runtime dependencies.
   Atlas and tax parcel source folders must be available for startup checks, even though they are support workflows.

6. Hashes can be oversensitive to file metadata.
   Atlas and tax bill folder hashes include modification times.

7. Several important relationships are not database-enforced.
   Atlas manifest/document links, Atlas parent documents, tax bill parcel links, and Atlas geometry hydration depend on code conventions.

8. Document metadata and files can drift.
   `documents` metadata can point to missing files if `backend/uploads/` is manually changed. The same broad risk exists for Atlas and tax bill source file paths.

9. There is no status history table.
   `question_areas.status` changes overwrite current state without preserving who changed what and when.

10. Documentation is partly stale.
   Some Atlas docs still describe the older CSV package flow, while current code uses the workbook plus `LR_Documents`. The tax parcel handoff says parts were unfinished that now exist.

11. Historical data artifacts remain near active data.
   `data/generated/`, old BTG files, temp geodatabases, and preparation scripts make it harder to see the real runtime inputs.

12. The current file model is local-filesystem centric.
   Atlas document and tax bill routes assume configured folders exist on the API host. That does not map cleanly to Railway unless large files move to a bucket or volume and file metadata is loaded explicitly.

## Recommendations

### Keep

- Keep PostGIS as the runtime store.
- Keep the API as the boundary between browser and database.
- Keep `question_areas`, `land_records`, and `management_areas` as the core GIS model.
- Keep `raw_properties` for traceability while the data contract is still moving.
- Keep Atlas and tax parcel tables only if those right-rail workflows remain product requirements.

### Change soon

- Document the three active import families clearly in `README.md`, `AGENTS.md`, and `docs/dataset-contract.md`.
- Fix the tax parcel empty-bill partial-seed risk.
- Add a `data_load_runs` or similar table if imports remain in code.
- Add content hashing for standardized GeoJSON files, or ensure the manifest always carries file hashes.
- Add a document-storage abstraction with local and S3-compatible backends.
- Add bucket/object-key fields to Atlas, tax bill, and uploaded-document file metadata.
- Add database constraints where the data model is stable enough:
  - Atlas document manifest to documents
  - Atlas parent document number to documents
  - Tax bill manifest to tax parcels or a stable parcel key

### Simplify next

- Move seed/import operations out of API startup into explicit commands.
- Introduce migrations for schema versioning.
- Treat `data/standardized/` as a prepared-data interchange format, not as something the server must import every boot.
- Convert Atlas and tax parcel inputs into prepared tables before app startup.
- Move large document assets to object storage for hosted environments.
- Make local development use the same database metadata shape as Railway, with only the storage adapter changing.
- Separate historical artifacts into an archive folder or mark them more visibly as non-runtime.

### Defer

- Full Atlas cleanup/dedupe reconciliation.
- Replacing text/spatial matching with deeper business relationships.
- A complete status/audit workflow, unless review accountability becomes a near-term product need.

## Suggested cleanup plan

### Phase 1: Clarify current truth

- Update docs to say runtime has core standardized data plus Atlas and tax parcel sidecars.
- Mark stale Atlas CSV-package docs and stale tax parcel handoff sections as historical.
- Add direct database exploration commands to a current docs page.

### Phase 2: Stabilize current loaders

- Fix the tax parcel zero-bill partial population edge case.
- Expand seed metadata to record source family, hash, feature counts, loaded rows, rejected rows, and loaded timestamp.
- Hash standardized GeoJSON contents, not only the manifest file.

### Phase 3: Split boot from load

- Add explicit load commands for standardized, Atlas, and tax parcels.
- Make API startup validate only that the required tables and load versions are present.
- Keep Docker demo convenience with a separate init command or documented reset/load flow.

### Phase 3b: Prepare Railway hosting

- Add Railway-ready environment variables for database, frontend origin, JWT secret, document storage mode, and bucket credentials.
- Add a Railway deployment guide that separates initial deploy, bucket upload, database migration, data load, and verification.
- Keep `LR_Documents/` out of Docker images and upload it to a Railway bucket or compatible S3 store.
- Upload tax bill PDFs to the same bucket under a separate prefix, even though they are currently small enough to bundle.
- Add a data-load command that can load file manifests from bucket object listings.
- Add a production-safe health/readiness check that confirms required data-load versions exist before traffic is trusted.

### Phase 4: Add migrations

- Move schema creation out of `ensureSchema` into migrations.
- Keep a small runtime schema check that reports missing or outdated migrations.
- Stop mutating tables opportunistically during API startup.

### Phase 5: Prepared direct-load model

- Prepare GIS and workbook-derived data outside the app.
- Load final tables or staging tables directly into PostGIS.
- Keep file storage paths stable and load manifests explicitly.
- Remove retired BTG/generated code from normal developer paths.

### Phase 6: Local and hosted parity

- Keep local filesystem support as a storage adapter for development.
- Keep S3-compatible object storage support as the hosted adapter.
- Ensure both adapters populate the same file tables and return the same API response shapes.
- Provide sample/small document fixtures for quick local development when the full PDF package is not needed.
- Document when to use full local data, sample local data, and Railway bucket-backed data.

## Bottom line

The ETL is not inherently wrong, but it is in the wrong place for a stable app. The cleanest direction is to keep PostGIS and the existing review UI, but move data preparation and import out of API startup. QAViewer should serve and edit review data; external or explicit load tools should prepare and load the GIS, Atlas, and tax parcel support data.
