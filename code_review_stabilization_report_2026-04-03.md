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

## 1. Executive Summary

### Overall Health Of The Codebase

QAViewer is organized as a simple pipeline:

- `scripts/export_seed_data.py` generates GeoJSON seed assets
- the backend bootstraps schema and seed data, then serves a small set of route groups
- the frontend has a thin app shell plus one very large reviewer UI in `frontend/src/components/MapWorkspace.tsx`

The codebase is workable, and both backend and frontend builds pass, but there is visible AI-churn:

- the domain model has drifted from the repo instructions
- the same SQL matching logic is copied in multiple places
- some UI paths look complete but are effectively dead or misleading
- there is no automated test safety net

### Main Risks

The biggest risks are correctness and maintainability, not style:

- question areas are currently generated from the wrong source layer
- seed behavior silently accepts stale GIS data after first import
- admin user deletion logic misses parcel-authored activity
- workflow status handling is inconsistent between backend and frontend
- the main review UI records error/success feedback but never renders it

### What Is Working Well

- the PostGIS bbox-serving pattern is pragmatic and easy to reason about
- the backend route/lib split is small enough to stabilize without a rewrite
- auth and admin behavior are relatively compact
- frontend and backend builds both succeed

## 2. Prioritized Findings

### Critical

#### 1. Question areas are generated from the wrong source layers

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

Why it matters:

- New contributors and future agents will make bad assumptions from stale docs.

Evidence:

- `AGENTS.md` still lists `reviewer@qaviewer.local`
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

Why it matters:

- Dead schema and utilities increase confusion during maintenance.

Evidence:

- `parcel_status_history` table exists but is not used
- `county_boundaries` table exists but is not seeded or queried
- `parcel_points` is seeded and exposed by API but not used in the main UI
- `asGeoJsonString` is unused

Relevant code:

- `backend/src/lib/schema.ts:145`
- `backend/src/lib/schema.ts:179`
- `backend/src/routes/layers.ts:16`
- `backend/src/lib/utils.ts:33`

Recommended fix:

- Remove dead code if it is not planned soon, or complete the missing integrations.

## 3. Refactor Opportunities

### Small Safe Refactors

- Render `feedback` in `frontend/src/components/MapWorkspace.tsx`
- Normalize login emails the same way admin create/update does
- Return document download paths without the `/api` stripping workaround in the frontend
- Count parcel comments in admin activity summaries

### Medium Refactors Worth Doing Next

- Centralize parcel-to-question-area matching logic
- Split `MapWorkspace` into smaller focused units
- Add seed versioning and an explicit reseed path
- Remove or fully wire orphaned features such as `parcel_points`, `county_boundaries`, `management_counties`, and `tax_counties`

### Areas To Avoid Touching Until Later

- broader role-model changes until `reviewer` vs `client` intent is clarified
- geometry or business-rule rewrites outside the seed pipeline until the real question-area source layers are settled

## 4. Concrete Action Plan

### Fix Now

- Add smoke tests for current auth, admin, question-area, and parcel flows
- Fix admin deletion and activity counting
- Surface frontend feedback and align the `review` status model
- Remove or hide misleading parcel document behavior

### Fix Soon

- Centralize parcel-to-question-area matching
- Introduce seed versioning or manifest-based reseed behavior
- Rebuild question-area generation from the intended mismatch layers

### Nice To Have

- Clean up config and docs drift such as reviewer-account references and stale counts
- Split `MapWorkspace` and share API/status constants
- Relax or harden upload validation more deliberately
- Add linting

## 5. Agent-Ready Tasks

These tasks are intentionally narrow so another coding agent can execute them one at a time:

1. Add `parcel_comments` activity counts to admin list/detail queries and deletion guards.
2. Render a reusable toast or feedback banner in `MapWorkspace` and wire the existing `feedback` state to it.
3. Align frontend status controls and labels with backend valid statuses, including `review`.
4. Extract the parcel-to-question-area lateral join into one reusable backend helper or SQL view.
5. Remove parcel document upload controls until parcel-scoped documents actually exist.
6. Add a seed manifest/version check so regenerated GIS data cannot be silently ignored.
7. Rewrite `export_seed_data.py` question-area generation to use the mismatch layers named in the repo instructions.
8. Add smoke tests for login, admin user CRUD, question-area update/comment/upload, and parcel status/comment flows.

## 6. Top 5 Highest-Risk Issues

1. Wrong source layers for question-area generation
2. Non-versioned seeding that silently accepts stale data
3. Admin deletion bug around parcel-authored activity
4. Inconsistent `review` / `active` workflow model
5. Invisible error and success feedback in the main review UI

## 7. Top 5 Best Cleanup Wins

1. Fix admin activity and delete guards
2. Render `MapWorkspace` feedback
3. Align status enums and labels across backend and frontend
4. Centralize parcel/question-area matching
5. Add a minimal smoke suite before deeper refactors

## 8. Recommended Safe Fix Sequence

1. Add smoke coverage for the current critical flows.
2. Fix `MapWorkspace` feedback and admin deletion/activity counting.
3. Align the workflow status model.
4. Remove dead parcel document behavior and other misleading UI affordances.
5. Centralize matching logic and add seed versioning.
6. Rework the seed pipeline to the correct mismatch-layer model, then reseed and update docs.
