# RBAC Implementation Plan

## Purpose

Add role-based access control for the Atlas Land Records and Property Tax modules.

The backend must enforce authorization for every protected module endpoint. The frontend should use the same role and permission model only for user experience: hiding tabs, avoiding restricted component rendering, preventing restricted hooks from firing, and keeping navigation clean.

## Current State

- Users currently have one persisted `role` field.
- Existing backend roles are `admin` and `client`.
- The backend authenticates protected API routes with bearer JWTs and reloads the current user from the database on each request.
- Admin routes already use `requireRole("admin")`.
- Atlas and Property Tax module routes are currently authenticated but not role-authorized.
- Frontend roles are typed in `frontend/src/App.tsx`.
- Atlas and Tax Parcels tabs are rendered in the right sidebar of `frontend/src/components/MapWorkspace.tsx`.

## Target Roles

| Role | Description |
| --- | --- |
| `admin` | Full access to everything, including user administration. |
| `gis_team` | Access to Atlas Land Records and Property Tax modules. |
| `land_records_team` | Access to Atlas Land Records and Property Tax modules. |
| `client` | No access to Atlas Land Records or Property Tax modules. |
| `other` | No access to Atlas Land Records or Property Tax modules. |

## Target Permissions

| Permission | Meaning |
| --- | --- |
| `atlas_land_records:read` | Can open Atlas Land Records workspace data, overlays, documents, and related support endpoints. |
| `property_tax:read` | Can open Property Tax workspace data, overlays, tax bills, and related support endpoints. |
| `admin:manage_users` | Can access user administration. |

## Role-Permission Mapping

| Role | `atlas_land_records:read` | `property_tax:read` | `admin:manage_users` |
| --- | ---: | ---: | ---: |
| `admin` | yes | yes | yes |
| `gis_team` | yes | yes | no |
| `land_records_team` | yes | yes | no |
| `client` | no | no | no |
| `other` | no | no | no |

Keep this mapping centralized. Do not scatter role literals through route handlers or React components.

## Sub-Agent Planning Breakdown

This plan was prepared with three scoped reconnaissance agents to minimize context passing.

### Role, Migration, And Testing Agent

Objective: Inspect current user schema, seeded users, role persistence behavior, and test impact.

Inputs:

- `backend/src/lib/schema.ts`
- `backend/src/lib/seed.ts`
- `backend/src/lib/auth.ts`
- `backend/src/routes/admin.ts`
- Existing backend smoke tests

Outputs:

- Current user table and role constraint behavior
- Demo user behavior
- Migration options
- Test areas to update

Dependencies:

- Feeds the role-permission model and backend/frontend role type changes.

### Backend Authorization Agent

Objective: Identify where server-side authorization must be added.

Inputs:

- `backend/src/lib/auth.ts`
- `backend/src/app.ts`
- `backend/src/routes/atlas.ts`
- `backend/src/routes/taxParcels.ts`
- `backend/src/routes/questionAreas.ts`
- Existing Atlas and tax parcel tests

Outputs:

- Exact endpoints that need guards
- Existing middleware behavior
- Suggested authorization helper location

Dependencies:

- Depends on the final role-permission mapping.

### Frontend Conditional Rendering Agent

Objective: Locate sidebar tabs, support workspace panels, overlays, data hooks, and fallback points.

Inputs:

- `frontend/src/App.tsx`
- `frontend/src/components/MapWorkspace.tsx`
- `frontend/src/components/AtlasPanel.tsx`
- `frontend/src/components/TaxParcelPanel.tsx`
- `frontend/src/components/AtlasMapOverlays.tsx`
- `frontend/src/components/TaxParcelMapOverlays.tsx`
- `frontend/src/lib/atlas.ts`
- `frontend/src/lib/taxParcels.ts`

Outputs:

- Where tabs are rendered
- How user role reaches the frontend
- Where restricted components and hooks should be gated
- Where tab fallback should be handled

Dependencies:

- Depends on frontend permission helpers matching the backend permission model.

## Backend Implementation Plan

1. Add centralized RBAC definitions.

   Recommended location: `backend/src/lib/auth.ts` or a new `backend/src/lib/rbac.ts`.

   Include:

   - `Role` union: `admin | gis_team | land_records_team | client | other`
   - `Permission` union
   - `ROLE_PERMISSIONS`
   - `hasPermission(user, permission)`
   - `requirePermission(permission)` Express middleware

2. Keep `authenticateRequest` as the authentication boundary.

   It already reloads the user from the database on each request. That is useful because role changes take effect without trusting stale JWT role claims.

3. Extend the `users.role` database constraint.

   Update `backend/src/lib/schema.ts`:

   - Expand `users_role_check`.
   - Preserve the existing `reviewer -> client` legacy migration.
   - Add any needed legacy cleanup for unknown roles before re-adding the check constraint.

4. Update admin user management.

   Update `backend/src/routes/admin.ts`:

   - Expand `ROLE_OPTIONS`.
   - Ensure create/update schemas accept new roles.
   - Preserve the existing “at least one admin account must remain” protection.
   - Keep admin route access restricted through `admin:manage_users` or `requireRole("admin")`.

5. Guard Atlas Land Records endpoints.

   Protect with `atlas_land_records:read`:

   - `GET /api/question-areas/:code/atlas`
   - `GET /api/atlas/featureless-docs`
   - `GET /api/atlas/import-report`
   - `GET /api/atlas/documents/:documentNumber/content`
   - `GET /api/atlas/documents/:documentNumber/download`

   If import reports should later be more restrictive than normal Atlas reading, introduce a separate permission such as `atlas_land_records:audit`. For this implementation, keep it simple and use read permission for all Atlas module endpoints.

6. Guard Property Tax endpoints.

   Protect with `property_tax:read`:

   - `GET /api/question-areas/:code/tax-parcels`
   - `GET /api/tax-parcels/bills/:billId/content`
   - `GET /api/tax-parcels/bills/:billId/download`

7. Keep core Question Area review behavior separate.

   Do not block normal question-area review routes unless the product scope changes. The requested RBAC applies to the Atlas Land Records and Property Tax modules and their supporting endpoints.

8. Decide whether supporting base layers need RBAC.

   `GET /api/layers/land_records` currently powers a map overlay independent of the Atlas tab. If the Atlas Land Records module is intended to include all land record visibility, guard `land_records` layer access too. If it is considered general review context, leave it authenticated-only. Make this decision explicit during implementation.

## Frontend Implementation Plan

1. Extend frontend role typing.

   Update `frontend/src/App.tsx`:

   - `UserRole = "admin" | "gis_team" | "land_records_team" | "client" | "other"`

2. Add frontend RBAC helper.

   Recommended location: `frontend/src/lib/rbac.ts`.

   Include:

   - `Permission` type
   - `ROLE_PERMISSIONS`
   - `hasPermission(role, permission)`
   - Optional helper for support tabs: `getVisibleSupportTabs(role)`

   This helper is for rendering and UX only. Backend enforcement remains authoritative.

3. Gate support workspace tab state.

   Update `frontend/src/components/MapWorkspace.tsx`:

   - Compute visible support tabs from `session.user.role`.
   - Change `supportWorkspaceTab` to support no selected tab when the user has no module access.
   - If the current selected tab becomes unauthorized after session refresh, reset to the first visible tab or `null`.

4. Hide restricted tabs completely.

   In `MapWorkspace`, only render:

   - Atlas tab when user has `atlas_land_records:read`
   - Property Tax tab when user has `property_tax:read`

   Unauthorized users should not see disabled tabs. They should see no module tabs at all.

5. Do not render restricted components.

   Only render these when authorized:

   - `AtlasPanel`
   - `TaxParcelPanel`
   - `AtlasMapOverlays`
   - `TaxParcelMapOverlays`

6. Prevent restricted API hooks from firing.

   Update hook `enabled` flags:

   - Atlas query enabled only when selected tab is Atlas and the user has `atlas_land_records:read`.
   - Tax parcel query enabled only when selected tab is Property Tax and the user has `property_tax:read`.

7. Keep UX clean when no support modules are available.

   For `client` and `other` users:

   - Do not render the support tab nav.
   - Do not render the restricted support panels.
   - Do not show broken loading states or authorization errors caused by hidden modules.
   - Keep the core review workspace usable.

8. Update admin UI role options.

   Update `frontend/src/components/AdminWorkspace.tsx`:

   - Add new roles to `ROLE_OPTIONS`.
   - Add readable labels such as `GIS Team`, `Land Records Team`, `Client`, and `Other`.

## Existing User Migration Strategy

Use the least surprising migration:

| Current Role | New Role |
| --- | --- |
| `admin` | `admin` |
| `client` | `client` |
| `reviewer` | `client` |
| unknown legacy value | `other` or `client` |

Recommended default:

- Existing non-admin users should remain `client`, which means no access to Atlas Land Records or Property Tax.
- New GIS and Land Records users should be explicitly assigned by an admin.
- Do not automatically grant module access to existing non-admin users.

Demo users:

- `admin@qaviewer.local` remains `admin`.
- `client@qaviewer.local` remains `client`.
- Existing demo rows are not overwritten because seed insertion uses `ON CONFLICT DO NOTHING`.
- If demo role changes are needed locally, reset the database volume or add an explicit migration/update.

## Testing Plan

### Backend Tests

Update or add smoke tests for:

- `admin`, `gis_team`, and `land_records_team` can access Atlas endpoints.
- `client` and `other` receive `403` for Atlas endpoints.
- `admin`, `gis_team`, and `land_records_team` can access Property Tax endpoints.
- `client` and `other` receive `403` for Property Tax endpoints.
- Unknown roles are rejected by admin create/update validation.
- Admin create/update accepts all supported roles.
- `/auth/me` reflects the database-loaded role, not a stale JWT role.
- Admin user management remains admin-only.

Relevant files:

- `backend/tests/atlas.smoke.test.ts`
- `backend/tests/tax-parcels.smoke.test.ts`
- `backend/tests/admin-users.smoke.test.ts`
- `backend/tests/auth.smoke.test.ts`
- `backend/src/smoke.test.ts`

### Frontend Tests

If frontend tests are added or already available, cover:

- `client` and `other` users do not see Atlas or Property Tax tabs.
- Restricted panels and overlays are not rendered for unauthorized users.
- Restricted query hooks are not enabled for unauthorized users.
- `admin`, `gis_team`, and `land_records_team` see both module tabs.
- If a user role changes during session refresh, the selected support tab falls back cleanly.

### Manual Verification

After implementation:

```bash
cd backend
npm run build
npm run test:smoke
```

```bash
cd frontend
npm run build
```

With the stack running:

```bash
curl http://localhost:3001/api/health
curl -I http://localhost:5173
```

Also manually verify:

- Admin can see and open both module tabs.
- GIS Team can see and open both module tabs.
- Land Records Team can see and open both module tabs.
- Client cannot see either module tab.
- Client receives `403` when directly calling restricted module endpoints.

## Suggested Code Locations

Backend:

- `backend/src/lib/auth.ts`
- Optional new file: `backend/src/lib/rbac.ts`
- `backend/src/lib/schema.ts`
- `backend/src/routes/admin.ts`
- `backend/src/routes/questionAreas.ts`
- `backend/src/routes/atlas.ts`
- `backend/src/routes/taxParcels.ts`

Frontend:

- `frontend/src/App.tsx`
- Optional new file: `frontend/src/lib/rbac.ts`
- `frontend/src/components/MapWorkspace.tsx`
- `frontend/src/components/AdminWorkspace.tsx`

Tests:

- `backend/tests/atlas.smoke.test.ts`
- `backend/tests/tax-parcels.smoke.test.ts`
- `backend/tests/admin-users.smoke.test.ts`
- `backend/tests/auth.smoke.test.ts`
- `backend/src/smoke.test.ts`

## Implementation Notes

- Use backend RBAC as the security boundary.
- Use frontend RBAC only to shape the user experience.
- Keep roles coarse and permissions explicit.
- Do not add role hierarchy tables unless future requirements justify them.
- Do not grant module access to existing non-admin users by default.
- Keep the browser decoupled from PostGIS; all restricted data access must remain behind API authorization.
