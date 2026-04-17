# QAViewer Code Review And Stabilization Report

Date: 2026-04-03

Scope: full code review and stabilization pass across the current working tree.

Verification performed:

- `cd backend && npm run build`
- `cd frontend && npm run build`
- Confirmed there is no application test suite in `backend/` or `frontend/`

Context note:

- This review is based on the current working tree, which already contains local unstaged changes in core files.
- Findings below are based on code that is present now, not on assumptions about earlier revisions.

Implementation update, 2026-04-16:

- Phase 1 stabilization work has mostly landed: admin parcel-comment delete guards, reviewer feedback rendering, first-class `review` status in the UI, misleading parcel document upload controls removed, upload MIME fallback relaxed, and parcel points wired into the main map as an optional context layer.
- Phase 2 backend hardening has partly landed: generated manifest hash enforcement was added, an explicit local reset/reseed workflow was documented, and duplicated parcel/question-area matching SQL was centralized in `backend/src/lib/parcelQuestionAreaMatch.ts`.
- Phase 3 GIS correction has started: `scripts/export_seed_data.py` now targets `BTG_Spatial_Fix_Primary_Erase` and `BTG_Spatial_Fix_Comparison_Erase`, validates source group output, and accepts source/layer overrides for compatible future datasets.
- Blocked: `data/generated/` was not regenerated and PostGIS was not reseeded. A Docker/GDAL toolchain can run, but the mounted `BTG_PTV_Implementation.gdb` exposes only `BTG_Points_NoArches_12Feb26`, `BTG_Spatial_Fix_Primary_Layer`, and `BTG_MGMT_NoArches`; it does not contain the required mismatch erase layers.
- Live smoke verification passed on 2026-04-16 with Docker/API/PostGIS running: `cd backend && npm run test:smoke`.
- Service checks passed on 2026-04-16: `curl http://localhost:3001/api/health` returned `{"status":"ok"}` and `curl -I http://localhost:5173` returned `HTTP 200`.
- Verified after implementation: `cd backend && npm run build`, `cd frontend && npm run build`, and `git diff --check` passed. Dependencies had to be installed first because `node_modules` was absent.

## 1. Executive Summary

### Overall Health Of The Codebase

QAViewer is organized as a simple pipeline:

- `scripts/export_seed_data.py` generates GeoJSON seed assets
- the backend bootstraps schema and seed data, then serves a small set of route groups
- the frontend has a thin app shell plus one very large reviewer UI in `frontend/src/components/MapWorkspace.tsx`

The codebase is workable, and both backend and frontend builds pass, but there is visible AI-churn:

- the checked-in generated GIS assets still reflect the old source model until regeneration is run
- the main review UI remains a large monolith even after behavior fixes
- the main remaining dead data surface is stale generated county GeoJSON, which should be cleaned up by the next successful exporter run
- smoke coverage exists as a live API entrypoint and passes against the Docker stack

### Main Risks

The biggest risks are correctness and maintainability, not style:

- checked-in question-area seed assets still come from the old source layer until regeneration is run
- generated seed files are still stale until the corrected exporter is run
- seed behavior now fails fast on manifest drift, which requires explicit local reset/reseed after regeneration
- structural cleanup remains around the large `MapWorkspace` component

### What Is Working Well

- the PostGIS bbox-serving pattern is pragmatic and easy to reason about
- the backend route/lib split is small enough to stabilize without a rewrite
- auth and admin behavior are relatively compact
- frontend and backend builds both succeed

## 2. Prioritized Findings

### Critical

#### 1. Question areas are generated from the wrong source layers

Status, 2026-04-16: partially fixed. `scripts/export_seed_data.py` now reads the two mismatch erase layers and validates source breakdown, but `data/generated/` has not been regenerated because the mounted geodatabase does not include those layers.

Why it matters:

- This undercuts the core business object of the application.
- If question areas are supposed to come from mismatch layers, the app is reviewing the wrong records.

Evidence:

- `scripts/export_seed_data.py` builds question areas from `BTG_Spatial_Fix_Primary_Layer`
- `scripts/export_seed_data.py` hard-codes `source_group = "primary"`
- `data/generated/manifest.json` shows `557` primary-only question areas
- This conflicts with `AGENTS.md` and `README.md`, which describe question areas as derived from mismatch layers

Relevant code:

- `scripts/export_seed_data.py:70`
- `scripts/export_seed_data.py:133`
- `data/generated/manifest.json`
- `AGENTS.md:7`
- `README.md:3`

Recommended fix:

- Rewrite the export pipeline so question areas are derived from the intended mismatch layers.
- Keep parcel context as enrichment only.
- Add a regression check on expected source groups and counts before reseeding.

#### 2. Seeding is based on "non-empty table" checks, so stale GIS data is silently accepted

Status, 2026-04-16: fixed in code. The backend now stores and compares a SHA-256 hash of `data/generated/manifest.json`, and startup fails with a reset/reseed message if populated seed tables do not match the current generated manifest.

Why it matters:

- Once tables have rows, regenerated source data will not propagate to PostGIS.
- That breaks the "geodatabase is the source of truth" model in practice.

Evidence:

- `backend/src/lib/seed.ts` only checks row counts
- each table is seeded only when count is zero

Relevant code:

- `backend/src/lib/seed.ts:52`
- `backend/src/lib/seed.ts:63`

Recommended fix:

- Add a seed version or manifest hash table.
- Fail fast when generated assets change but the database is out of sync.
- Provide an explicit reseed/reset workflow.

### High

#### 3. Admin deletion ignores parcel-authored activity and can still fail on foreign keys

Status, 2026-04-16: fixed in code. Admin list/detail payloads include `parcelCommentCount`; frontend delete guards use it; backend deletion returns controlled `409` when parcel-authored activity exists.

Why it matters:

- A user can look deletable in the UI and backend checks even when `parcel_comments` still reference them.
- In that case deletion can fail as an unexpected server error instead of a controlled conflict response.

Evidence:

- admin activity counting only checks `comments` and `documents`
- delete blocking uses only those counts
- `parcel_comments.author_id` is a live foreign key

Relevant code:

- `backend/src/routes/admin.ts:70`
- `backend/src/routes/admin.ts:100`
- `backend/src/routes/admin.ts:282`
- `backend/src/lib/schema.ts:169`

Recommended fix:

- Include `parcel_comments` and any future status-history activity in user stats and deletion guards.
- Return a controlled `409` for users with authored parcel activity.

#### 4. Workflow status handling is internally inconsistent

Status, 2026-04-16: fixed for current behavior. `review` remains a first-class persisted state and is now selectable/labeled directly in the reviewer UI.

Why it matters:

- `review` is a valid persisted state in the backend.
- The frontend cannot select it, sometimes relabels it as `Active`, and parcel detail hides review items entirely.
- This produces inconsistent behavior and confusing UI.

Evidence:

- backend allows `review`
- frontend omits it from `STATUS_OPTIONS`
- question area UI displays `review` as `Active`
- parcel visibility depends on whether `QA_Status` contains the substring `"active"`

Relevant code:

- `backend/src/routes/questionAreas.ts:64`
- `backend/src/routes/parcels.ts:9`
- `backend/src/lib/schema.ts:40`
- `frontend/src/components/MapWorkspace.tsx:171`
- `frontend/src/components/MapWorkspace.tsx:997`
- `frontend/src/components/MapWorkspace.tsx:1158`
- `frontend/src/components/MapWorkspace.tsx:1504`

Recommended fix:

- Decide whether `review` is a real workflow state or just display copy.
- Align backend enums, frontend select options, badge labels, and parcel visibility rules around one definition.

#### 5. `MapWorkspace` records feedback but never renders it

Status, 2026-04-16: fixed in code. `MapWorkspace` now renders feedback through a toast, auto-clears it, and surfaces validation/errors for save/comment/upload/download/load flows.

Why it matters:

- Save, comment, upload, and download failures become silent to the user.
- Normal validation problems can look like broken buttons or stalled UI.

Evidence:

- `feedback` state exists and is written in many handlers
- no part of the component renders `feedback`

Relevant code:

- `frontend/src/components/MapWorkspace.tsx:219`
- `frontend/src/components/MapWorkspace.tsx:247`
- `frontend/src/components/MapWorkspace.tsx:493`
- `frontend/src/components/MapWorkspace.tsx:610`
- render tree starts at `frontend/src/components/MapWorkspace.tsx:723` and never uses `feedback`

Recommended fix:

- Render a shared toast or inline status banner in `MapWorkspace`.
- Add client-side validation for known backend rejects such as blank `summary`.

### Medium

#### 6. Parcel-to-question-area matching logic is duplicated across multiple endpoints

Status, 2026-04-16: fixed in code. Matching SQL now lives in `backend/src/lib/parcelQuestionAreaMatch.ts` and is used by dashboard, layers, parcels, and question-area routes.

Why it matters:

- A matching rule change requires edits in several files.
- Duplication increases drift risk and makes bugs harder to fix consistently.

Evidence:

- essentially the same lateral join appears in dashboard, layers, parcels, and question area routes

Relevant code:

- `backend/src/routes/dashboard.ts:47`
- `backend/src/routes/layers.ts:47`
- `backend/src/routes/layers.ts:159`
- `backend/src/routes/parcels.ts:42`
- `backend/src/routes/questionAreas.ts:149`

Recommended fix:

- Move matching into one shared SQL view or helper.
- Test the matching behavior once instead of indirectly in every route.

#### 7. Parcel document support is effectively a dead or contradictory feature

Status, 2026-04-16: fixed for current UI. Parcel-level upload controls and copy were removed; question-area documents remain functional.

Why it matters:

- The UI suggests parcel-level documents exist.
- Linked parcels redirect to question-area detail.
- Unlinked parcels cannot upload because they have no `questionAreaCode`.
- The current UX is misleading.

Evidence:

- parcel detail derives upload target from `questionAreaCode`
- linked parcels redirect to question-area selection
- parcel upload UI still renders
- backend parcel documents are really question-area documents

Relevant code:

- `frontend/src/components/MapWorkspace.tsx:231`
- `frontend/src/components/MapWorkspace.tsx:416`
- `frontend/src/components/MapWorkspace.tsx:663`
- `frontend/src/components/MapWorkspace.tsx:1261`
- `backend/src/routes/parcels.ts:106`

Recommended fix:

- Either remove parcel document controls until there are real parcel documents,
- or implement true parcel-scoped documents and stop redirecting all linked parcels away from parcel detail.

#### 8. The main review UI is a 1,500-line monolith with overlapping selection state

Why it matters:

- `selectedCode`, `selectedDetail`, `selectedParcelId`, and `selectedParcelDetail` can drift.
- One file currently mixes fetching, state transitions, map behavior, forms, and rendering.
- This makes future changes risky.

Evidence:

- `frontend/src/components/MapWorkspace.tsx` is 1,500+ lines and owns nearly all review behavior

Relevant code:

- `frontend/src/components/MapWorkspace.tsx:192`
- `frontend/src/components/MapWorkspace.tsx:1512`

Recommended fix:

- Split the component into hooks/components for search, selection, question-area detail, parcel detail, and map layers.
- Prefer one discriminated selection state instead of several overlapping pieces of state.

#### 9. There is no application-level test coverage

Status, 2026-04-16: fixed for the current live-stack scope. A live backend smoke test entrypoint was added and passed against the running Docker/API/PostGIS stack.

Why it matters:

- The codebase has duplicated SQL, partial refactors, and several business rules hidden in route handlers.
- Green builds are not enough to protect behavior.

Evidence:

- backend and frontend package scripts only build
- there are no app tests in `backend/` or `frontend/`

Relevant code:

- `backend/package.json`
- `frontend/package.json`

Recommended fix:

- Add a small smoke suite around login, admin user CRUD, question-area update/comment/upload, and parcel status/comment flows.

#### 10. File upload validation is stricter than many browsers and GIS file types tolerate

Status, 2026-04-16: fixed in code. Uploads still require a safe extension and size limit, but blank MIME and `application/octet-stream` are accepted as browser fallback MIME values.

Why it matters:

- Browsers often send uncommon file types as `application/octet-stream` or leave MIME blank.
- Requiring both extension and exact MIME makes some legitimate uploads fail.

Evidence:

- uploads require both allowed extension and allowed MIME

Relevant code:

- `backend/src/routes/questionAreas.ts:16`
- `backend/src/routes/questionAreas.ts:54`

Recommended fix:

- Validate extension plus size/content rules, or allow a safe MIME fallback instead of requiring exact pair matching.

### Low / Structural Concerns

#### 11. Repo instructions and runtime docs have drifted from implementation

Status, 2026-04-16: partly fixed. README and AGENTS were updated for current demo users, seed manifest guard, reset/reseed workflow, smoke command, and exporter direction. Counts remain intentionally generic until regenerated seed assets are available.

Why it matters:

- New contributors and future agents will make bad assumptions from stale docs.

Evidence:

- `AGENTS.md` previously listed `reviewer@qaviewer.local`
- code only supports `admin` and `client`
- `README.md` says the app centers on `157` question areas, but the generated manifest shows `557`
- generated county files exist but are not seeded or served

Relevant code and docs:

- `AGENTS.md:71`
- `frontend/src/App.tsx:8`
- `backend/src/lib/auth.ts:8`
- `README.md:3`
- `data/generated/manifest.json`
- `data/generated/management_counties.geojson`
- `data/generated/tax_counties.geojson`

Recommended fix:

- Update repo docs after the seed model is corrected.
- Remove or implement dead assets and stale role references.

#### 12. There is dead or partially implemented backend surface area

Status, 2026-04-16: fixed for active app surfaces. Unused `county_boundaries`, unused `parcel_status_history`, and the unused `asGeoJsonString` helper were removed from active backend schema/source. `parcel_points` remains because it is exported, seeded, exposed by the layers API, and now rendered in the main UI as a toggleable context layer.

Why it matters:

- Dead schema and utilities increase confusion during maintenance.

Evidence:

- `parcel_points` is seeded, exposed by API, and rendered in the main UI as an optional context layer

Relevant code:

- `backend/src/routes/layers.ts:16`
- `backend/src/lib/schema.ts:119`
- `backend/src/lib/seed.ts:110`

Recommended fix:

- Keep `parcel_points` as a supported context layer unless product requirements later remove it.

## 3. Refactor Opportunities

### Small Safe Refactors

- Render `feedback` in `frontend/src/components/MapWorkspace.tsx` - done 2026-04-16
- Normalize login emails the same way admin create/update does, if login case-sensitivity becomes a real user issue
- Return document download paths without the `/api` stripping workaround in the frontend
- Count parcel comments in admin activity summaries - done 2026-04-16

### Medium Refactors Worth Doing Next

- Centralize parcel-to-question-area matching logic - done 2026-04-16
- Split `MapWorkspace` into smaller focused units
- Add seed versioning and an explicit reseed path - done in code 2026-04-16
- Keep `parcel_points` wired as a toggleable map layer

### Areas To Avoid Touching Until Later

- broader role-model changes until `reviewer` vs `client` intent is clarified
- geometry or business-rule rewrites outside the seed pipeline until the real question-area source layers are settled

## 4. Concrete Action Plan

Current status check, 2026-04-16:

- Most Phase 1 and Phase 2 stabilization work below is now implemented in the current tree.
- Admin create/update email normalization is already present, so it is no longer a primary task.
- A live backend smoke test command is present and passed against the running Docker/API/PostGIS stack on 2026-04-16.
- GIS generated assets still need regeneration and reseeding.

### Phase 1: Stabilize Current Behavior

- [x] Fix admin user activity counts and delete guards so `parcel_comments` are included.
- [x] Render `MapWorkspace` feedback through a shared toast or inline banner so save/comment/upload/download failures are visible.
- [x] Align the workflow status model across backend enums, frontend controls, labels, and parcel status displays. `review` remains user-selectable.
- [x] Remove or hide parcel document upload controls until true parcel-scoped documents exist. Keep question-area document uploads intact.
- [x] Add focused smoke tests for login, admin user CRUD, question-area update/comment/upload, parcel comment, and parcel status update. Test entrypoint exists and passed against the live stack.

### Phase 2: Reduce Data Drift Risk

- [x] Add seed manifest/version tracking so regenerated files in `data/generated/` cannot be silently ignored by an already-populated database.
- [x] Provide an explicit reseed/reset workflow for local development.
- [x] Centralize parcel-to-question-area matching logic in one backend SQL helper/view or a single shared query builder.
- [x] Add a regression check around expected question-area source groups and counts before changing the GIS export.

### Phase 3: Correct GIS Source Model

- [x] Rewrite `scripts/export_seed_data.py` so question areas come from `BTG_Spatial_Fix_Primary_Erase` and `BTG_Spatial_Fix_Comparison_Erase`.
- [x] Keep `BTG_Spatial_Fix_Primary_Layer` as parcel context/enrichment, not the source of question areas.
- [ ] Regenerate `data/generated/` from a compatible source dataset and reseed PostGIS. Blocked by the current mounted geodatabase missing `BTG_Spatial_Fix_Primary_Erase` and `BTG_Spatial_Fix_Comparison_Erase`.
- [~] Update README/agent docs/counts after the corrected generated data is verified. Runtime docs updated; exact counts still wait on regeneration.

### Phase 4: Cleanup And Maintainability

- [ ] Split `MapWorkspace` into smaller focused components/hooks once the behavior is stable.
- [x] Remove or fully wire orphaned backend/data surfaces. Unused backend schema/helper surfaces were removed; `parcel_points` is now wired into the main map.
- [x] Relax or harden upload validation deliberately, especially MIME fallback behavior for common browser/GIS upload cases.
- [~] Add linting and keep test/build commands documented. Smoke/build docs updated; linting not added.

## 5. Agent-Ready Tasks

These tasks are intentionally narrow so another coding agent can execute them one at a time. Execute them in order unless a later task is explicitly pulled forward.

1. [x] **Admin authored-activity guard**: add `parcel_comments` counts to admin list/detail queries, serialize that count to the frontend, include it in delete-disable logic, and return a controlled `409` when parcel-authored activity exists.
2. [x] **Reviewer feedback UI**: render the existing `feedback` state in `MapWorkspace` using a reusable toast/banner and ensure save, comment, upload, download, and load failures clear or expire consistently.
3. [x] **Status model alignment**: choose the canonical status set, then update backend validation, frontend `STATUS_OPTIONS`, status labels, parcel detail badges, and any seed defaults to match it.
4. [x] **Parcel document UI cleanup**: remove or hide parcel-level upload controls and copy that implies parcel documents exist. Leave question-area documents functional.
5. [x] **Smoke test foundation**: add backend/frontend test tooling and cover login, admin user CRUD/deletion conflicts, question-area update/comment/upload, parcel comment, and parcel status update. Live backend smoke entrypoint passed against the running stack on 2026-04-16.
6. [x] **Seed manifest/version guard**: store the generated manifest hash/version in PostGIS, compare it during startup, fail fast on mismatch, and document the explicit reseed/reset path.
7. [x] **Shared parcel-QA matching**: extract the duplicated lateral join used by dashboard, layers, parcels, and question-area routes into one shared backend helper or SQL view.
8. [x] **Question-area export correction**: rewrite `export_seed_data.py` so question areas are generated from `BTG_Spatial_Fix_Primary_Erase` and `BTG_Spatial_Fix_Comparison_Erase`, with primary parcels used only for context/enrichment.
9. [ ] **Regenerate and reseed**: regenerate `data/generated/`, verify manifest source groups/counts, reseed PostGIS, and update docs to match the corrected model.
10. [x] **Dead-surface cleanup**: unused active schema/helper surfaces were removed; `parcel_points` is rendered as a toggleable context layer, and stale county GeoJSON assets will be cleaned up by the next successful exporter run.

## 6. Top 5 Highest-Risk Issues

1. Generated seed assets still need regeneration from the corrected mismatch-layer exporter
2. PostGIS still needs explicit reset/reseed after generated seed assets are regenerated
3. Large `MapWorkspace` component remains a maintainability risk
4. `MapWorkspace` remains a large component despite behavior cleanup
5. Smoke coverage is live-stack only

## 7. Top 5 Best Cleanup Wins

1. Provide the geodatabase that contains the mismatch erase layers
2. Regenerate seed assets, then reset/reseed PostGIS
3. Split `MapWorkspace` after regenerated seed assets and reseed verification pass
4. Keep generated data/docs in sync after the corrected exporter can run
5. Consider replacing live smoke-only coverage with isolated route/service tests later

## 8. Recommended Safe Fix Sequence

1. Provide a `BTG_PTV_Implementation.gdb` that includes `BTG_Spatial_Fix_Primary_Erase` and `BTG_Spatial_Fix_Comparison_Erase`.
2. Run `scripts/export_seed_data.py` with Python/geopandas locally or in Docker.
3. Inspect `data/generated/manifest.json` for nonzero `primary` and `comparison` source groups and no `BTG_Spatial_Fix_Primary_Layer` question-area sources.
4. Reset/reseed PostGIS with `docker compose down -v && docker compose up --build`.
5. Run `cd backend && npm run test:smoke`, then rerun backend/frontend builds after reseeding.
6. Update exact generated counts in README/AGENTS after regeneration is verified.
7. Split `MapWorkspace` after reseed verification is green.
