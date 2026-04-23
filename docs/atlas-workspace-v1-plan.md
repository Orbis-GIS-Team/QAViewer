# Atlas Review Workspace V1 Plan

## Summary

Build an Atlas document-review module in the reserved right-side workspace without changing the current left-side question-area review workflow or the standardized seed pipeline. Implementation should start tomorrow in a fresh context window on branch `codex/atlas-workspace-v1`.

This build will:

- import the Atlas package as-is into Atlas-specific tables
- serve Atlas files directly from `C:\dev\QAViewer\NNC_Data\NNC_Package`
- match Atlas land records to the selected question area by spatial buffer only
- use fixed buffer presets of `100`, `500`, `1000`, and `5000` feet
- support inline preview for Atlas documents in the reserved workspace panel

This build will not:

- clean or normalize Atlas data
- reconcile Atlas data with the app's current `land_records` layer
- move Atlas files into `backend/uploads`
- change the standardized seed model in `data/standardized/`

## Tomorrow Kickoff

Start a fresh thread/context and immediately create or switch to branch `codex/atlas-workspace-v1`.

Before editing, re-ground in:

- `frontend/src/components/MapWorkspace.tsx`
- `backend/src/lib/schema.ts`
- `backend/src/routes/questionAreas.ts`
- `backend/src/routes/layers.ts`
- `C:\dev\QAViewer\NNC_Data\NNC_Package\HANDOFF.md`

Do not modify `data/standardized/*` or change the current standardized seed/reset behavior.

## Implementation Changes

### Backend: Atlas storage and import

Add Atlas-specific tables alongside the current app schema:

- `atlas_land_records`
- `atlas_documents`
- `atlas_document_links`
- `atlas_featureless_docs`
- `atlas_document_manifest`

Import Atlas CSV data as-is from `C:\dev\QAViewer\NNC_Data\NNC_Package`.

Rules:

- do not dedupe or normalize Atlas rows in this build
- do not reuse the current QA upload `documents` table
- allow `atlas_land_records.geom` to be nullable because the package includes records without geometry
- store file metadata and package-relative paths only; Atlas files remain on disk in the package directory

### Backend: Atlas APIs

Add:

- `GET /api/question-areas/:code/atlas?buffer=<number>&unit=feet`
- `GET /api/atlas/documents/:documentNumber/content`
- `GET /api/atlas/documents/:documentNumber/download`

Atlas query route behavior:

- load the selected question area from the existing `question_areas` table
- build a `geography` buffer around the question-area point using feet
- query intersecting `atlas_land_records` with non-null geometry only
- join linked Atlas documents through `atlas_document_links` and `atlas_documents`
- resolve file availability using `atlas_document_manifest.package_relative_path`

The Atlas query response should include:

- selected question area code
- buffer value and unit
- buffer geometry as GeoJSON
- matched land records with geometry and core Atlas fields
- linked documents per land record
- warnings for missing geometry, missing file, or unsupported preview cases

File resolution must use package-relative paths under `C:\dev\QAViewer\NNC_Data\NNC_Package`, not original manifest source-folder paths.

### Frontend: Reserved workspace Atlas panel

Replace the placeholder reserved workspace section in `MapWorkspace` with an `AtlasPanel` tied to `selectedDetail`.

Panel behavior:

- show an empty state when no question area is selected
- render fixed buffer controls for `100`, `500`, `1000`, and `5000` feet
- refetch Atlas results whenever the selected question area or active buffer changes
- show matched-record and linked-document counts
- list matched Atlas land records with core fields and linked documents
- support inline preview for PDFs and images using the new content endpoint
- keep open and download actions available from the panel

Add Atlas-specific loading and error state without disturbing the existing question-area detail loading state.

Keep the current left-rail review controls, comments, and uploaded QA documents unchanged.

### Frontend: Map behavior

Keep the existing seeded `land_records` overlay and legend unchanged for v1.

Add Atlas visual context from the Atlas API response only:

- active buffer overlay
- highlighted matched Atlas geometries when present

Do not replace the current app `land_records` layer with Atlas data in this build.

## Public Interfaces and Types

New backend routes:

- `GET /api/question-areas/:code/atlas?buffer=<100|500|1000|5000>&unit=feet`
- `GET /api/atlas/documents/:documentNumber/content`
- `GET /api/atlas/documents/:documentNumber/download`

New frontend types:

- `AtlasRecord`
- `AtlasDocument`
- `AtlasQueryResult`
- `AtlasWarning`

Extend map workspace state with:

- active Atlas buffer preset
- Atlas query payload
- Atlas loading and error state
- active preview document

## Test Plan

Backend schema and import:

- Atlas tables create successfully on a fresh database
- Atlas import loads package CSVs without touching standardized seed tables

Atlas query route:

- valid question area and valid buffer return buffer geometry and zero or more records
- records with null geometry are excluded from spatial matches
- missing question area returns `404`
- unsupported buffer or unit returns `400`

Atlas file routes:

- existing PDF or image returns correct content type for inline preview
- missing manifest entry or missing file returns `404`

Frontend behavior:

- selecting a question area populates the Atlas panel
- changing buffer refetches and updates summary and results
- inline preview renders in the right panel
- no-result state is clear and non-blocking
- existing left-rail review workflow still works

Verification:

- `cd backend && npm run build`
- `cd frontend && npm run build`
- manual smoke test against a known Atlas-backed question area

## Assumptions and Defaults

- Buffer unit is fixed to `feet`.
- Atlas matching is spatial-only for v1.
- Atlas data is authoritative only for the Atlas panel and Atlas file lookup in this build.
- Featureless Atlas documents are not surfaced in the primary matched-record workflow for v1.
- Data cleanup, dedupe repair, Atlas/current-land-record reconciliation, and broader document intelligence are deferred.
