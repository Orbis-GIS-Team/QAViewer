# QAViewer Stabilization Model Assignment Todo

Date: 2026-04-03

Updated: 2026-04-16 after first implementation pass

Input report: `code_review_stabilization_report_2026-04-03.md`

Purpose:

- Turn the stabilization report into an executable todo list.
- Assign each reported item to one primary model in Codex or Claude Code.
- Track current execution order after the 2026-04-16 repo status check.
- Base model selection on the original model-doc review from 2026-04-03 unless a later assignment pass explicitly updates it.

Current repo status, 2026-04-16:

- Most Phase 1 and Phase 2 stabilization tasks are implemented.
- Admin create/update email normalization is already present and is no longer a primary task.
- A live backend smoke test command now exists and passed against the running Docker/API/PostGIS stack on 2026-04-16.
- `scripts/export_seed_data.py` now targets the two mismatch erase layers, validates source breakdown, and accepts source/layer overrides for compatible future datasets.
- `data/generated/` still needs regeneration; the current generated manifest still reports 557 primary-derived question areas until that is done.
- A Docker/GDAL toolchain can run, but the mounted `BTG_PTV_Implementation.gdb` exposes only `BTG_Points_NoArches_12Feb26`, `BTG_Spatial_Fix_Primary_Layer`, and `BTG_MGMT_NoArches`; the required mismatch erase layers are missing.
- PostGIS still needs explicit reset/reseed after regenerated assets are produced.
- Verification completed after implementation: `cd backend && npm run build`, `cd frontend && npm run build`, and `git diff --check`.

Parallel-agent usage note:

- One parallel Codex worker was used for the admin authored-activity guard.
- The rest of the pass was kept in the main agent because `MapWorkspace`, seed behavior, and route matching had overlapping write scopes that would have increased merge risk.

## Current Model Inventory Used For Assignment

### Codex

Current recommended models listed in the Codex docs:

- `gpt-5.4`: flagship model for professional work with stronger reasoning, tool use, and agentic workflows
- `gpt-5.4-mini`: fast, efficient mini model for responsive coding tasks and subagents
- `gpt-5.3-codex`: industry-leading coding model for complex software engineering
- `gpt-5.3-codex-spark`: research-preview text-only model for near-instant coding iteration

Current alternative models still listed in the Codex docs:

- `gpt-5.2-codex`
- `gpt-5.2`
- `gpt-5.1-codex-max`
- `gpt-5.1`
- `gpt-5.1-codex`
- `gpt-5-codex`
- `gpt-5-codex-mini`
- `gpt-5`

Codex assignment rule used here:

- Prefer `gpt-5.4` for cross-cutting backend/frontend/test work.
- Prefer `gpt-5.3-codex` for repo-wide refactors and shared-logic extraction.
- Prefer `gpt-5.4-mini` for bounded, low-risk fixes.
- Do not assign `gpt-5.3-codex-spark` to the stabilization backlog by default because it is research preview and optimized for rapid iteration rather than higher-risk repo changes.
- Do not assign the older alternative models unless access, cost, or org policy blocks the recommended models.

### Claude Code

Current latest Claude models behind Claude Code aliases:

- `claude-opus-4-6` via `opus`: highest-capability model for complex reasoning and coding
- `claude-sonnet-4-6` via `sonnet`: best balance of speed and intelligence for day-to-day coding
- `claude-haiku-4-5` via `haiku`: fastest low-risk implementation and cleanup model

Current Claude Code model options and aliases:

- `default`
- `best`
- `sonnet`
- `opus`
- `haiku`
- `sonnet[1m]`
- `opus[1m]`
- `opusplan`

Claude Code assignment rule used here:

- Prefer `opusplan` for large ambiguous work that needs planning before implementation.
- Prefer `sonnet` for standard implementation tasks that are not trivial.
- Prefer `haiku` for docs, cleanup, and low-risk inventory work.
- Use the `[1m]` variants only when a task genuinely needs the extra context window.

## Assignment Matrix

### Critical

- [~] Finding 1: Rewrite question-area generation to use `BTG_Spatial_Fix_Primary_Erase` and `BTG_Spatial_Fix_Comparison_Erase` instead of `BTG_Spatial_Fix_Primary_Layer`.
  Primary model: Codex `gpt-5.4`
  Status: exporter code changed and validates mismatch-layer source groups; source path and physical layer names are configurable for compatible future datasets. Regeneration/reseed is still pending because the mounted geodatabase does not include the required mismatch erase layers.

- [x] Finding 2: Add manifest-hash or seed-version enforcement so regenerated GIS assets cannot be silently ignored.
  Primary model: Codex `gpt-5.4`
  Status: implemented with `seed_metadata` and SHA-256 tracking of `data/generated/manifest.json`; docs include reset/reseed workflow.

### High

- [x] Finding 3: Count `parcel_comments` in admin activity queries, serialize that count to the frontend, disable unsafe deletes, and block deletion with a controlled conflict response.
  Primary model: Codex `gpt-5.4-mini` worker
  Status: implemented by parallel worker in `backend/src/routes/admin.ts` and `frontend/src/components/AdminWorkspace.tsx`.

- [x] Finding 4: Align the `review` workflow state across backend enums, frontend controls, labels, and parcel visibility rules.
  Primary model: Codex `gpt-5.4`
  Status: implemented with `review` kept as first-class persisted workflow state.

- [x] Finding 5: Render `feedback` in `MapWorkspace` and make existing save/error/load state visible to users.
  Primary model: Codex `gpt-5.4-mini`
  Status: implemented with visible toast feedback and validation feedback.

### Medium

- [x] Finding 6: Extract parcel-to-question-area matching into one reusable backend helper or SQL view.
  Primary model: Codex `gpt-5.3-codex`
  Status: implemented in `backend/src/lib/parcelQuestionAreaMatch.ts`.

- [x] Finding 7: Remove or hide misleading parcel-document controls until true parcel-scoped documents exist.
  Primary model: Codex `gpt-5.4`
  Status: parcel document upload controls/copy removed from `MapWorkspace`; question-area documents remain functional.

- [ ] Finding 8: Split `MapWorkspace` into smaller hooks/components and replace overlapping selection state with one discriminated model.
  Primary model: Claude Code `opusplan`
  Status: still open. Do this after regenerated seed assets and reseed verification are green.

- [x] Finding 9: Add a minimal smoke suite for login, admin CRUD/deletion conflicts, question-area flows, and parcel flows.
  Primary model: Codex `gpt-5.4`
  Status: live backend smoke test entrypoint added as `npm run test:smoke`; it passed against the running stack on 2026-04-16.

- [x] Finding 10: Relax upload validation so legitimate browser uploads are not rejected on exact MIME mismatches alone.
  Primary model: Codex `gpt-5.4-mini`
  Status: implemented; blank MIME and `application/octet-stream` are allowed when extension is safe.

### Low / Structural

- [~] Finding 11: Reconcile repo docs and runtime docs after the seed model is corrected.
  Primary model: Claude Code `haiku`
  Status: README/AGENTS updated for current runtime behavior; exact generated counts still wait on regeneration.

- [x] Finding 12: Audit dead or partially implemented backend surface area and either remove it or finish wiring it.
  Primary model: Claude Code `opus`
  Status: fixed for active app surfaces. Unused `county_boundaries`, unused `parcel_status_history`, and unused `asGeoJsonString` were removed from active code. `parcel_points` remains because it is exported, seeded, exposed by API, and rendered in the main UI as a toggleable context layer.

## Ordered Todo List

### Phase 1: Stabilize Current Behavior

- [x] Fix admin deletion and activity counting to include parcel-authored activity. Model used: Codex `gpt-5.4-mini` worker
  Acceptance: admin list/detail responses include parcel-comment activity, frontend delete-disable logic uses it, and deleting a user with parcel comments returns `409` instead of a foreign-key failure.
- [x] Render `feedback` in `MapWorkspace`. Model used: Codex `gpt-5.4`
  Acceptance: save, comment, upload, download, and load failures are visible in the reviewer UI and feedback clears or expires consistently.
- [x] Align the `review` status model across backend and frontend. Model used: Codex `gpt-5.4`
  Acceptance: backend valid statuses, frontend `STATUS_OPTIONS`, labels, parcel badges, and seed defaults all use one canonical status policy.
- [x] Remove misleading parcel document UI until parcel-scoped documents are real. Model used: Codex `gpt-5.4`
  Acceptance: parcel detail no longer presents upload controls or copy implying parcel-scoped documents; question-area documents remain functional.
- [x] Add the smoke suite for auth, admin, question-area, and parcel flows. Model used: Codex `gpt-5.4`
  Acceptance: test script exists and covers login, admin user CRUD/deletion conflicts, question-area update/comment/upload, parcel comment, and parcel status update. It passed against the live stack on 2026-04-16.

### Phase 2: Reduce Data Drift Risk

- [x] Add seed manifest/version enforcement and an explicit reseed path. Model used: Codex `gpt-5.4`
  Acceptance: PostGIS stores the generated manifest hash/version, startup compares it, mismatches fail fast with a clear reseed/reset instruction, and docs explain the workflow.
- [x] Centralize parcel-to-question-area matching logic. Model used: Codex `gpt-5.4`
  Acceptance: dashboard, layers, parcels, and question-area routes share one matching helper/view instead of duplicating the lateral join.
- [x] Add a regression check around expected question-area source groups and counts before changing the GIS export. Model used: Codex `gpt-5.4`
  Acceptance: the export or verification path can fail when generated question-area source groups/counts drift unexpectedly.
- [x] Relax upload validation away from exact extension-plus-MIME pairing. Model used: Codex `gpt-5.4`
  Acceptance: safe extension/size rules still block risky uploads, but common browser fallbacks such as blank MIME or `application/octet-stream` are handled deliberately.

### Phase 3: Correct The Data Model

- [x] Rebuild `export_seed_data.py` so question areas come from the mismatch layers named in repo instructions. Model used: Codex `gpt-5.4`
  Acceptance: question areas are generated from `BTG_Spatial_Fix_Primary_Erase` and `BTG_Spatial_Fix_Comparison_Erase`, while `BTG_Spatial_Fix_Primary_Layer` is retained only as parcel context/enrichment.
- [ ] Regenerate seed assets and verify source-group/count expectations before reseeding. Model recommended next: Codex `gpt-5.4` or Claude Code `opusplan`
  Acceptance: a source geodatabase with `BTG_Spatial_Fix_Primary_Erase` and `BTG_Spatial_Fix_Comparison_Erase` is available, `data/generated/manifest.json` reflects mismatch-layer source groups, generated files are internally consistent, and PostGIS can be reseeded cleanly.
- [~] Update counts, roles, and runtime docs after the corrected seed model lands. Model used: Codex `gpt-5.4`; model recommended next: Claude Code `haiku`
  Acceptance: README, agent guide, and any runtime docs match the corrected source layers, counts, seeded users, and implemented role model. Pending: exact counts after regeneration.

### Phase 4: Structural Cleanup

- [x] Audit dead backend surface area and decide remove-vs-finish for `parcel_status_history`, `county_boundaries`, `parcel_points`, and unused utilities. Model: Claude Code `opus`
  Acceptance: each active dead/partial surface is either removed or wired into a real route/UI/data flow with docs updated. `parcel_points` is kept and rendered as a toggleable context layer.
- [ ] Split `MapWorkspace` into smaller units after regenerated seed assets and reseed verification pass. Model: Claude Code `opusplan`
  Acceptance: search, selection, question-area detail, parcel detail, and map layers move into focused hooks/components without changing behavior.

## Model Use Notes

Current execution default after 2026-04-16:

- Prefer Codex-only execution unless the user explicitly wants external Claude Code handoffs.
- Use at most 2-3 parallel workers, and only when write scopes do not overlap.
- Do not parallelize multiple agents into `frontend/src/components/MapWorkspace.tsx`.
- Give subagents short task briefs, not the full report, to control token budget and context rot.

- Use Codex `gpt-5.4` when a task crosses backend, frontend, tests, and operational workflow boundaries.
- Use Codex `gpt-5.3-codex` when the work is primarily a refactor of existing code rather than a product-policy decision.
- Use Codex `gpt-5.4-mini` for short, bounded fixes where speed matters more than deeper planning.
- Use Claude Code `opusplan` when the task has ambiguous structure and should be split into a plan plus an implementation pass.
- Use Claude Code `sonnet` for normal implementation work after the product direction is already clear.
- Use Claude Code `haiku` only after the underlying source-of-truth issues are resolved.

## Sources

Official sources reviewed on 2026-04-03:

- OpenAI Codex Models: https://developers.openai.com/codex/models
- OpenAI Models overview: https://developers.openai.com/api/docs/models
- Anthropic Claude Code model configuration: https://code.claude.com/docs/en/model-config
- Anthropic models overview: https://platform.claude.com/docs/en/about-claude/models/overview

Inference note:

- The Codex assignments are based on the models explicitly listed on the current Codex Models page, not every older API model page that still exists.
