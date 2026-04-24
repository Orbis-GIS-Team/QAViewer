# Tax Parcel Workspace V1 Handoff

## Status

Checkpoint captured on 2026-04-23.

The backend tax parcel sidecar is partially implemented and compiles.
The frontend tax parcel workspace has not been started in this branch.

## What Was Completed

### Backend wiring

- Added `taxParcelSourcePath` and `taxBillRoot` to `backend/src/config.ts`.
- Registered tax parcel seeding in `backend/src/lib/seed.ts`.
- Registered the new `/api/tax-parcels` router in `backend/src/app.ts`.

### Backend schema

- Added `tax_parcels` and `tax_bill_manifest` tables to `backend/src/lib/schema.ts`.
- Added indexes for tax parcel geometry, parcel lookup fields, and bill manifest lookup fields.

### Backend service implementation

- Added `backend/src/lib/taxParcels.ts`.
- Implemented sidecar seed hashing via `seed_metadata`, parallel to Atlas.
- Implemented shapefile import from `DataBuild/pa_warren_with_report_data.shp` using the `shapefile` npm package.
- Implemented tax bill manifest scanning from `DataBuild/TaxBills`.
- Implemented bill filename parsing for `YYYY_<ParcelID>.pdf`.
- Implemented ranked question-area parcel query logic:
  - fixed buffer presets `100 | 500 | 1000 | 5000`
  - unit validation limited to `feet`
  - spatial match by buffer intersection
  - ranking by overlap area, then point distance
  - attached bill lookup by `parcel_id`
- Implemented safe file resolution and preview/download metadata for tax bills.

### Backend routes

- Added `GET /api/question-areas/:code/tax-parcels?buffer=<preset>&unit=feet` in `backend/src/routes/questionAreas.ts`.
- Added `backend/src/routes/taxParcels.ts` with:
  - `GET /api/tax-parcels/bills/:billId/content`
  - `GET /api/tax-parcels/bills/:billId/download`

### Tests

- Added mocked route coverage in `backend/tests/tax-parcels.smoke.test.ts`.

### Dependency change

- Added `shapefile` and `@types/shapefile` to `backend/package.json`.
- Updated `backend/package-lock.json`.

## Verification Completed

- `cd backend && npm run build`
- Result: passed

## Not Completed

### Frontend

None of the planned frontend tax parcel work has been implemented yet.

Still needed:

- `frontend/src/lib/taxParcels.ts`
- `frontend/src/components/TaxParcelPanel.tsx`
- `frontend/src/components/TaxParcelMapOverlays.tsx`
- `frontend/src/components/MapWorkspace.tsx` tab switch and query wiring
- `frontend/src/styles.css` tax parcel styles

### Runtime wiring

Still needed:

- `.env.example`
- `docker-compose.yml`
- `README.md`

Important: the current Docker setup does not mount `DataBuild/` into the API container, so the new backend code will not work in Docker until that is added.

### Smoke and test coverage

Still needed:

- extend `backend/src/smoke.test.ts` for the new tax parcel endpoints
- run `cd backend && npm run test`
- run `cd backend && npm run test:smoke`
- run `cd frontend && npm run build` after frontend work is added

## Files Changed In This Checkpoint

### Modified

- `backend/package.json`
- `backend/package-lock.json`
- `backend/src/app.ts`
- `backend/src/config.ts`
- `backend/src/lib/schema.ts`
- `backend/src/lib/seed.ts`
- `backend/src/routes/questionAreas.ts`

### Added

- `backend/src/lib/taxParcels.ts`
- `backend/src/routes/taxParcels.ts`
- `backend/tests/tax-parcels.smoke.test.ts`

## Known Notes

### Current bill id behavior

- `backend/src/lib/taxParcels.ts` currently generates a stable hashed `billId` from the bill-relative path.
- This is stable for routing and tests, but it is not the natural `YYYY_<ParcelID>` key.
- If the next thread wants the route ids to be more human-readable, this is the place to revisit.

### Current source assumptions

- Shapefile geometry is read directly from `DataBuild/pa_warren_with_report_data.shp`.
- DBF encoding is read from the `.cpg` sidecar when present.
- Parcel ID normalization currently prefers `ParcelID`, falling back to `FIP_Parcel`.
- Parcel display normalization currently uses the truncated Warren shapefile field names such as:
  - `ParcelCode`
  - `PropertyNa`
  - `ParcelStat`
  - `OwnershipT`
  - `Descriptio`
  - `LandUseTyp`

### Existing unrelated worktree changes

The worktree already had unrelated/uncommitted frontend changes before this checkpoint:

- `frontend/src/components/AtlasPanel.tsx`
- `frontend/src/styles.css`

There are also untracked data/docs/temp paths already present:

- `DataBuild/`
- `docs/tax-parcel-workspace-v1-plan.md`
- `tmp/`

The next thread should avoid reverting or normalizing those unless explicitly requested.

## Recommended Next Steps

1. Update `.env.example`, `docker-compose.yml`, and `README.md` for `DataBuild` parcel/bill runtime support.
2. Implement the frontend tax parcel tab, panel, query hook, and map overlays.
3. Extend `backend/src/smoke.test.ts` to hit:
   - `GET /api/question-areas/QA-0073/tax-parcels?buffer=500&unit=feet`
   - one bill `download`
   - one bill `content`
4. Run:
   - `cd backend && npm run test`
   - `cd backend && npm run test:smoke`
   - `cd frontend && npm run build`

## Suggested Resume Prompt

Use this in the next thread:

```text
Continue the tax parcel workspace v1 implementation from docs/tax-parcel-workspace-v1-handoff.md. Finish the remaining runtime wiring, frontend tab/panel/overlays, and smoke verification without reverting unrelated frontend worktree changes.
```
