# Atlas Workbook Doc-Tree Plan

## Status

Completed on 2026-04-23 for the first Atlas workbook/doc-tree pass.

Current implementation state:

- DONE: Atlas workbook/doc-tree import, API, UI, document folder matching, page metadata, strict reject reporting, Docker reseed, and verification are complete for this pass.
- Backend and frontend builds pass after the current workbook/doc-tree changes.
- Backend no longer uses `NNC_Package/*.csv` as the Atlas tabular source of truth.
- The active workbook is `Combined_LR_Upload_First3Tabs.xlsx` at the repo root.
- Atlas geometry must come from the existing PostGIS `land_records` GIS layer, not from workbook tabs or legacy CSVs.
- Continuation fixes on 2026-04-23 added existing-volume page-column bootstrap, Docker `LR_Documents` mounting, document manifest file sizes, missing-file UI states, and strict frontend use of backend PDF page targets.
- Docker reset/reseed was verified on 2026-04-23 with the workbook and `LR_Documents` mounted.
- Live API verification found matched parent/child document trees, preserved parent/child page numbers, import reject and missing-geometry warnings, and working PDF content/download for matched files.
- The current workbook import produced no importable featureless documents in `atlas_featureless_docs`; the featureless API/UI path remains implemented and covered by route tests.
- Full backend Vitest now passes after removing obsolete `/api/parcels` smoke coverage and aligning admin-user tests with the active question-area/document model.
- After PDFs were restored to `LR_Documents`, a controlled case-only file rename aligned 255 restored files to workbook `DocName` casing while preserving strict exact filename matching.
- Docker was reset/reseeded after the rename pass. The accepted Atlas manifest now has 489 exact file matches with sizes, up from 234; 8 accepted workbook document rows still have no case-insensitive file match.
- Powellton child links were corrected in the workbook source by changing 112 `Document Link Template.LRNumber` values from short `54...` forms to canonical `NNC.POW.54...` values. This preserves strict runtime matching and links `NNC.POW.54.0001.0.0` to child document `POW-003` / `24_Owner Policy of Title.pdf` at page `56`.

Final verification completed:

- `cd backend && npm run build` passed.
- `cd frontend && npm run build` passed.
- `cd backend && npm run test` passed: 4 test files, 37 tests.
- `cd backend && npm run test:smoke` passed against the live Docker stack.
- `curl`/HTTP health equivalent returned `{"status":"ok"}` from `http://localhost:3001/api/health`.
- Live API confirmed `QA-0008` includes `NNC.POW.54.0001.0.0` with child `POW-003`, `24_Owner Policy of Title.pdf`, page/pageTarget `56`, and `hasFile: true`.
- PostGIS Atlas seed counts after final reseed: 1,693 land records, 497 documents, 2,703 child links, 0 featureless docs, 489 matched document files with sizes, 390 land records missing geometry, and 609 import rejects.

## Agreed Decisions

- Scope is Atlas-only for the first pass.
- Source of truth is the Atlas upload workbook plus the Atlas document folder.
- The active upload workbook is `Combined_LR_Upload_First3Tabs.xlsx`.
- Default workbook path is repo-root `Combined_LR_Upload_First3Tabs.xlsx`, configurable with `ATLAS_WORKBOOK_PATH`.
- Default document root is repo-root `LR_Documents`, configurable with `ATLAS_DOCUMENT_ROOT`.
- Land-record geometry is joined from PostGIS `land_records` by exact LR number match: `land_records.record_number = atlas_land_records.lr_number`.
- Do not use or recreate `NNC_Data/NNC_Package` for this flow.
- Matching is strict.
- Bad rows do not fail the entire import.
- Bad rows are excluded from runtime tables and written to an explicit reject/error report.
- The matched-record UI should show one land-record card with a document tree.
- Featureless docs should not appear in the main matched-record workflow.
- Featureless docs should be available in a separate list.
- `PageNo` from both `LR Info Template` and `Document Link Template` must be preserved.
- First-pass page targeting should support PDFs where possible.

## Workbook Relationship Model

Use the workbook as the tabular source of truth:

1. `LR Info Template`
   - Primary key: `LR_Number`
   - Parent document key: `DocumentNumber`
   - Parent page reference: `PageNo`

2. `LR Documents Template`
   - Primary key: `DocumentNumber`
   - Document metadata table

3. `Document Link Template`
   - Child link key to LR: `LRNumber`
   - Child link key to document: `DocNo`
   - Child page reference: `PageNo`

Runtime relationship shape per Atlas land record:

- one parent document from `LR Info Template.DocumentNumber`
- zero-to-many child documents from `Document Link Template`

Geometry relationship:

- `LR Info Template.LR_Number` is loaded to `atlas_land_records.lr_number`
- `atlas_land_records.geom` is hydrated from `land_records.geom`
- required geometry join: `land_records.record_number` -> `atlas_land_records.lr_number`
- Atlas rows with no matching PostGIS land-record geometry remain in Atlas tables with `geom IS NULL` and are excluded from spatial matching

Document file relationship:

- `LR Documents Template.DocName` is the expected on-disk filename
- the configured `ATLAS_DOCUMENT_ROOT` is scanned recursively
- exact filename matches populate `atlas_document_manifest`
- unmatched document metadata remains importable, but preview/download reports missing file

## Strict Matching Rules

Do not auto-normalize mismatched keys.

Required exact joins:

- `LR Info Template.DocumentNumber` -> `LR Documents Template.DocumentNumber`
- `Document Link Template.DocNo` -> `LR Documents Template.DocumentNumber`
- `Document Link Template.LRNumber` -> `LR Info Template.LR_Number`
- `LR Info Template.LR_Number` -> `land_records.record_number` for geometry hydration only

If a row fails any required join:

- exclude it from runtime Atlas tables
- record it in a reject/error report
- surface summary warnings where useful

Exception: missing geometry does not reject a valid workbook row. The row is retained with `geom IS NULL` and excluded from spatial matches.

Examples already observed during planning:

- zero-padding mismatch such as `LEC-4` vs `LEC-004`
- short-form or variant LR numbers in `Document Link Template`

These should stay as rejects under the agreed strict policy.

## Completed Implementation Sequence

### 1. Replace Atlas import input with workbook + docs folder

DONE. The Atlas import path in `backend/src/lib/atlas.ts` reads:

- repo-root workbook, configurable with `ATLAS_WORKBOOK_PATH`:
  - default: `Combined_LR_Upload_First3Tabs.xlsx`
- workbook sheets:
  - `LR Info Template`
  - `LR Documents Template`
  - `Document Link Template`
  - optional `Featureless Docs` if present
- Atlas docs folder on disk
  - default: `LR_Documents`
  - override with `ATLAS_DOCUMENT_ROOT`

`NNC_Package/*.csv` is not treated as the source of truth for this new flow.

Old per-property workbook names such as `LR_Upload_Template_ALCO.xlsx` are not assumed.

### 2. Keep Atlas as a sidecar model

DONE. The primary standardized runtime was not refactored in this pass.

Keep the main app flow unchanged:

- standardized `question_areas`
- standardized `land_records` overlay
- standardized `management_areas`

This work was constrained to the Atlas schema/API/UI path.

### 3. Tighten Atlas schema semantics

DONE. Existing Atlas tables in `backend/src/lib/schema.ts` were used as the base:

- `atlas_land_records` = LR Info rows
- `atlas_documents` = document master rows
- `atlas_document_links` = child document links only
- `atlas_featureless_docs` = featureless document list
- `atlas_document_manifest` = file lookup metadata
- `atlas_import_rejects` = strict import rejects/error report

Minimal schema support was added for:

- import reject reporting
- parent-document page number
- child-link page number
- source provenance from workbook/doc folder
  - workbook path/sheet/row number
  - document root/file path where available

### 4. Make parent documents first-class in the Atlas API

DONE. Atlas response building now returns:

- LR record metadata
- `parentDocument`
- `childDocuments`
- `parentPageNo`
- child link page references

The API does not flatten everything into a single `documents[]` list.

### 5. Rework the Atlas panel into a document tree

DONE. The frontend Atlas types and UI render:

- one LR card
- a parent document node
- zero-to-many child document nodes
- preview/open/download actions from the tree
- page number display on parent and child edges

Featureless docs are not mixed into the matched-record tree.

### 6. Add featureless-doc list support

DONE. A separate Atlas list/panel section exists for featureless docs.

Featureless docs are queryable/visible when present, but are not treated as matched land-record docs.

### 7. Implement first-pass `PageNo` behavior

DONE. `PageNo` is preserved from:

- `LR Info Template`
- `Document Link Template`

First-pass behavior:

- PDFs: attempt page-targeted open/preview
- non-PDFs: show page number as metadata only

PDF page targeting uses first-pass `#page=` behavior from the preserved `pageTarget`; manual browser behavior can still be revisited if needed, but API/data preservation is complete.

### 8. Add verification

DONE. Smoke/route coverage was expanded for:

- parent document present
- child documents present
- strict rejects produced
- featureless docs excluded from main matched results
- page numbers preserved
- missing PostGIS geometry warning behavior
- document files missing when `ATLAS_DOCUMENT_ROOT` is absent or incomplete

## Files To Re-ground In

- `backend/src/lib/atlas.ts`
- `backend/src/lib/schema.ts`
- `backend/src/routes/questionAreas.ts`
- `backend/src/routes/atlas.ts`
- `backend/src/smoke.test.ts`
- `frontend/src/lib/atlas.ts`
- `frontend/src/components/AtlasPanel.tsx`
- `frontend/src/components/MapWorkspace.tsx`
- `docs/atlas-workbook-doc-tree-plan.md`

## Completed Execution Order

1. DONE: Confirmed `Combined_LR_Upload_First3Tabs.xlsx` is present at repo root.
2. DONE: Restored Atlas source documents in repo-root `LR_Documents/`.
3. DONE: Reset PostGIS and reseeded with `docker compose down -v && docker compose up --build -d`.
4. DONE: Verified backend import loads workbook rows and hydrates geometry from `land_records.record_number`.
5. DONE: Verified backend Atlas query/API contract returns `parentDocument`, `childDocuments`, `featurelessDocuments`, and `importRejectSummary`.
6. DONE: Verified frontend doc-tree UI renders parent/child docs and featureless docs separately.
7. DONE: Verified `PageNo` preservation and first-pass PDF `#page=` targets in API payloads.
8. DONE: Ran build, Vitest, live smoke, health, and spot API verification.

## Next Thread Resume Notes

This pass is complete. In a new thread, start with repository/worktree hygiene or the next product requirement rather than continuing this implementation plan.

Useful verification commands:

```bash
cd backend
npm run build
npm run test
npm run test:smoke
cd ../frontend
npm run build
```

If the workbook or `LR_Documents` change again, reset/reseed with:

```bash
docker compose down -v
docker compose up --build
```

Important current defaults:

- Workbook: `C:\dev\QAViewer\Combined_LR_Upload_First3Tabs.xlsx`
- Document root: `C:\dev\QAViewer\LR_Documents`
- Docker workbook mount: `/workspace/Combined_LR_Upload_First3Tabs.xlsx`
- Docker document root: `/workspace/LR_Documents`

If the docs are stored somewhere else, set `ATLAS_DOCUMENT_ROOT` to that absolute path for local backend runs or update the Docker bind mount/env var.

Known remaining data facts, not blockers for this pass:

- `atlas_featureless_docs` is currently `0` because this workbook has no importable `Featureless Docs` sheet data.
- 8 accepted workbook document rows still have no case-insensitive file match in `LR_Documents`.
- 390 Atlas land records have no matching PostGIS `land_records.record_number` geometry and are excluded from spatial matches.
- 609 workbook rows are rejected by strict validation after the Powellton source fix.

## Non-Goals For This Pass

- Do not refactor the primary standardized `land_records` runtime model.
- Do not auto-fix bad workbook keys.
- Do not mix featureless docs into matched-record results.
- Do not change the existing QA-upload document workflow.
- Do not reintroduce `NNC_Data/NNC_Package` as an Atlas runtime dependency.
- Do not use legacy generated CSVs as the Atlas tabular source of truth.
