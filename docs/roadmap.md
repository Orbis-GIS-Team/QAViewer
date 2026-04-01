# QAViewer Roadmap

This document outlines the product and technical roadmap for QAViewer.

The current app is already a usable GIS review workspace. The roadmap below is focused on turning it into a shared team platform with:

- one shared source of truth for review state
- better reviewer tools inside the map
- linked deed context sourced from a separate application
- a safer path from local development into hosted testing

## Product Direction

QAViewer should evolve from a Docker-first local review app into a shared GIS review system that supports:

- team review against one shared dataset
- map-driven parcel and question-area investigation
- attached notes, documents, and status history
- linked deed intelligence for faster title and parcel research

The app should remain workflow-oriented. It does not need to become a general GIS platform.

## Current Baseline

As of the current repo state, QAViewer already has:

- authenticated review workspace
- question area and parcel map review
- search and filtering
- comments
- document upload and download
- admin user management
- backend-owned PostGIS queries and seed loading

Current architecture:

- frontend: React + Vite + Leaflet
- backend: Express + TypeScript
- database: PostgreSQL + PostGIS
- local runtime: Docker Compose

## Planning Principles

These principles should guide future changes:

1. Keep the browser decoupled from the database. The frontend should continue to talk only to the backend API.
2. Use Supabase as hosted Postgres/PostGIS first, not as the primary app framework.
3. Treat map tools as reviewer productivity features, not generic GIS clutter.
4. Port deed business logic from the other application in focused modules. Do not merge that application wholesale into QAViewer.
5. Move toward explicit migrations and deploy steps as the schema grows.
6. Avoid introducing new hosted services unless they solve a concrete problem.

## Workstreams

The roadmap is organized around four workstreams:

### 1. Shared Platform

Goal:

- move QAViewer from local-only database state to a shared hosted environment

Includes:

- Supabase-hosted Postgres/PostGIS
- environment separation
- safer schema/bootstrap flow
- shared document strategy

### 2. Map Productivity

Goal:

- make the map more useful for review work

Includes:

- measurement tools
- viewport and coordinate utilities
- layer controls
- map interaction improvements

### 3. Deed Intelligence

Goal:

- bring linked deed context into the QAViewer review workflow

Includes:

- deed data model
- source application integration
- matching logic
- deed display and linking workflows

### 4. Hardening and Delivery

Goal:

- make the app safer to operate for a small team

Includes:

- deployment process
- auditability
- testing
- performance and operational hygiene

## Phase Roadmap

## Phase 0: Baseline and Alignment

Target:

- lock scope and architecture before larger feature work starts

Key work:

- document the target hosted architecture
- confirm that Supabase is the initial shared data platform
- inventory the other deed-related application
- identify what deed logic should be ported into QAViewer
- define what is in scope for the first shared-team release

Deliverables:

- this roadmap
- deed integration inventory
- environment model: local, shared-dev, later production

Exit criteria:

- team agrees on the sequence: shared platform first, map tools second, deed integration third

## Phase 1: Shared Data Foundation

Target:

- move the app to one shared hosted database for testing

Key work:

- create a Supabase project on the free tier
- enable required database extensions such as `postgis` and `pg_trgm`
- update backend configuration to support hosted Postgres cleanly
- add SSL-aware database connection settings
- set explicit pool sizing for hosted use
- separate local-only startup behavior from shared-environment behavior

Important implementation note:

- the app currently creates schema and seeds data on startup
- that is acceptable for local development but should be gated or replaced by explicit bootstrap commands in shared environments

Deliverables:

- Supabase-backed shared environment
- updated backend config
- safe bootstrap path

Exit criteria:

- multiple team members can log into the same QAViewer instance and see the same review state

## Phase 2: Shared Storage and Deployment Hygiene

Target:

- make the shared environment operationally coherent

Key work:

- decide whether the team will use one hosted backend or multiple local backends against one shared database
- move document storage off local disk if the backend will not be single-host
- add environment documentation and deployment steps
- adopt explicit database migrations instead of relying only on schema mutation at app startup

Important implementation note:

- today, uploaded files are stored under `backend/uploads`
- that is fine for one machine but not a true shared storage model

Deliverables:

- documented deployment flow
- shared file strategy
- migration workflow

Exit criteria:

- comments, status updates, and documents are all consistently shared for the team

## Phase 3: Map Productivity Tools

Target:

- improve day-to-day reviewer efficiency inside the map

Priority features:

- distance measuring tool
- area measuring tool
- coordinate readout and copy
- reset extent control
- zoom to selected feature
- shareable extent or selection links
- basemap switcher
- layer opacity controls

Possible later features:

- reviewer markup or annotation tools
- saved map views
- print or export map snapshots

Product guidance:

- only add tools that support the review workflow
- avoid adding generic GIS widgets that do not create clear user value

Deliverables:

- first-pass measurement and navigation toolkit
- improved map control set

Exit criteria:

- a reviewer can inspect geometry, measure, and navigate without leaving the QA workflow

## Phase 4: Deed Integration Foundation

Target:

- establish the backend data model and integration contract for linked deeds

Key work:

- define deed-related tables and relationships
- create a service layer for syncing or querying the source deed application
- port matching and lookup rules into QAViewer backend modules
- store source-system identifiers, sync timestamps, and match confidence
- define read-only deed payloads for the frontend

Important product guidance:

- start read-only
- show deed context before enabling deed editing or correction workflows

Deliverables:

- deed schema
- integration service
- read-only deed API endpoints

Exit criteria:

- parcels or question areas can display linked deed summaries from the external source logic

## Phase 5: Deed Review Workflows

Target:

- make deed data useful inside the actual review flow

Key work:

- surface linked deeds in parcel and question-area detail panels
- add deed search by parcel, owner, tract, deed reference, or source ID
- flag missing, ambiguous, or stale links
- allow admin review and manual override of links
- add deep links back to the source system where appropriate

Possible later features:

- match suggestions
- review queues for unresolved deed links
- event-based sync or scheduled sync jobs

Deliverables:

- deed-aware detail views
- admin relinking tools
- deed sync status indicators

Exit criteria:

- reviewers can use deed context directly inside QAViewer without switching between tools for normal cases

## Phase 6: Hardening and Team Readiness

Target:

- make the app stable enough for regular team use

Key work:

- add audit trails for important edits
- improve role and permission controls
- add integration tests for shared database behavior
- add tests around deed matching and sync logic
- review query performance as shared usage grows
- improve observability and failure handling

Deliverables:

- auditability
- stronger test coverage
- basic operational confidence

Exit criteria:

- the app is safe to use as an internal team system rather than only as a developer tool

## Suggested Delivery Order

Recommended order:

1. Shared data foundation
2. Shared storage and deployment hygiene
3. Map productivity tools
4. Deed integration foundation
5. Deed review workflows
6. Hardening

This order matters because deed integration will add schema, external dependencies, and more UI surface area. The shared platform should be stable before that work lands.

## Supabase Fit

Supabase is the right first hosted step for QAViewer because it solves the team's immediate problem:

- one shared dataset
- one shared review state
- hosted Postgres/PostGIS without a custom database server

Current testing assessment:

- the current GIS seed dataset fits comfortably within the Supabase free-tier database limit for initial testing
- the first likely scaling pressure is shared document storage and general environment maturity, not raw GIS database size

Supabase should be used first as:

- managed Postgres
- PostGIS host
- optional later storage target

It should not be used yet as:

- the primary frontend data access layer
- the replacement for the Express business logic layer

## Deed Integration Guardrails

The deed-related work is the highest-risk part of the roadmap. To keep it contained:

1. Extract and port business rules, not the full other application.
2. Keep external integration behind backend services.
3. Start with read-only deed visibility.
4. Add admin override tools before automating aggressive sync behavior.
5. Track source system provenance and sync timestamps on every imported or linked record.

## Deferred Items

These are explicitly not first-wave priorities unless a concrete need appears:

- GeoServer
- frontend-direct database access
- full GIS editing workflows
- broad plugin-style map tooling with unclear reviewer value
- replacing the current backend auth model with Supabase Auth

## Near-Term Milestones

These are the most practical next steps for the repo:

1. Make the backend Supabase-ready.
2. Add a safe non-local bootstrap and seed strategy.
3. Decide the shared document storage model.
4. Build the first map measurement tools.
5. Define the deed integration schema and API contract before porting logic.

## Open Questions

These should be answered before the later phases move forward:

- Will the team use one centrally hosted backend, or local backends against a shared database?
- Should uploaded documents live in Supabase Storage, another object store, or a single hosted app volume?
- What exact deed entities need to be surfaced in QAViewer first?
- Is the deed source application available through API calls, direct database access, or export files?
- Which users should be allowed to override deed links?
