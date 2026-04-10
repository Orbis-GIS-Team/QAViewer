# QAViewer Stabilization Model Assignment Todo

Date: 2026-04-03

Input report: `code_review_stabilization_report_2026-04-03.md`

Purpose:

- Turn the stabilization report into an executable todo list.
- Assign each reported item to one primary model in Codex or Claude Code.
- Base model selection on the current official model docs as of 2026-04-03.

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

- [ ] Finding 1: Rewrite question-area generation to use the mismatch layers instead of `BTG_Spatial_Fix_Primary_Layer`.
  Primary model: Claude Code `opusplan`
  Why: This is the largest domain-correctness issue and needs both planning and implementation across the GIS export path.

- [ ] Finding 2: Add manifest-hash or seed-version enforcement so regenerated GIS assets cannot be silently ignored.
  Primary model: Codex `gpt-5.4`
  Why: This is a cross-cutting backend and workflow change with failure-mode design and reseed UX implications.

### High

- [ ] Finding 3: Count `parcel_comments` in admin activity queries and block deletion with a controlled conflict response.
  Primary model: Claude Code `sonnet`
  Why: This is a bounded backend correctness fix with schema-awareness but limited blast radius.

- [ ] Finding 4: Align the `review` workflow state across backend enums, frontend controls, labels, and parcel visibility rules.
  Primary model: Codex `gpt-5.4`
  Why: This spans backend persistence and frontend behavior, so it benefits from a stronger cross-layer model.

- [ ] Finding 5: Render `feedback` in `MapWorkspace` and make existing save/error state visible to users.
  Primary model: Codex `gpt-5.4-mini`
  Why: This is a focused UI fix with clear scope and low architecture risk.

### Medium

- [ ] Finding 6: Extract parcel-to-question-area matching into one reusable backend helper or SQL view.
  Primary model: Codex `gpt-5.3-codex`
  Why: This is the cleanest candidate for a deeper multi-file engineering refactor.

- [ ] Finding 7: Remove misleading parcel-document controls until true parcel-scoped documents exist.
  Primary model: Claude Code `sonnet`
  Why: This is moderate frontend/backend cleanup with a straightforward product direction.

- [ ] Finding 8: Split `MapWorkspace` into smaller hooks/components and replace overlapping selection state with one discriminated model.
  Primary model: Claude Code `opusplan`
  Why: This is a large UI refactor that should be planned before code is moved.

- [ ] Finding 9: Add a minimal smoke suite for login, admin CRUD, question-area flows, and parcel flows.
  Primary model: Codex `gpt-5.4`
  Why: This is multi-flow test design work that benefits from stronger reasoning across the stack.

- [ ] Finding 10: Relax upload validation so legitimate browser uploads are not rejected on exact MIME mismatches alone.
  Primary model: Codex `gpt-5.4-mini`
  Why: This is a small backend rule change with clear acceptance criteria.

### Low / Structural

- [ ] Finding 11: Reconcile repo docs and runtime docs after the seed model is corrected.
  Primary model: Claude Code `haiku`
  Why: This is mostly documentation and inventory cleanup once the underlying facts are stable.

- [ ] Finding 12: Audit dead or partially implemented backend surface area and either remove it or finish wiring it.
  Primary model: Claude Code `opus`
  Why: This requires deliberate scope decisions before touching schema, routes, and dead assets.

## Ordered Todo List

### Phase 1: Safety Net And User-Visible Correctness

- [ ] Add the smoke suite for auth, admin, question-area, and parcel flows. Model: Codex `gpt-5.4`
- [ ] Fix admin deletion and activity counting to include parcel-authored activity. Model: Claude Code `sonnet`
- [ ] Render `feedback` in `MapWorkspace`. Model: Codex `gpt-5.4-mini`
- [ ] Align the `review` status model across backend and frontend. Model: Codex `gpt-5.4`
- [ ] Remove misleading parcel document UI until parcel-scoped documents are real. Model: Claude Code `sonnet`

### Phase 2: Reduce Drift And Repetition

- [ ] Centralize parcel-to-question-area matching logic. Model: Codex `gpt-5.3-codex`
- [ ] Add seed manifest/version enforcement and an explicit reseed path. Model: Codex `gpt-5.4`
- [ ] Relax upload validation away from exact extension-plus-MIME pairing. Model: Codex `gpt-5.4-mini`

### Phase 3: Correct The Data Model

- [ ] Rebuild `export_seed_data.py` so question areas come from the mismatch layers named in repo instructions. Model: Claude Code `opusplan`
- [ ] Regenerate seed assets and verify source-group/count expectations before reseeding. Model: Claude Code `opusplan`
- [ ] Update counts, roles, and runtime docs after the corrected seed model lands. Model: Claude Code `haiku`

### Phase 4: Structural Cleanup

- [ ] Audit dead backend surface area and decide remove-vs-finish for `parcel_status_history`, `county_boundaries`, `parcel_points`, and unused utilities. Model: Claude Code `opus`
- [ ] Split `MapWorkspace` into smaller units once the smoke suite exists. Model: Claude Code `opusplan`

## Model Use Notes

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
