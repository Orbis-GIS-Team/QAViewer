# Supabase Dev Migration Handoff

Date: 2026-05-19

## Current State

The QAViewer dev Supabase database migration is implemented and the first prepared dataset has been restored.

Supabase project:

- Name: `QAViewer Dev`
- Ref: `lfkuwbcmdlhkefnmdcsj`
- Region: `us-east-1`
- Organization: `Orbis GIS`
- Runtime/restore host used successfully: `aws-1-us-east-1.pooler.supabase.com:5432`

Prepared data restore completed successfully through:

```powershell
cd C:\dev\QAViewer\backend
npm run db:restore:supabase
npm run db:validate
```

Validation passed against Supabase.

Remote Supabase counts confirmed:

```text
users: 5
question_areas: 77
land_records: 1316
management_areas: 340
atlas_land_records: 1693
atlas_documents: 497
atlas_document_links: 2703
atlas_featureless_docs: 0
atlas_document_manifest: 497
atlas_import_rejects: 609
tax_parcels: 6
tax_bill_manifest: 8
property_tax_parcel_points: 4606
comments: 0
documents: 0
```

After the Supabase-backed smoke test on 2026-05-19, `comments` and `documents` are `1` each because the smoke flow created one test comment and one uploaded test document.

`qaviewer-prepared.dump` exists locally at the repo root and is gitignored.

## Implemented Repo Changes

New backend scripts:

- `backend/src/db/dumpPreparedDatabase.ts`
- `backend/src/db/restoreSupabaseDatabase.ts`
- `backend/src/db/reportRuntimeCounts.ts`

New npm scripts in `backend/package.json`:

```text
npm run db:dump:prepared
npm run db:restore:supabase
npm run db:counts
```

New Supabase migrations:

- `supabase/migrations/20260519151703_enable_postgis_pg_trgm.sql`
- `supabase/migrations/20260519152255_baseline_schema.sql`
- `supabase/migrations/20260519152351_enable_runtime_table_rls.sql`

Other changed files:

- `.env.example`
- `.gitignore`
- `README.md`
- `backend/src/lib/db.ts`
- `docs/local-supabase-development-plan.md`
- `docs/supabase-prepared-data-handoff-runtime-plan.md`

Important implementation details:

- `db:restore:supabase` defaults to `PREPARED_RESTORE_MODE=app-data`.
- `app-data` restore truncates QAViewer runtime tables, restores only those app tables from the dump, and resets sequences.
- The restore helper can use local `pg_restore`; if missing, it falls back to Docker.
- On this machine, native `pg_restore` was found at:

```text
C:\Program Files\QGIS 4.0.0\bin\pg_restore.exe
```

- `backend/src/lib/db.ts` now strips `sslmode` from the connection URL and supplies Node `pg` SSL config directly so Supabase pooler URLs work.
- The restore helper uses the same SSL detection for its truncation/sequence-reset client, so Supabase URLs use TLS while local non-TLS database URLs are still supported.
- RLS is enabled on public runtime tables as Data API defense-in-depth. The Express API should use the Supabase owner/runtime database connection; browser-facing authorization remains in QAViewer's API layer.
- `.env` was updated by the user with Supabase settings and remains gitignored.

## Verification Completed

Completed successfully:

```powershell
cd C:\dev\QAViewer\backend
npm run db:validate
npm run db:counts
```

Builds completed successfully:

```powershell
cd C:\dev\QAViewer\backend
npm run build

cd C:\dev\QAViewer\frontend
npm run build
```

Local smoke test passed earlier against the Docker-backed API:

```powershell
cd C:\dev\QAViewer\backend
npm run test:smoke
```

Supabase-backed local runtime smoke passed on 2026-05-19:

```powershell
cd C:\dev\QAViewer\backend
npm run dev

cd C:\dev\QAViewer\frontend
npm run dev -- --host 127.0.0.1

curl http://localhost:3001/api/health
curl -I http://127.0.0.1:5173

cd C:\dev\QAViewer\backend
$env:QA_SMOKE_API_URL="http://localhost:3001/api"
npm run test:smoke
```

Manual browser smoke also passed for admin login, question-area list, question-area detail, map/layer rendering, Atlas panel, and admin user management.

GitHub issues updated with migration status:

- `#16`
- `#18`
- `#19`

## Next Steps

1. Supabase DB password rotation is complete as of 2026-05-20. Do not record the refreshed password in repository files or docs.

2. After password rotation:

- update repo-root `.env`
- rerun `npm run db:validate`
- rerun local backend/frontend smoke checks

3. Review and commit the repo changes.

## Notes For Fresh Context

- Do not re-run a full restore unless replacing the Supabase dev dataset intentionally.
- If restore is needed again, use the Supabase session pooler URL from the dashboard, not the direct IPv6-only host.
- The direct host `db.lfkuwbcmdlhkefnmdcsj.supabase.co` resolved IPv6-only from this machine and was not usable from Docker.
- The correct pooler host shown in the dashboard was `aws-1-us-east-1.pooler.supabase.com`, not `aws-0-us-east-1.pooler.supabase.com`.
- Use `DATABASE_SSL_REJECT_UNAUTHORIZED=false` for local Node `pg` connections through the Supabase pooler.
- Supabase Storage support has been added for new question-area uploads only. Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET` on the backend to store new upload bytes in a private bucket. If those variables are omitted, local/dev uploads continue to use `backend/uploads`.
- Atlas package documents, tax-bill PDFs, source workbooks, and spreadsheet packages are not migrated or stored in this pass; treat them as deferred for the pilot.
- Source-data loader commands are still future work; this pass used dump/restore first.
