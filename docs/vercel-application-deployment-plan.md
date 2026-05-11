# Vercel Application Deployment Plan

Created: 2026-05-08

## Purpose

Deploy QAViewer on Vercel after the database has been moved to Supabase and runtime ETL has been removed from application startup.

This plan assumes the Supabase data migration plan has already made the database durable and production startup database-only.

Related plans:

- `docs/supabase-data-migration-plan.md`
- `docs/local-supabase-development-plan.md`
- `docs/prepared-data-multitenant-postgres-plan.md`

## Target State

- Vercel hosts the Vite React frontend.
- The API runs in a Vercel-compatible deployment path, or is prepared to move to a small container host if serverless constraints become a problem.
- The API connects to Supabase using a pooled database connection.
- No production code depends on local seed folders or local upload folders.
- Vercel is configured with spend controls.

## Scope

In scope:

- Vercel project setup.
- Frontend deployment.
- API deployment strategy.
- Environment variables.
- Build configuration.
- Production health checks.
- Vercel spend guardrails.

Out of scope:

- Supabase schema/data migration.
- Multi-tenant authorization.
- Large document storage migration, except for avoiding Vercel filesystem assumptions.

## Architecture Decision

Use Vercel for the web application first. The frontend is a straightforward Vite static deployment.

For the API, start with a Vercel-compatible serverless adapter only after runtime ETL is removed. If the Express API becomes awkward on Vercel because of long requests, file handling, connection pressure, or function limits, move the API to a small container service later while keeping Vercel for the frontend.

## Implementation Steps

### 1. Prepare Frontend For Vercel

- Confirm `frontend` builds with:

```bash
cd frontend
npm run build
```

- Set Vercel project root or build settings:

```text
Root Directory: frontend
Build Command: npm run build
Output Directory: dist
```

- Configure:

```text
VITE_API_BASE_URL=https://<api-host>/api
```

### 2. Prepare API For Vercel

Create a Vercel API entrypoint that imports `createApp()` without calling `app.listen`.

Current local entrypoint:

```text
backend/src/server.ts
```

Production serverless entrypoint should:

- import `createApp` from `backend/src/app.ts`
- run no ETL
- avoid local file writes
- use Supabase pooled database URL
- return health status quickly

### 3. Add Vercel Config

Add deployment configuration only after choosing the final repository layout for the API.

Possible approaches:

- Frontend-only Vercel project, API hosted elsewhere.
- Separate Vercel project for API.
- Monorepo Vercel configuration with frontend and API routing.

Start with the least risky option:

```text
Vercel frontend first, then API.
```

### 4. Configure Environment Variables

Frontend:

```text
VITE_API_BASE_URL
```

API:

```text
DATABASE_URL
JWT_SECRET
DEMO_MODE=false
STARTUP_DATA_MODE=validate
FRONTEND_ORIGIN=https://<vercel-domain>
```

If Supabase Storage is already in use:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET
```

### 5. Add Production Health Checks

Verify:

- `/api/health` returns OK.
- frontend loads login screen.
- login works.
- authenticated map data loads.
- overlays load.
- question area details load.
- export works within limits.

### 6. Add Spend Controls

In Vercel:

- enable Spend Management
- set a monthly threshold
- enable the production pause action
- avoid Vercel Blob for document-heavy storage at first
- avoid routing large document downloads through Vercel

In Supabase:

- keep Spend Cap enabled
- monitor database size, storage size, egress, and connection usage

### 7. Production Hardening Before Client Sharing

- Disable demo mode.
- Use a strong `JWT_SECRET`.
- Set exact `FRONTEND_ORIGIN`.
- Add rate limiting for login, exports, and document endpoints.
- Add download audit logging before large document access.
- Keep private document buckets.

## Acceptance Criteria

- Frontend is deployed on Vercel and points to the production API.
- API uses Supabase database in validation mode.
- No Vercel runtime path requires local seed files or local document folders.
- Vercel spend controls are enabled.
- Supabase spend cap is enabled.
- Basic authenticated workflow works from the Vercel URL.

## Risks

- Express-on-Vercel may need adapter work.
- Serverless database connection pressure can create Supabase connection issues if the pooled URL is not used.
- Large downloads through Vercel can increase Vercel metered usage.
- Long-running import/export jobs do not belong in Vercel functions.

## Fallback

If Vercel API hosting is not a good fit, keep:

- Vercel for frontend
- Supabase for database/storage
- Render, Fly.io, Railway, or DigitalOcean App Platform for the Express API

The Supabase migration still remains valid.
