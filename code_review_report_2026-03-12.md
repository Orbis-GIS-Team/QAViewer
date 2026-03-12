# QAViewer Code Review

Date: 2026-03-12

Scope: broad senior-level review of architecture, code quality, GIS/spatial handling, security, performance, maintainability, Docker/environment, and likely failure points.

Review basis: repository source review only. I did not run the stack, builds, or tests.

## 1. Executive Summary

This is a workable prototype, not a production-ready GIS review system.

The codebase is easy to navigate and the end-to-end flow is coherent: seed GIS data, expose it through a small API, and review it in a single-screen Leaflet UI. The biggest issues are authorization, data/seed integrity, and scalability. With the current seeded dataset and a few local users, it should function. With larger spatial layers, stricter permission requirements, or real operational expectations, it will start to fail in predictable ways.

## 2. Strengths

- The repo structure is straightforward and maps cleanly to the product: seed pipeline, backend, frontend, and Docker setup are easy to find.
- The backend uses parameterized SQL consistently, which avoids obvious SQL injection issues in the current query paths.
- PostGIS geometry columns and GIST indexes are present in the schema, which is the right baseline for spatial data.
- The seed pipeline centralizes question-area derivation in one script, which is better than scattering GIS business logic across the app.
- The frontend scopes most map requests by viewport bbox rather than loading every layer globally on startup.
- The API/bootstrap flow waits for Postgres before starting, which is a good improvement over plain `depends_on`.

## 3. Findings

### Critical

#### 1. Missing authorization boundaries after login

- Severity: `Critical`
- Affected area/files:
  - `backend/src/server.ts:35`
  - `backend/src/lib/auth.ts:28`
  - `backend/src/routes/questionAreas.ts:292`
- Why it matters:
  - Roles exist in the data model and UI, but they are never enforced.
  - Any authenticated user, including `client`, can update question areas, post comments, upload documents, and download documents.
  - That breaks workflow integrity and is the biggest security issue in the app.
- Recommended fix:
  - Add explicit authorization middleware such as `requireRole` and `requireQuestionAreaAccess`.
  - Restrict mutating and document routes by role.
  - Add integration tests for role boundaries.

### High

#### 2. Development secrets and demo credentials are part of runtime behavior

- Severity: `High`
- Affected area/files:
  - `backend/src/config.ts:14`
  - `.env.example:5`
  - `docker-compose.yml:23`
  - `backend/src/lib/seed.ts:10`
  - `backend/src/lib/seed.ts:78`
  - `frontend/src/components/LoginScreen.tsx:7`
- Why it matters:
  - `JWT_SECRET` defaults to `change-me`.
  - Demo passwords are committed and shown in the UI.
  - Demo-user passwords are reset on every startup.
  - If this setup is reused outside localhost, forging tokens and signing in as seeded users is trivial.
- Recommended fix:
  - Fail fast on default secrets.
  - Gate demo-user seeding behind an explicit dev flag.
  - Stop resetting passwords on boot.
  - Remove passwords from the UI in non-demo builds.

#### 3. Seed bootstrap can leave the database half-initialized

- Severity: `High`
- Affected area/files:
  - `backend/src/lib/seed.ts:36`
  - `backend/src/lib/seed.ts:44`
- Why it matters:
  - Seeding is considered "done" if `question_areas` is non-empty.
  - If that table exists but support layers, comments, or future seed changes are missing, startup skips the rest and the app runs against inconsistent data.
- Recommended fix:
  - Version the schema and seed state.
  - Seed each table idempotently.
  - Validate completeness instead of checking one table.

#### 4. Spatial export silently trusts CRS and invalid geometry

- Severity: `High`
- Affected area/files:
  - `scripts/export_seed_data.py:16`
  - `scripts/export_seed_data.py:18`
  - `scripts/export_seed_data.py:22`
- Why it matters:
  - When CRS is missing, the export stamps EPSG:4326 instead of failing.
  - It also drops empty geometries but does not validate or repair invalid ones.
  - That can seed spatially wrong or topologically broken data while the app still appears healthy.
- Recommended fix:
  - Fail on missing or unknown CRS.
  - Log source CRS explicitly.
  - Validate geometry before export and import.
  - Repair with `make_valid` where appropriate.

#### 5. Question-area identity and parcel attribution are unstable

- Severity: `High`
- Affected area/files:
  - `scripts/export_seed_data.py:183`
  - `scripts/export_seed_data.py:207`
  - `scripts/export_seed_data.py:257`
  - `scripts/export_seed_data.py:262`
- Why it matters:
  - Question-area codes are generated from row order.
  - Comparison gaps pick a "primary" parcel from the first `intersects` hit rather than the best overlap.
  - Regenerating seed data can renumber records, detach comments/documents conceptually, and mislabel the review target.
- Recommended fix:
  - Use stable source IDs or deterministic hashes for question-area IDs.
  - Rank linked parcels by overlap area or a defined business rule.

#### 6. Search/filter paths will degrade into table scans

- Severity: `High`
- Affected area/files:
  - `backend/src/routes/dashboard.ts:33`
  - `backend/src/routes/questionAreas.ts:44`
  - `backend/src/lib/schema.ts:139`
- Why it matters:
  - Both search endpoints use multi-column `ILIKE '%term%'` against unindexed text fields.
  - That is fine for 157 question areas, but it will not hold up on larger parcel/question-area datasets.
- Recommended fix:
  - Add `pg_trgm` or `tsvector` search support.
  - Add B-tree indexes for common filters.
  - Separate search endpoints from viewport/map endpoints.

#### 7. Layer delivery/rendering strategy does not scale past prototype size

- Severity: `High`
- Affected area/files:
  - `backend/src/routes/layers.ts:8`
  - `backend/src/routes/layers.ts:72`
  - `backend/src/routes/questionAreas.ts:79`
  - `frontend/src/components/MapWorkspace.tsx:266`
  - `frontend/src/components/MapWorkspace.tsx:621`
- Why it matters:
  - Every `moveend` and layer toggle refetches full GeoJSON collections, sometimes with thousands of features and full `raw_properties`.
  - The client then renders them as plain Leaflet GeoJSON layers.
  - The hard-coded limits only cap failure and can silently drop data.
- Recommended fix:
  - Add zoom-aware or generalized geometries.
  - Add server-side clipping or `ST_Subdivide`.
  - Cache by viewport and layer.
  - Consider vector tiles or lighter summary geometries.

#### 8. Document upload handling is too permissive

- Severity: `High`
- Affected area/files:
  - `backend/src/routes/questionAreas.ts:14`
  - `backend/src/routes/questionAreas.ts:391`
- Why it matters:
  - Uploads accept arbitrary file types, store directly on disk, do not scan content, and do not enforce quota or retention rules.
  - Multer failures will also fall into the generic 500 handler.
  - Combined with missing RBAC, this is a broad attack surface.
- Recommended fix:
  - Add MIME and extension allowlists.
  - Add explicit multer error handling.
  - Add quotas and retention rules.
  - If this moves beyond localhost, add malware/content scanning.

### Medium

#### 9. API validation and schema constraints are too loose

- Severity: `Medium`
- Affected area/files:
  - `backend/src/routes/questionAreas.ts:29`
  - `backend/src/routes/questionAreas.ts:79`
  - `backend/src/lib/schema.ts:18`
- Why it matters:
  - `status`, `severity`, `role`, and `assignedReviewer` are unconstrained strings.
  - `assigned_reviewer` is free text instead of a user foreign key.
  - `limit` can become `NaN` or negative and yield a 500.
  - This makes bad data and avoidable runtime errors easy.
- Recommended fix:
  - Validate enums server-side.
  - Parse and clamp numeric inputs safely.
  - Store reviewer assignment as a foreign key.
  - Add `CHECK` constraints or PostgreSQL enums.

#### 10. Frontend effects create redundant fetches and forced map motion

- Severity: `Medium`
- Affected area/files:
  - `frontend/src/components/MapWorkspace.tsx:221`
  - `frontend/src/components/MapWorkspace.tsx:347`
  - `frontend/src/components/MapWorkspace.tsx:911`
- Why it matters:
  - The question-area list query depends on `selectedCode`, so selecting a feature causes an unnecessary refetch.
  - Every detail reload also triggers `fitBounds` again, which recenters the map after save/comment/upload and causes more viewport fetches.
- Recommended fix:
  - Remove `selectedCode` from the list-query dependencies.
  - Only recenter when the selected code or geometry actually changes.

#### 11. Core UI and backend routes are overloaded modules

- Severity: `Medium`
- Affected area/files:
  - `frontend/src/components/MapWorkspace.tsx:137`
  - `backend/src/routes/questionAreas.ts:40`
  - `backend/src/routes/dashboard.ts:7`
  - `backend/src/routes/layers.ts:46`
- Why it matters:
  - `MapWorkspace` owns nearly all client state, network calls, map rendering, and review workflows.
  - Backend route files mix validation, SQL, storage logic, and response shaping.
  - That makes the app harder to test, reason about, and change safely.
- Recommended fix:
  - Split frontend data hooks and panels from the map layer.
  - Extract backend service, repository, upload, and auth helpers.

#### 12. Automated tests are effectively absent

- Severity: `Medium`
- Affected area/files:
  - `backend/package.json:6`
  - `frontend/package.json:6`
- Why it matters:
  - There are no test scripts and no visible test suites.
  - The highest-risk logic here is auth, permissions, GIS seed derivation, viewport querying, uploads, and question-area mutation.
- Recommended fix:
  - Add API integration tests first.
  - Add seed-pipeline unit tests.
  - Add a small frontend smoke suite.

#### 13. Operational readiness is minimal

- Severity: `Medium`
- Affected area/files:
  - `backend/src/server.ts:30`
  - `backend/src/server.ts:39`
- Why it matters:
  - Health always returns `ok` without checking Postgres or seed completeness.
  - Errors only go to `console.error`.
  - There is no request logging, audit trail, or mutation history for review actions and documents.
- Recommended fix:
  - Add readiness checks against Postgres.
  - Add structured logs with request IDs.
  - Add audit logging for patches, comments, uploads, and downloads.

#### 14. File metadata and file storage are not kept consistent transactionally

- Severity: `Medium`
- Affected area/files:
  - `backend/src/routes/questionAreas.ts:397`
  - `backend/src/routes/questionAreas.ts:416`
  - `backend/src/routes/questionAreas.ts:456`
- Why it matters:
  - Files are written before metadata is committed, and only one failure path cleans up.
  - DB failures can orphan files.
  - Missing files can leave valid DB rows that fail on download.
- Recommended fix:
  - Use a transaction-aware upload flow.
  - Clean up on all insert failures.
  - Validate file presence on download.

#### 15. Docker configuration is dev-only and risky as a production baseline

- Severity: `Medium`
- Affected area/files:
  - `docker-compose.yml:27`
  - `backend/Dockerfile:1`
  - `frontend/Dockerfile:1`
- Why it matters:
  - Containers run dev servers, install with `npm install`, run as root, mount source code, and expose default credentials and ports.
  - Good for local iteration, bad as a deployment baseline.
- Recommended fix:
  - Keep this explicitly dev-only.
  - Add production images with multi-stage builds and `npm ci`.
  - Remove default secrets and host-exposed DB outside dev.

#### 16. Session handling is brittle and security-sensitive

- Severity: `Medium`
- Affected area/files:
  - `frontend/src/App.tsx:17`
  - `frontend/src/lib/api.ts:25`
- Why it matters:
  - JWTs live in `localStorage`, which broadens XSS impact.
  - 401s do not trigger a clean logout or refresh path.
  - The UI just degrades into generic fetch failures.
- Recommended fix:
  - Centralize 401 handling.
  - Consider httpOnly cookies or a tighter token lifecycle if this ever leaves demo mode.

### Low

#### 17. Search UX does not align cleanly with the data model

- Severity: `Low`
- Affected area/files:
  - `frontend/src/components/MapWorkspace.tsx:455`
  - `backend/src/routes/dashboard.ts:73`
- Why it matters:
  - Selecting a parcel search result just drops the parcel label into the question-area filter.
  - That is indirect and can miss related question areas.
- Recommended fix:
  - Return linked question-area codes for parcel search results.
  - Or add a dedicated parcel-to-question-area lookup endpoint.

#### 18. Download and basemap integration use brittle UI glue

- Severity: `Low`
- Affected area/files:
  - `frontend/src/components/MapWorkspace.tsx:443`
  - `frontend/src/components/MapWorkspace.tsx:622`
- Why it matters:
  - Document downloads depend on string-replacing `/api`.
  - The basemap is hardcoded to public OSM tiles.
  - Both work now, but they are fragile integration points.
- Recommended fix:
  - Return API-relative download paths directly from the backend.
  - Make the basemap provider configurable.

## 4. GIS/Spatial Review

- The use of PostGIS geometry types plus GIST indexes is the right foundation:
  - `backend/src/lib/schema.ts:41`
  - `backend/src/lib/schema.ts:140`
- Using `representative_point()` in the seed export is a good choice for focus and selection because it stays inside polygons:
  - `scripts/export_seed_data.py:201`
  - `scripts/export_seed_data.py:259`
- The naming is misleading because it is stored as `centroid` even though it is a representative point.
- CRS handling is too trusting. Silently assigning EPSG:4326 on missing CRS is unsafe in GIS work and should fail loudly.
- Geometry validity is not checked or repaired anywhere in the export or import path. Invalid polygons can degrade both rendering and spatial query behavior.
- The question-area linkage logic is heuristic. `intersects` plus "first related parcel wins" is not robust enough for authoritative review metadata.
- Viewport queries use bbox overlap only:
  - `backend/src/routes/questionAreas.ts:70`
  - `backend/src/routes/layers.ts:62`
- That is a good index prefilter, but if exact in-viewport semantics matter, add `ST_Intersects` after the bbox check.
- Only county boundaries are simplified server-side:
  - `backend/src/routes/layers.ts:32`
- Parcels and management tracts are sent largely raw, which is where the real map cost will be.
- For larger datasets, the next spatial step should be `ST_Subdivide`, zoom-dependent generalization, or MVT/vector tiles rather than plain GeoJSON.

## 5. Security Review

- The biggest issue is missing authorization. Authentication exists; authorization effectively does not.
- Default secrets, demo accounts, and password reseeding are acceptable only for isolated local demos.
- Upload handling is under-protected:
  - no file-type allowlist
  - no malware scanning
  - no quota or retention strategy
  - no explicit multer error handling
- Tokens in `localStorage` are a security compromise and should be treated as such.
- There is no visible login throttling, lockout, or rate limiting around `backend/src/routes/auth.ts:14`.
- Postgres is exposed on the host with default credentials in `docker-compose.yml:9`. Fine for local-only use; unsafe if the pattern leaks into shared environments.
- There is no audit trail for who changed status, uploaded a document, or downloaded one.

## 6. Performance Review

- The main bottleneck will be map data delivery, not SQL correctness.
- Full GeoJSON refetching on every viewport change and layer toggle will become expensive quickly.
- Rendering large polygon layers through Leaflet GeoJSON and SVG will not scale well. Consider `preferCanvas`, simpler layers, or MVT/vector tiles.
- Search queries will degrade due to multi-column `%term%` scans with no text indexes.
- Hard-coded result caps such as `600`, `3000`, and `6000` can silently truncate visible data instead of solving scale.
- Layer responses currently include `raw_properties`, which bloats payloads even if the UI does not need most of them.
- Detail responses return all comments and documents with no pagination. That is okay now, but it will grow poorly on long-lived review records.
- Seed loading is row-by-row in a single startup transaction. That is acceptable for the current dataset, but not for materially larger source layers.

## 7. Maintainability Review

- The code is readable, but too much logic is concentrated in too few files.
- `frontend/src/components/MapWorkspace.tsx:137` is doing state management, orchestration, data fetching, mutation flows, and rendering at once.
- Backend route modules are effectively acting as controllers, services, repositories, and serializers all at once.
- There is no migration or versioning strategy; schema creation is `CREATE TABLE IF NOT EXISTS` only:
  - `backend/src/lib/schema.ts:3`
- That is fragile as the model evolves.
- Naming is mixed across layers by necessity, but the raw GIS source schema still leaks into app payloads through `raw_properties`. That weakens API cleanliness.
- `assigned_reviewer` being free text instead of a user relation is a maintainability and reporting problem, not just a validation problem.
- Absence of tests is the largest long-term maintainability risk after auth.

## 8. Quick Wins

1. Add role checks to `PATCH`, comment, upload, and download routes.
2. Refuse startup when `JWT_SECRET` is default.
3. Validate `status` and `limit` properly, and clamp invalid numeric inputs before SQL.
4. Add indexes for `status`, `comments.question_area_id`, `documents.question_area_id`, and trigram/text search.
5. Remove `selectedCode` from the question-area list effect dependencies.
6. Stop auto-`fitBounds` on every detail reload; only do it when selection actually changes.
7. Add MIME and extension allowlisting and explicit multer error handling.
8. Make `/api/health` a real readiness check against Postgres.

## 9. Priority Action Plan

1. Lock down authorization and secrets.
2. Fix seed/data integrity: schema versioning, idempotent seeding, stable question-area IDs.
3. Harden GIS ingestion: CRS validation, geometry validation/repair, deterministic parcel attribution.
4. Make search and spatial delivery scalable: indexes, lighter payloads, better layer strategy.
5. Refactor module boundaries in the frontend and backend.
6. Add tests around auth, seed logic, question-area mutations, and upload flows.
7. Separate dev-only Docker from anything that could become a deployment target.

## 10. Optional Refactor Suggestions

1. Introduce a migration tool and a thin service/repository layer in the backend.
2. Split the frontend into a workspace store plus smaller panels and components such as `MapPanel`, `FiltersPanel`, `DetailPanel`, `CommentsPanel`, and `DocumentsPanel`.
3. Replace large GeoJSON layer delivery with vector tiles or at least zoom-aware generalized endpoints.
4. Move document storage to object storage with durable keys and signed downloads if the app will have real users.
