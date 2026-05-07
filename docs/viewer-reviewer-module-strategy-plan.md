# Viewer And Reviewer Module Strategy Plan

## Purpose

Reshape QAViewer from a single review-first application into a modular product with:

- a `Viewer` experience that is safe to deliver to clients by default
- a `Reviewer` experience that supports collaborative question-area resolution with internal staff and optionally clients
- support modules such as Atlas Land Records and Property Tax that can be granted independently of reviewer access

This plan is intended as an implementation handoff for a separate coding window.

## Product Direction

The application should support two main business modes:

1. `Viewer`

   A read-only workspace for inspecting question areas, map context, and property information after a property is implemented in one of the company systems.

2. `Reviewer`

   A collaborative workflow workspace where internal staff and optionally clients can:

   - move question areas through review statuses
   - assign or reassign work
   - leave comments
   - upload supporting documents
   - use Atlas Land Records and Property Tax support data when permitted

The critical point is that `client` should stop meaning both identity and capability. A client may be:

- a viewer-only user
- a reviewer
- a reviewer with Atlas and Property Tax support access

## Current State

The current app is still organized around a single authenticated review workspace:

- [App.tsx](C:/dev/QAViewer/frontend/src/App.tsx) routes all signed-in non-admin users into `MapWorkspace`
- [MapWorkspace.tsx](C:/dev/QAViewer/frontend/src/components/MapWorkspace.tsx) mixes:
  - read-only question-area viewing
  - review workflow controls
  - comments and uploads
  - Atlas and Property Tax support modules
- [questionAreas.ts](C:/dev/QAViewer/backend/src/routes/questionAreas.ts) still allows `admin` and `client` to mutate core review records through `PATCH`, comments, and document upload routes
- Atlas and Property Tax are now permission-gated, but core review behavior is not yet separated into its own permission model

## Target Capability Model

Keep the single persisted `users.role` field for now, but map roles to explicit permissions.

Recommended permissions:

- `question_areas:read`
- `question_areas:review`
- `question_areas:assign`
- `question_areas:comment`
- `question_areas:upload_documents`
- `atlas_land_records:read`
- `property_tax:read`
- `admin:manage_users`

Notes:

- `question_areas:review` covers status and summary edits
- `question_areas:assign` is separate because assignment may eventually be more restricted than general review
- `question_areas:comment` and `question_areas:upload_documents` can be split if the business wants clients to comment without editing workflow fields
- Atlas and Property Tax remain support-module permissions, not review permissions

## Proposed Module Model

### Viewer Module

Available to any authenticated user with `question_areas:read`.

Includes:

- map
- search and filters
- question-area results
- question-area read-only details
- read-only data signals and source context
- document download visibility only if product wants viewer access to existing documents

Excludes:

- workflow editing controls
- reassignment controls
- comment form if comment access is not granted
- upload controls if upload access is not granted
- Atlas and Tax support modules unless separately permitted

### Reviewer Module

Available to users with one or more review permissions.

Includes:

- all viewer capabilities
- workflow status updates
- assignment and reassignment
- notes and review summary editing
- comments
- uploads
- optional Atlas and Property Tax support modules when separately permitted

### Support Modules

Support modules should be treated as add-on modules under the reviewer surface, not the definition of reviewer access.

Modules:

- Atlas Land Records
- Property Tax

These should remain independently grantable.

## Role Strategy

Do not lock the long-term design to the current five roles. Use them as an initial packaging mechanism only.

Practical near-term packaging:

| Role | `question_areas:read` | `question_areas:review` | `question_areas:assign` | `question_areas:comment` | `question_areas:upload_documents` | `atlas_land_records:read` | `property_tax:read` | `admin:manage_users` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `admin` | yes | yes | yes | yes | yes | yes | yes | yes |
| `gis_team` | yes | yes | yes | yes | yes | yes | yes | no |
| `land_records_team` | yes | yes | yes | yes | yes | yes | yes | no |
| `client` | yes | no by default | no by default | no by default | no by default | no by default | no by default | no |
| `other` | yes | no | no | no | no | no | no | no |

Important business option:

- If a client opts into collaborative resolution, either:
  - create a new reviewer-oriented external role later, or
  - temporarily map `client` differently per environment or customer segment

Long-term, role alone will not be enough if reviewer access varies by property or client account.

## Architecture Direction

### Frontend

Move from one all-purpose workspace to one shell with module-specific regions.

Recommended shape:

- `App`
  - determines available top-level modules for the current session
- `ViewerWorkspace`
  - read-only question-area browsing and detail viewing
- `ReviewerWorkspace`
  - extends viewer behavior with workflow tools
- support panels
  - Atlas
  - Property Tax

This can be implemented incrementally without deleting `MapWorkspace` immediately. A staged refactor is safer:

- first split `MapWorkspace` internally into read-only and review sections
- then promote those sections into separate workspace components if the split holds up

### Backend

Keep the current route groups, but make permissions explicit by behavior:

- read routes
- review mutation routes
- support module routes
- admin routes

Avoid using `client` as a backend authorization shortcut.

## Phase Plan

### Phase 1: Define Permission Model

Goal:

Introduce explicit question-area permissions to match the new viewer vs reviewer strategy.

Tasks:

- Extend backend RBAC definitions in [backend rbac.ts](C:/dev/QAViewer/backend/src/lib/rbac.ts)
- Extend frontend RBAC definitions in [frontend rbac.ts](C:/dev/QAViewer/frontend/src/lib/rbac.ts)
- Decide the exact policy for:
  - who can edit workflow fields
  - who can assign work
  - who can comment
  - who can upload documents
  - whether viewer users can download existing documents

Deliverable:

- centralized permission map for the next phases

### Phase 2: Split Read-Only And Review UI

Goal:

Separate viewer-safe detail rendering from reviewer-only workflow rendering.

Primary file targets:

- [MapWorkspace.tsx](C:/dev/QAViewer/frontend/src/components/MapWorkspace.tsx)
- optional new components under `frontend/src/components/`

Tasks:

- split `ReviewRecordSections` into:
  - read-only record overview
  - read-only data signals
  - reviewer workflow controls
  - reviewer assignment UI
  - comments section
  - documents section
- render workflow controls only when `question_areas:review` is present
- gate assignment controls behind `question_areas:assign`
- decide whether comments and uploads:
  - remain visible but read-only
  - remain fully hidden
  - allow reading but not posting/uploading

Deliverable:

- no reviewer-only UI visible in viewer mode

### Phase 3: Introduce Explicit Viewer And Reviewer Entry Paths

Goal:

Make the product split visible in the top-level app structure.

Primary file targets:

- [App.tsx](C:/dev/QAViewer/frontend/src/App.tsx)
- optional new files such as:
  - `frontend/src/components/ViewerWorkspace.tsx`
  - `frontend/src/components/ReviewerWorkspace.tsx`

Tasks:

- determine available modules from the current user session
- add top-level workspace routing based on permissions instead of role-only branching
- preserve `AdminWorkspace` as a separate top-level surface
- choose whether reviewer users land on:
  - viewer first with a review toggle
  - reviewer first

Recommended default:

- viewer-only users land in viewer mode
- reviewer-capable users land in reviewer mode

### Phase 4: Align Backend Write Authorization

Goal:

Make backend security match the new frontend behavior.

Primary file target:

- [questionAreas.ts](C:/dev/QAViewer/backend/src/routes/questionAreas.ts)

Tasks:

- replace `requireRole("admin", "client")` on review mutations with permission checks
- split write behaviors by permission:
  - `PATCH /api/question-areas/:code` -> `question_areas:review`
  - assignment changes, if split out -> `question_areas:assign`
  - `POST /api/question-areas/:code/comments` -> `question_areas:comment`
  - `POST /api/question-areas/:code/documents` -> `question_areas:upload_documents`
- keep read routes available to `question_areas:read`

Deliverable:

- viewer users cannot mutate review state even if they call the API directly

### Phase 5: Clean Up Naming And UX

Goal:

Make the application language match the new product strategy.

Primary file targets:

- [MapWorkspace.tsx](C:/dev/QAViewer/frontend/src/components/MapWorkspace.tsx)
- [styles.css](C:/dev/QAViewer/frontend/src/styles.css)

Tasks:

- replace universal “review workspace” language where it should say `Viewer` or `Reviewer`
- make panel labels reflect module boundaries
- ensure hidden reviewer modules do not leave empty rails or blank sections
- ensure mobile layout still behaves correctly when viewer mode has fewer modules

### Phase 6: Future Property-Level Scope

Goal:

Avoid painting the access model into a corner.

This phase does not need to be implemented now, but current work should not block it.

Design guardrails:

- do not assume permissions are global forever
- avoid role-literal checks in feature components
- keep permission checks centralized so property-scoped access can later be layered in

## Concrete Execution Order

Recommended order for the implementation window:

1. extend backend and frontend RBAC definitions with question-area permissions
2. refactor `ReviewRecordSections` into read-only and editable sub-sections
3. hide workflow controls from viewer-only users
4. decide and implement comments/documents visibility behavior
5. replace backend write-route role guards with permission guards
6. add top-level viewer vs reviewer routing if the team wants the split visible immediately

If scope must stay tight, stop after step 5. That still delivers a real viewer/reviewer capability split without a full front-end routing overhaul.

## Test Plan

### Backend

Update or add tests in:

- [question-areas.smoke.test.ts](C:/dev/QAViewer/backend/tests/question-areas.smoke.test.ts)

Cover:

- viewer-only user can read question areas
- viewer-only user gets `403` on workflow edit route
- viewer-only user gets `403` on comment and upload routes if those are reviewer-only
- reviewer-capable role can still update status, comment, and upload as intended

### Frontend

If frontend tests are added later, cover:

- viewer-only user sees read-only record detail but no workflow controls
- reviewer-capable user sees workflow controls
- viewer-only user sees no empty placeholders where reviewer sections were removed
- Atlas and Tax support modules still respect their own permissions independent of reviewer access

### Manual Verification

Use at least these user shapes:

1. viewer-only client
2. reviewer-capable internal user
3. reviewer-capable user with Atlas and Tax support access
4. admin

Verify:

- viewer-only client can browse and inspect but cannot mutate
- reviewer user can move work, comment, and upload
- support modules remain hidden unless granted
- no blank rails or broken layouts remain after sections are hidden

## Open Decisions

These decisions should be made before implementation starts:

1. Should viewer-only users see existing comments and documents, or should those be reviewer-only?
2. Should assignment be editable by all reviewers, or only internal staff?
3. Should clients who opt into collaboration reuse the `client` role initially, or should a new external reviewer role be introduced soon?
4. Should the first implementation keep one shared workspace shell, or immediately split into `ViewerWorkspace` and `ReviewerWorkspace` components?

## Recommended Initial Answer Set

To keep delivery moving, the least disruptive first implementation is:

- viewer-only users can read question areas
- viewer-only users cannot edit workflow fields
- viewer-only users cannot post comments
- viewer-only users cannot upload documents
- reviewer-capable internal roles can do all review actions
- Atlas and Tax remain separately permissioned support modules
- the frontend may keep one shared shell initially, as long as the read-only vs review split is explicit and backend authorization matches it

This gives the product a real `Viewer` base layer immediately, while leaving room to later introduce a more nuanced client-collaboration package.
