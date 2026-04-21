# GIS Architecture Implementation Plan

> Archived note: this document describes an in-progress pre-cutover architecture discussion from before the NNC frontend/backend cutover was completed. It is retained for historical context only. Use `docs/dataset-contract.md`, `docs/nnc-cutover-plan.md`, `README.md`, and `AGENTS.md` as the current source of truth.

## Purpose

QAViewer should move away from being driven by generated seed GeoJSON files and toward a required PostGIS application schema.

The application should expect a well-defined database structure and serve GIS/review functionality from that structure. Data loading, cleanup, and client-specific GIS preparation can happen outside the app. The app should validate that the database it connects to satisfies the required schema, then operate against that schema consistently.

This plan starts the transition. The final layer list and layer-specific workflows will be added later.

## Target Direction

The new model should treat PostGIS as the runtime source of truth for the application.

The app should no longer depend on `scripts/export_seed_data.py` as the main bridge between GIS data and runtime behavior. The seed script can remain as a development helper, but it should not define the production data architecture.

The target architecture is:

1. A required PostGIS schema exists before the application starts.
2. The backend checks that required tables, columns, geometry types, SRIDs, and indexes are present.
3. The frontend receives GIS data through API endpoints only.
4. Review/workflow tables are separate from raw/source GIS layer tables.
5. Source GIS layer records preserve enough attributes and identifiers to support future workflows.
6. Different clients can be supported by pointing separate app instances at separate PostGIS databases.

## Major Decisions

### 1. App Schema Over Seed Files

The application should have a required schema contract in PostGIS.

Current behavior:

- Generated files in `data/generated/` define what gets loaded.
- Backend imports those files on first start.
- The seed manifest hash controls whether the app accepts the current data.

Target behavior:

- PostGIS tables define what the app needs.
- The app starts only if the connected database satisfies the required schema.
- GIS data is loaded by a separate process owned by the data/GIS workflow.
- The app does not automatically infer production data shape from files.

### 2. Separate Source GIS Data From Review State

Source GIS layers and review workflow records should not be the same thing.

Source GIS tables answer:

- What came from the GIS source?
- Which layer did it come from?
- What was the source feature ID?
- What geometry and attributes were imported?

Review tables answer:

- What needs review?
- What is its current status?
- Who is assigned?
- What comments and documents are attached?
- Which source features are related to this review item?

This separation matters because the app will soon support more layers and more workflow types.

### 3. Explicit Relationships

Question areas and GIS features should be connected through relationship tables instead of implicit query-time matching.

Current behavior:

- Question areas and parcels are linked by lateral SQL joins using parcel number/code, county, and state.

Target behavior:

- Relationships are stored directly.
- Each relationship has a type, such as `source`, `intersects`, `attribute_match`, `nearest`, `manual`, or `derived_from`.
- Each relationship can include confidence, notes, and creation metadata.

### 4. Client Isolation

The expected near-term model is separate app instances pointing at separate PostGIS databases.

That means true multi-tenant behavior does not need to be built into the application immediately.

Near-term client model:

- One Docker/app deployment per client or project.
- Each deployment uses its own `DATABASE_URL`.
- Each database follows the same required schema.

Future client model:

- A shared application could route users to different databases or use tenant IDs inside one database.
- That is a larger security and operational decision and should not be added until the client/data model is clearer.

## Proposed Schema Areas

The exact table and column names should be finalized after the new layer list is known. These are the proposed schema areas.

### Core Metadata

Purpose: Track datasets, clients, schema version, and import history.

Likely tables:

- `app_schema_metadata`
- `clients` or `projects`
- `datasets`
- `import_runs`
- `source_layers`

Important fields:

- schema version
- client/project identifier
- source dataset name
- source dataset version
- import timestamp
- imported by
- validation status
- validation report

### Source GIS Features

Purpose: Store GIS features as source data, preserving lineage and raw attributes.

Likely tables:

- `source_features`
- or one table per required app layer, depending on performance and clarity

Important fields:

- `id`
- `dataset_id`
- `source_layer_id`
- `source_feature_id`
- `source_feature_key`
- `raw_properties`
- normalized display/search fields
- `geom`
- geometry hash
- created/imported timestamp

Open decision:

- Use one generic `source_features` table for all imported source features.
- Or use strongly typed tables for each required layer.

Initial recommendation:

- Use strongly typed app tables for layers that drive application behavior.
- Preserve `raw_properties` on each table for auditability and flexibility.

### Review Objects

Purpose: Store workflow items that users review and manage.

Likely tables:

- `question_areas`
- future review-object tables as additional workflows are added

Important fields:

- `id`
- `code`
- `dataset_id`
- `review_type`
- `source_side`
- `reason_code`
- `reason_text`
- `status`
- `severity`
- `assigned_reviewer`
- `summary`
- `description`
- `geom`
- `centroid`
- timestamps

### Relationships

Purpose: Connect review objects to source GIS features.

Likely table:

- `review_feature_relationships`

Important fields:

- `id`
- `review_object_type`
- `review_object_id`
- `related_table`
- `related_feature_id`
- `relationship_type`
- `match_confidence`
- `notes`
- `created_by_process`
- timestamps

### Workflow And Collaboration

Purpose: Keep user activity separate from source GIS data.

Likely tables:

- `comments`
- `documents`
- `review_status_history`
- `assignments`
- `audit_events`

Important fields:

- author/user ID
- related review object
- event type
- old value/new value for status changes
- timestamps

## Backend Changes

### Phase 1: Stop Automatic Production Seeding

Goal: Make backend startup validate schema rather than import generated data.

Tasks:

1. Add a required app schema version.
2. Add schema validation on backend startup.
3. Change seed behavior so automatic seed import is development-only.
4. Add a clear startup error when required tables or columns are missing.
5. Keep demo users optional behind `DEMO_MODE`.

Expected result:

- The app refuses to start against an invalid PostGIS database.
- The error tells the developer which schema requirement failed.

### Phase 2: Define Required GIS Tables

Goal: Replace implicit seed-file expectations with explicit PostGIS tables.

Tasks:

1. Define required spatial tables.
2. Define required geometry types and SRIDs.
3. Define required indexes.
4. Define required normalized fields for search/display.
5. Preserve raw GIS properties in JSONB where helpful.
6. Add database documentation in `docs/`.

Expected result:

- GIS data can be loaded by external tools as long as it satisfies the contract.
- The backend has stable queries.

### Phase 3: Refactor API Around Schema Contract

Goal: Make API endpoints depend on the required schema, not on seed assumptions.

Tasks:

1. Update `/api/layers/:layerKey` to use the new layer registry/schema.
2. Update `/api/question-areas` to read true review objects.
3. Replace query-time parcel/question-area matching with stored relationships.
4. Add endpoints for relationship-aware detail views.
5. Add validation tests for schema assumptions.

Expected result:

- Layer behavior is explicit.
- Review details explain why source features are related.

### Phase 4: Update Frontend Map Semantics

Goal: Make the map communicate the actual GIS issue clearly.

Tasks:

1. Render question-area polygons visibly.
2. Keep markers for navigation, but do not let markers replace the mismatch geometry.
3. Add clearer layer groups for source layers, review layers, and context layers.
4. Show relationship context in the details panel.
5. Add visual distinction for primary, comparison, management, parcel, and point layers.

Expected result:

- Reviewers can see the spatial evidence, not just a marker and a parcel.

### Phase 5: Add Client/Project Deployment Pattern

Goal: Support separate client datasets safely without prematurely building full multi-tenancy.

Tasks:

1. Document one-app-instance-per-client deployment.
2. Add `.env` examples for separate `DATABASE_URL` values.
3. Add database naming guidance.
4. Add backup/restore notes.
5. Add a health endpoint response that reports schema version and dataset/client metadata.

Expected result:

- Multiple clients can be supported operationally by separate app/database instances.
- Full in-app tenant switching can wait.

## Database Validation Requirements

The backend should validate at startup:

- PostGIS extension is installed.
- Required tables exist.
- Required columns exist.
- Geometry columns have the expected geometry type.
- Geometry columns use SRID 4326 unless a different standard is deliberately chosen.
- Required GiST indexes exist on geometry columns.
- Required unique constraints exist.
- Required foreign keys exist.
- `app_schema_metadata` contains the expected schema version.
- Required layer registry rows exist.

The backend should fail fast with a readable error when validation fails.

## Data Loading Responsibility

The application should not silently transform arbitrary GIS files into production app data.

Data loading should be handled by a controlled GIS/import process. That process can be:

- a SQL script
- a Python loader
- GDAL/ogr2ogr commands
- a GIS desktop export workflow
- a future admin import tool

But the runtime app should only care that the final PostGIS schema is valid.

## Development Data Strategy

The current seed script can remain useful for local development, but it should be reframed.

Recommended approach:

- Keep `scripts/export_seed_data.py` temporarily as a dev helper.
- Add a new schema-first loader or migration path.
- Move generated seed behavior behind an explicit development command.
- Do not run automatic GIS seed import in production mode.

## Near-Term Implementation Order

1. Write the required PostGIS schema contract.
2. Add backend startup validation for that contract.
3. Disable automatic GIS seeding unless explicitly enabled for development.
4. Introduce relationship tables.
5. Refactor API joins to use stored relationships.
6. Update the map so mismatch geometries are visible.
7. Add layer registry support for new upcoming layers.
8. Document client-specific deployment using different `DATABASE_URL` values.

## Open Questions For The Next Planning Session

These should be answered after the new layer list is available.

1. What are the exact required source layers?
2. Which layers are review-driving layers versus context-only layers?
3. Which layers need user-editable workflow state?
4. Which layers need comments and documents?
5. Which feature IDs are stable enough to use as source keys?
6. Which geometry types are expected for each layer?
7. Should the app standardize on EPSG:4326 or store native projection plus web projection?
8. Are question areas provided directly, derived by overlay, or both?
9. Will one client ever need to see multiple projects in the same app instance?
10. Are clients legally/security isolated enough that separate databases are required?

## Immediate Recommendation

Do not build full multi-tenant database routing yet.

First, define and enforce the required PostGIS schema. Then support multiple clients operationally by running separate app instances with separate `DATABASE_URL` values.

That gives client isolation without adding tenant-routing complexity before the real GIS layer model is finalized.
