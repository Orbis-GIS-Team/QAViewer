# GitHub Issue Roadmap Drafts

Created: 2026-05-07

## Status Snapshot

As of 2026-05-08:

- the Viewer/Reviewer permission foundation has been implemented in the repo
- GitHub issue `#4` was merged and closed
- the next active roadmap items start after that foundation rather than before it

These issue drafts convert the current QAViewer planning work into GitHub-trackable implementation work.

The GitHub connector can currently read `Orbis-GIS-Team/QAViewer`, but issue creation failed with `403 Resource not accessible by integration`. Once issue-write access is available, create these as GitHub issues and use the parent roadmap issue as the organizing tracker.

## Issue 1: Roadmap: make QAViewer client-ready with Viewer/Reviewer modules, reports, filters, data model cleanup, and parcel layers

### Body

## Purpose

Track the integrated product roadmap for making QAViewer function as a client-ready Viewer and internal/client Reviewer application.

This consolidates:

- `docs/data-model-audit-handoff.md`
- `docs/viewer-reviewer-module-strategy-plan.md`
- account-management feedback on reports, identify, filtering, parcels, symbology, editable priority, and workflow controls

## Strategy

Use this issue as the parent roadmap. Implementation should happen through smaller child issues so coding agents can work one bounded slice at a time.

## Recommended sequencing

1. Client filtering and identify improvements
2. Reports/export capability
3. Data model/schema stabilization when account-management schema is available
4. Symbology and actionability states
5. Parcel layer expansion after required parcel data is available

## Blocking inputs

- Final question-area schema from account management
- Regrid tax parcel source data
- Client-owned parcel source data
- Desired symbology rules from current applications
- Report output requirements: fields, formats, filter behavior, branding
- Decision on whether Leaflet styling is enough or GeoServer is required

## Notes

Avoid major schema rewrites until the question-area schema is firmer. Prioritize capability boundaries and client-safe UI first because those are less dependent on final data shape.

Current status:

- the capability-boundary work described above is complete and should now be treated as baseline

## Issue 2: Foundation: implement Viewer/Reviewer permissions and hide workflow controls from viewer-only users

Status: implemented in repo, merged to `main`, and closed in GitHub as issue `#4`

### Body

## Goal

Separate client-safe read-only viewing from reviewer workflow capabilities.

## Scope

- Add explicit permissions for question-area read, review, assign, comment, and document upload.
- Stop treating `client` as both an identity type and a capability package.
- Hide workflow controls from users who do not have reviewer permissions.
- Enforce matching backend authorization so viewer-only users cannot mutate records by calling the API directly.

## Primary files

- `backend/src/lib/rbac.ts`
- `frontend/src/lib/rbac.ts`
- `backend/src/routes/questionAreas.ts`
- `frontend/src/components/MapWorkspace.tsx`
- `frontend/src/App.tsx`

## Acceptance criteria

- Viewer-only users can browse and inspect question areas.
- Viewer-only users cannot edit workflow fields.
- Viewer-only users cannot assign work unless explicitly permissioned.
- Viewer-only users cannot post comments or upload documents unless explicitly permissioned.
- Reviewer-capable users retain existing review workflow abilities.
- Backend write routes return `403` for users without the required permission.

## Dependencies

- This can proceed before the final account-management question-area schema is available.

## Issue 3: Filters: add deeper client-facing question-area filtering

### Body

## Goal

Allow users to drill into the question areas they need to inspect or review without seeing every question area at once.

## Candidate filters

- County
- State
- Property
- Reviewer or assignee
- Status
- Priority or severity
- Actionability state
- Data availability flags
- Free-text search

## Scope

- Define reusable filter state in the frontend.
- Add query parameters or backend filtering support where needed.
- Keep filter behavior reusable for map display, list display, and report exports.

## Acceptance criteria

- Users can filter question areas by practical business dimensions such as geography and assignment.
- Filtered state affects the list and map consistently.
- The implementation does not require final schema fields except for fields already present or safely nullable.

## Dependencies

- Final filter names and field mappings may need revision after the account-management schema lands.
- The first pass should use existing fields and `raw_properties` defensively.

## Issue 4: Identify tool: client-facing polygon/asset identify panel

### Body

## Goal

Add a polished identify tool that lets clients click map polygons and inspect the associated asset data in a structured, client-friendly panel.

## Scope

- Support identifying visible polygons from available layers.
- Display layer name, primary identifiers, relevant attributes, and geometry/context metadata where useful.
- Make the panel visually polished enough for client use.
- Keep display fields configurable or centralized so field names can change without editing many UI components.

## Candidate layers

- Land records
- Management areas
- Future Regrid tax parcels
- Future client-owned parcels

## Acceptance criteria

- Clicking an identifiable polygon opens a structured detail box.
- The panel avoids dumping raw JSON by default.
- Unknown or unmapped fields can still be shown in an advanced/details section if useful.
- The design works on desktop and mobile layouts.

## Dependencies

- Can start with current `land_records` and `management_areas`.
- Parcel identify should wait until parcel layers are available.

## Issue 5: Reports: add spreadsheet and PDF export workflows with filters

### Body

## Goal

Allow users to export question-area reports from the current dataset or filtered subsets.

## Report formats

- Spreadsheet export first
- PDF export after fields, layout, and branding are clearer

## Candidate report filters

- County
- State
- Property
- Reviewer or assignee
- Status
- Priority or severity
- Entire property or all visible/filtered question areas

## Scope

- Reuse the same filtering model as the main question-area UI.
- Add a backend export endpoint or frontend-generated export depending on final report requirements.
- Start with a spreadsheet report because it is less design-sensitive than PDF.
- Add PDF only after deciding report layout, fields, and branding.

## Acceptance criteria

- Users can export filtered question-area records to a spreadsheet.
- Exported fields are predictable and client-readable.
- PDF report requirements are documented before implementation.

## Dependencies

- Needs report field list and expected user workflow.
- PDF branding/layout should be decided before PDF implementation.

## Issue 6: Data model: stabilize question-area schema and prepared-data loading contract

### Body

## Goal

Finalize the question-area data model and update the database, seed loader, API payloads, frontend types, and dataset contract in one coordinated pass.

## Scope

- Review the current runtime data model from `docs/data-model-audit-handoff.md`.
- Confirm which question-area fields are first-class database columns.
- Confirm which fields remain in `raw_properties`.
- Update PostGIS schema bootstrap or migration approach.
- Update standardized seed loader.
- Update backend route responses.
- Update frontend API types and UI labels.
- Update `docs/dataset-contract.md`.

## Known candidate changes

- Editable priority or severity
- Actionability state
- GIS acres naming
- Source layer visibility/removal from client UI
- Any account-management-provided question-area fields

## Acceptance criteria

- The schema matches the agreed question-area contract.
- Seed loading works from standardized data.
- Frontend and backend types agree.
- Dataset contract docs are updated in the same pass.

## Dependencies

- Blocked by final or near-final account-management question-area schema.

## Issue 7: Symbology: add actionability states for question areas

### Body

## Goal

Represent question-area actionability visually on the map so users can distinguish normal review items, high-pain/problem items, unsolvable/no-parcel-data cases, and actively worked items.

## Candidate symbols

- Standard question mark for normal question areas
- Exclamation/caution state for high-pain or urgent issues
- No parcel data or unsolvable symbol
- Working/in-progress symbol

## Scope

- Define the actionability/status states.
- Add frontend symbology rules.
- Add or map backend fields needed to drive the symbols.
- Keep the design aligned with future app-wide symbology standards.

## Acceptance criteria

- Question-area symbols communicate actionability clearly.
- Symbology is driven by structured data, not hardcoded per feature.
- Missing or unknown state falls back to safe default styling.

## Dependencies

- Partially dependent on data model work if actionability requires new persisted fields.
- Can prototype with existing `status`/`severity` fields.

## Issue 8: Symbology: align map styling with current company applications and decide whether GeoServer is needed

### Body

## Goal

Align QAViewer map layer styling with the company's current applications and decide whether the current Leaflet/API approach is sufficient or whether GeoServer should become part of the stack.

## Scope

- Inventory desired styles from existing applications.
- Compare required styling against current Leaflet vector styling capabilities.
- Identify where server-side tile rendering, scale-dependent styling, labels, or large-layer performance may require GeoServer.
- Document recommended architecture before implementation.

## Acceptance criteria

- There is a clear decision: Leaflet/API styling for now, or add GeoServer.
- The decision includes tradeoffs for performance, deployment complexity, styling fidelity, and data model impact.
- Implementation tasks are broken out after the decision.

## Dependencies

- Blocked by desired symbology examples/rules from the user/team.
- May overlap with broader data model and layer architecture cleanup.

## Issue 9: Parcels: add Regrid tax parcels and client-owned parcel layers

### Body

## Goal

Add parcel context layers so QAViewer can show both broader Regrid tax parcel data and the parcels the client actually owns.

## Scope

- Add Regrid tax parcel layer source.
- Add client-owned parcel layer source.
- Decide whether these are prepared seed datasets, direct database loads, or external service-backed layers.
- Add backend layer routes.
- Add frontend layer toggles, styling, and identify support.

## Acceptance criteria

- Users can toggle Regrid tax parcels.
- Users can toggle client-owned parcels.
- Identify works for parcel features.
- Parcel layers do not block the existing question-area workflow.

## Dependencies

- Blocked by Regrid parcel data.
- Blocked by client-owned parcel data.
- Should happen after the loading/data model approach is clearer.

## Issue 10: UI cleanup: remove source-layer display where it is not useful and rename calculated acreage label to GIS acres

### Body

## Goal

Clean up client-facing field labels so the UI shows useful business language instead of internal source details.

## Scope

- Find where source layer values appear in the frontend.
- Remove or hide source layer from client-facing views unless it is specifically useful.
- Rename calculated acreage labels to `GIS acres` where appropriate.
- Confirm whether this is only a UI label change or also part of the persisted data contract.

## Acceptance criteria

- Client-facing UI no longer exposes confusing source-layer values.
- Calculated acreage is labeled as `GIS acres`.
- Any schema-level changes are deferred to the data model stabilization issue unless required immediately.

## Dependencies

- Can mostly proceed as a UI cleanup.
- Schema-level naming changes should wait for the data model pass.

## Issue 11: Editable priority: allow authorized reviewers to edit question-area priority

### Body

## Goal

Allow priority to be edited by authorized reviewer users.

## Scope

- Decide whether priority reuses the current `severity` field or needs a new `priority` field.
- Add frontend editing controls for authorized users.
- Add backend validation and persistence.
- Keep viewer-only users read-only.

## Acceptance criteria

- Authorized reviewers can update priority.
- Viewer-only users cannot update priority.
- Priority appears consistently in list, map details, filters, and reports where applicable.

## Dependencies

- Best handled with the data model stabilization issue if a new persisted field is required.
- Can be done sooner if `severity` is accepted as the initial priority field.

## Issue 12: User management: support adding new users cleanly from the admin surface

### Body

## Goal

Make adding new QAViewer users reliable and aligned with the new permission model.

## Scope

- Review the current admin user creation flow.
- Ensure new users can be assigned an appropriate role/package.
- Ensure frontend and backend validation match.
- Ensure the selected role maps to the correct permissions.

## Acceptance criteria

- Admin users can add a new user.
- New users receive the intended Viewer/Reviewer/support-module capability package.
- User creation does not expose unsupported or confusing role choices.

## Dependencies

- Should follow or coincide with the Viewer/Reviewer permission foundation.
