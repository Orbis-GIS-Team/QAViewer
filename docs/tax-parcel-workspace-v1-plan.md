# Tax Parcel Workspace V1 Plan

## Status

Not implemented as of 2026-04-23.

This document is a handoff plan for building a tax parcel review workspace parallel to the existing Atlas workspace. The intent is to let a fresh chat pick up implementation without re-discovering the current repo structure, active runtime model, or `DataBuild` source layout.

## Summary

Build a new right-rail `Tax Parcels` tab alongside the existing `Atlas` tab in the review workspace.

This build should:

- keep the current left-side question-area review workflow unchanged
- keep the active standardized runtime model unchanged
- import tax parcel support data from `DataBuild/` as a sidecar model, similar to Atlas
- buffer the selected question-area point and intersect parcel polygons inside that buffer
- return one or more matched tax parcels, ranked so the UI can identify a primary parcel
- show parcel details and linked tax bills
- support inline PDF preview plus download/open actions for tax bills

This build should not:

- change `data/standardized/*`
- make the browser read shapefiles or tax-bill folders directly
- replace the current `land_records` or `management_areas` overlays
- add parcel editing, upload, or write-back behavior in v1

## Confirmed Findings

### Current app behavior

- The active runtime model only seeds `question_areas`, `land_records`, and `management_areas` from `data/standardized/`.
- Atlas is already implemented as an additive right-side support workflow, not as part of the standardized seed contract.
- The current Atlas flow is anchored in:
  - `frontend/src/components/MapWorkspace.tsx`
  - `frontend/src/components/AtlasPanel.tsx`
  - `frontend/src/components/AtlasMapOverlays.tsx`
  - `frontend/src/lib/atlas.ts`
  - `backend/src/routes/questionAreas.ts`
  - `backend/src/routes/atlas.ts`
  - `backend/src/lib/atlas.ts`
  - `backend/tests/atlas.smoke.test.ts`

### Tax bill file layout

- The current bill folder is `DataBuild/TaxBills`.
- Confirmed bill filenames are currently `YYYY_<ParcelID>.pdf`, not `U_<parcel-code>.pdf`.
- Confirmed examples:
  - `2024_58565.pdf`
  - `2024_58566.pdf`
  - `2024_58567.pdf`
  - `2024_58568.pdf`
  - `2025_58565.pdf`
  - `2025_58566.pdf`
  - `2025_58567.pdf`
  - `2025_58568.pdf`

### Parcel lookup data

- `DataBuild/ParcelsListingReport.geojson` includes `ParcelID`, `ParcelCode`, `OwnerName`, `PropertyName`, `ParcelStatus`, `TaxProgram`, `GISAcres`, `County`, and `State`.
- The confirmed bill IDs map cleanly to parcel report rows:
  - `58565` -> `TV-003-964000-000`
  - `58566` -> `SH-002-437000-000`
  - `58567` -> `TD-005-185000-000`
  - `58568` -> `YV-007-726000-000`
- This means `ParcelID` is the correct primary key for v1 bill lookup, while `ParcelCode` should remain the main reviewer-facing display key.

### Parcel geometry source

- `DataBuild/pa_warren_with_report_data.shp` is the strongest available v1 parcel geometry source.
- Its metadata shows it is a Warren parcel polygon layer produced by spatial join and already enriched with report fields including:
  - `ParcelCode`
  - `ParcelID`
  - `ParcelStatus`
  - `OwnerName`
  - `GISAcres`
  - county/state fields
- This is a better runtime source than the point-based `ParcelsListingReport.geojson` because the requested workflow is buffer-to-parcel intersection.

### Useful live QA targets

- Warren question areas in the current standardized seed include:
  - `QA-0073` -> `TD-005-185000-000`
  - `QA-0074` -> `YV-007-726000-000`
  - `QA-0075` -> `YV-007-996000-000`
- `QA-0073` and `QA-0074` are good first smoke targets because their parcel codes line up with confirmed bill-bearing parcel IDs in `DataBuild`.

## Agreed Decisions

- Treat tax parcel review as a sidecar model, the same way Atlas is treated.
- Do not add tax parcel sources to `data/standardized/` in this pass.
- Use `DataBuild/pa_warren_with_report_data.shp` as the parcel geometry source for v1.
- Use `ParcelID` as the primary tax bill join key.
- Keep `ParcelCode` as the main search and display key in the UI.
- Reuse Atlas buffer presets for v1: `100`, `500`, `1000`, and `5000` feet.
- Return all parcels intersecting the active buffer, but rank them and mark one as primary.
- Keep this feature read-only in v1.

## Files To Re-ground In

Start implementation from a fresh thread/context and re-ground in:

- `frontend/src/components/MapWorkspace.tsx`
- `frontend/src/components/AtlasPanel.tsx`
- `frontend/src/components/AtlasMapOverlays.tsx`
- `frontend/src/lib/atlas.ts`
- `frontend/src/lib/api.ts`
- `backend/src/config.ts`
- `backend/src/lib/schema.ts`
- `backend/src/lib/seed.ts`
- `backend/src/routes/questionAreas.ts`
- `backend/src/routes/atlas.ts`
- `backend/src/app.ts`
- `backend/tests/atlas.smoke.test.ts`
- `backend/src/smoke.test.ts`
- `docker-compose.yml`

Recommended implementation branch:

- `codex/tax-parcel-workspace-v1`

Do not modify `data/standardized/*` or `docs/dataset-contract.md` for this pass.

## Implementation Changes

### Backend: config and startup

- `backend/src/config.ts`
  Add `taxParcelSourcePath` and `taxBillRoot` config entries, defaulting to the `DataBuild` shapefile and `TaxBills` folder.

- `.env.example`
  Add `TAX_PARCEL_SOURCE_PATH` and `TAX_BILL_ROOT` so local and Docker runs can override the defaults.

- `docker-compose.yml`
  Mount the parcel shapefile set and the `DataBuild/TaxBills` folder into the API container, and pass the new env vars through. The current Compose file only mounts Atlas sources.

- `backend/src/lib/seed.ts`
  Add `ensureTaxParcelSeedData(client)` beside `ensureAtlasSeedData(client)` so import happens during the existing startup/bootstrap path.

### Backend: schema and import

- `backend/src/lib/schema.ts`
  Add `tax_parcels` and `tax_bill_manifest` tables plus indexes.

  `tax_parcels` should store:
  - normalized parcel identifiers such as `parcel_id`, `parcel_code`, `account_number`
  - display fields such as `owner_name`, `property_name`, `parcel_status`, `tax_program`, `ownership_type`
  - county/state context and acreage fields
  - `raw_properties`
  - polygon or multipolygon geometry

  `tax_bill_manifest` should store:
  - `parcel_id`
  - parsed bill year
  - filename
  - extension
  - size bytes
  - package-relative path or bill-relative path
  - source root path metadata

- `backend/src/lib/taxParcels.ts`
  Create a new sidecar service module parallel to `backend/src/lib/atlas.ts`.

  Responsibilities:
  - import parcel geometries from `DataBuild/pa_warren_with_report_data.shp`
  - normalize and store parcel fields
  - scan `DataBuild/TaxBills`
  - parse filenames of the form `YYYY_<ParcelID>.pdf`
  - populate `tax_bill_manifest`
  - protect against source mismatch using `seed_metadata`
  - validate supported buffer presets
  - resolve safe on-disk file paths for preview/download
  - build the question-area query result for the frontend

- `backend/package.json`
  Add a shapefile-reading dependency if runtime import will read `.shp` directly in Node. If the implementation chooses a pre-converted GeoJSON source instead, document that decision and skip this dependency change.

- `backend/package-lock.json`
  Update to reflect the backend dependency change if a new parser is added.

### Backend: routes

- `backend/src/routes/questionAreas.ts`
  Add `GET /api/question-areas/:code/tax-parcels?buffer=<number>&unit=feet`.

  Behavior:
  - load the selected question area from the existing `question_areas` table
  - build a geography buffer around the point
  - spatially intersect `tax_parcels`
  - rank results by overlap and then distance
  - return buffer geometry, summary counts, parcel detail rows, and attached bills

- `backend/src/routes/taxParcels.ts`
  Add support routes for:
  - `GET /api/tax-parcels/bills/:billId/content`
  - `GET /api/tax-parcels/bills/:billId/download`

  Mirror Atlas file-serving behavior:
  - safe path resolution
  - inline preview for PDFs
  - download fallback
  - controlled `404` / `415` responses

- `backend/src/app.ts`
  Register the new `/api/tax-parcels` router.

### Frontend: query and panel

- `frontend/src/lib/taxParcels.ts`
  Add:
  - `useTaxParcelQuery`
  - `TaxParcelQueryResult`
  - `TaxParcel`
  - `TaxBill`
  - buffer option helpers parallel to the Atlas hook

- `frontend/src/components/TaxParcelPanel.tsx`
  Create a right-rail panel parallel to `AtlasPanel`.

  It should:
  - show an empty state with no selected question area
  - show fixed buffer controls
  - show query loading and error states
  - render matched parcels as expandable cards
  - identify the primary parcel
  - list bill files grouped or labeled by year
  - support preview/open/download actions

- `frontend/src/components/TaxParcelMapOverlays.tsx`
  Draw:
  - the active tax parcel buffer geometry
  - highlighted matched parcel polygons

  Keep these overlays separate from Atlas overlays and from the current `land_records` and `management_areas` layers.

- `frontend/src/components/MapWorkspace.tsx`
  Add the right-panel tab switch and tax parcel state.

  Expected changes:
  - add tab state such as `atlas | tax-parcels`
  - keep `AtlasPanel` as one tab
  - render `TaxParcelPanel` as the second tab
  - load `useTaxParcelQuery` off the selected question area and buffer
  - render `TaxParcelMapOverlays` when that tab is active or when tax parcel results exist
  - keep the current left-side question-area detail workflow unchanged

- `frontend/src/lib/api.ts`
  Reuse the existing authenticated download helper. Only change this file if tax-bill preview/download needs shared helper improvements.

- `frontend/src/styles.css`
  Add:
  - right-rail tab styles
  - `tax-parcel-*` panel styles
  - responsive behavior for the new tab switch and bill preview area

### Tests and verification

- `backend/tests/atlas.smoke.test.ts`
  Use this as the contract template for the new route-level test file.

- `backend/tests/tax-parcels.smoke.test.ts`
  Add mocked route tests for:
  - valid tax parcel query
  - invalid buffer
  - invalid unit
  - question area not found
  - bill content route
  - bill download route
  - missing file handling

- `backend/src/smoke.test.ts`
  Extend the live smoke test to call the tax parcel query route and, when available, preview or download one bill for a known Warren-backed question area.

- `README.md`
  Add the new `DataBuild` runtime dependencies and note that source changes require reset/reseed, the same way Atlas and standardized seeds do.

## Public Interfaces and Types

Add:

- `GET /api/question-areas/:code/tax-parcels?buffer=<100|500|1000|5000>&unit=feet`
- `GET /api/tax-parcels/bills/:billId/content`
- `GET /api/tax-parcels/bills/:billId/download`

The tax parcel query response should include:

- `questionAreaCode`
- `bufferValue`
- `bufferUnit`
- `bufferGeometry`
- `matchedParcelCount`
- `matchedBillCount`
- `parcels`
- `warnings`

Each parcel should include:

- identifiers such as `parcelId`, `parcelCode`, and `accountNumber`
- owner, property, status, county, state, acreage, and any normalized parcel metadata needed by the panel
- geometry
- a primary-rank or `isPrimaryMatch` flag
- `bills[]`

Each bill should include:

- stable bill id
- parcel id
- year
- filename
- size
- previewability
- `contentUrl`
- `downloadUrl`

## Assumptions and Defaults

- This is a sidecar workspace, not a replacement for the active question-area-first runtime model.
- `data/standardized/*` remains the canonical seed contract for the active app.
- `DataBuild/pa_warren_with_report_data.shp` is the parcel geometry source for v1.
- `DataBuild/TaxBills` is the bill file source for v1.
- `ParcelID` is the primary bill join key for v1 because the confirmed filenames are `YYYY_<ParcelID>.pdf`.
- Buffer units remain fixed to `feet`.
- The initial supported buffer presets should match Atlas: `100`, `500`, `1000`, and `5000`.
- The first implementation pass is read-only.

## Non-Goals

- changing the standardized seed contract
- replacing the current `Atlas` workspace
- replacing the current `land_records` or `management_areas` overlays
- adding parcel edit, upload, or comment workflows in v1
- broadening this immediately into a generalized parcel runtime for non-Warren sources without confirmed data

## Recommended Sequence

1. Add config/env/docker wiring for `DataBuild` parcel and bill sources.
2. Decide the shapefile import approach and add any backend dependency needed for it.
3. Add schema for `tax_parcels` and `tax_bill_manifest`.
4. Implement `backend/src/lib/taxParcels.ts` import and query logic.
5. Register the new backend routes.
6. Add the frontend tax parcel hook and types.
7. Add `TaxParcelPanel`, `TaxParcelMapOverlays`, and the right-rail tab switch in `MapWorkspace`.
8. Add route tests and extend the live smoke test.
9. Run build and smoke verification against the live stack.

## Verification

Run after implementation:

```bash
cd backend && npm run build
cd frontend && npm run build
cd backend && npm run test
cd backend && npm run test:smoke
curl http://localhost:3001/api/health
curl -I http://localhost:5173
```

Manual smoke targets:

- `QA-0073`
- `QA-0074`
- one Warren question area with no matching bill file

Manual checks:

- selecting a question area leaves the left review workflow unchanged
- the right rail can switch between `Atlas` and `Tax Parcels`
- tax parcel buffer changes refetch results
- the map shows the active tax parcel buffer and matched polygons
- parcel cards show stable identifiers and bill lists
- PDF preview works for at least one bill
- download works for at least one bill

## Risks and Open Questions

- The current parcel geometry source appears Warren-specific. If broader geography is required immediately, the source dataset needs to expand before this becomes a nationwide workflow.
- Runtime shapefile parsing may require a new backend dependency or a pre-conversion step.
- Duplicate parcel geometries or duplicate `ParcelID` values in the shapefile need deterministic handling during import.
- Future bill naming may shift to parcel-code-based names such as `U_<parcel-code>`. The importer should be written so a secondary filename strategy can be added without redesigning the API.
- If the parcel source changes after import, startup should fail fast with a clear reseed/reset message, matching the current Atlas and standardized-seed behavior.
