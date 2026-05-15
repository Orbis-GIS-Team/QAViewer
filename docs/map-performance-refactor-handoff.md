# QAViewer Map Performance Refactor Handoff

## Purpose

This document is the handoff for refactoring the QAViewer map so Regrid parcels,
property-tax points, question areas, land records, and management areas can be
used together without freezing the browser during pan and zoom.

Current observed behavior:

- Regrid tax parcels now render on the map.
- Property-tax workbook points also render.
- When zooming into parcel-heavy areas, the map freezes after showing the data
  briefly.

Chosen direction:

- Perform a deep mapping-side refactor.
- Keep the current Leaflet/React app shell.
- Use zoom-gated detail so dense parcel fabric is smooth first, and rich parcel
  detail appears on click/selection instead of as always-on hover UI.

## Current Risk Summary

The freeze is most likely caused by several costs stacking together:

- Regrid parcel fabric is rendered as many browser vector polygon paths through
  `esri-leaflet`.
- The current Regrid FeatureLayer requests `fields: ["*"]`, pulling all Regrid
  attributes even though labels/identify only need a small subset.
- Regrid polygon geometry is not simplified and uses high coordinate precision.
- Every Regrid polygon currently gets a sticky tooltip when created.
- High-volume map SVG features use CSS drop shadows, which are expensive during
  pan/zoom repaint.
- Property-tax point clustering rebuilds the `Supercluster` index on every
  bbox/zoom change.
- Top-level `MapWorkspace` viewport state changes fan out into broad React
  re-renders after each pan/zoom.
- Property-tax point fetches are tied directly to bbox changes and do not abort
  stale requests.

The local property-tax point count is modest, around 4,600 points, so the biggest
problem is not raw point volume alone. The heavier pressure is dense Regrid
parcel polygons plus React/SVG churn.

## Key Implementation Changes

### Regrid Parcel Layer

Refactor the Regrid layer into a dedicated performance-oriented controller.

Initial target can remain `esri-leaflet`, but it must be tuned defensively:

- Request only needed fields:
  - `id`
  - `parcelnumb`
  - `account_number`
  - `ll_uuid`
  - `owner`
  - `address`
- Add geometry/load controls:
  - `precision`
  - `simplifyFactor`
  - `updateWhenIdle`
  - `updateInterval`
  - `keepBuffer`
  - `cacheLayers: false`
  - `minZoom`
- Keep `fetchAllFeatures` disabled.
- Remove per-feature sticky tooltip binding.
- Keep click identify behavior.
- Add handling for useful events:
  - `loading`
  - `load`
  - `requesterror`
  - `drawlimitexceeded`

Regrid should not draw as full detail at every zoom. Below the configured parcel
detail zoom, it should not render the parcel fabric. At browsing zoom, it should
render simplified parcel boundaries. Full rich detail belongs in the identify
panel after an explicit click.

### Selected Parcel Detail

Keep selected Regrid parcel highlight as a small GeoJSON overlay above the parcel
fabric.

Click flow should remain:

1. User clicks Regrid parcel layer or property-tax point.
2. Frontend calls `POST /api/tax-parcels/regrid-identify`.
3. Backend identifies the containing Regrid parcel and performs the workbook
   point-in-polygon join.
4. Frontend highlights only the selected parcel and matched points.
5. Identify panel shows Regrid attributes and workbook point-derived attributes.

Do not spatially join or enrich every visible Regrid parcel during normal pan or
zoom.

### Property-Tax Points

Move property-tax points away from a large React marker loop.

Target behavior:

- Use an imperative canvas-backed point/cluster layer.
- Build the `Supercluster` index once per point dataset.
- Query clusters by bbox/zoom without rebuilding the index.
- Keep selected and matched points as a lightweight overlay above the base point
  layer.
- Avoid rendering hundreds or thousands of React Leaflet `CircleMarker`
  components with tooltips.

If a full canvas point layer is too large for the first implementation pass,
perform the minimum safe split first:

- Memoize the `Supercluster` index by `data` only.
- Query clusters separately when bbox/zoom changes.
- Lower the detailed React marker cap.
- Remove point and cluster CSS filters.

### Viewport And Fetch Churn

Reduce map-wide React churn from viewport changes.

Required changes:

- Dedupe viewport updates so unchanged bbox/zoom does not update state.
- Debounce viewport-dependent fetches until the map has settled.
- Add `AbortController` support to map data requests.
- Keep high-frequency layer state inside map-layer controllers instead of
  forcing the entire `MapWorkspace` to re-render on every pan/zoom.

Property-tax points should continue to load from:

```text
GET /api/tax-parcels/points?bbox=...
```

but stale requests should be aborted when the viewport changes before completion.

### Styling

Remove expensive high-volume visual effects from map features.

Specifically:

- Remove `filter: drop-shadow(...)` from Regrid parcel paths.
- Remove `filter: drop-shadow(...)` from property-tax point and cluster marker
  classes.
- Keep simple stroke/fill styling for mass-rendered geometry.
- Preserve stronger styling only for selected/highlighted parcel and matched
  point overlays.

## Interfaces And Compatibility

No backend schema change is expected.

Keep these product API contracts unchanged:

```text
GET /api/tax-parcels/points?bbox=...
POST /api/tax-parcels/regrid-identify
```

Frontend helper changes:

- Add optional `AbortSignal` support to the API helpers used by map-layer data
  fetches.
- Add shared viewport utilities for:
  - bbox parsing
  - bbox equality checks
  - debounce timing
  - zoom gates

Suggested frontend structure:

- Keep `MapWorkspace` responsible for orchestration:
  - layer toggles
  - selected question area
  - selected Regrid parcel
  - identify panel state
  - permissions
- Move heavy map rendering into focused layer/controller components:
  - Regrid parcel controller
  - property-tax point controller
  - selected parcel overlay
  - matched point overlay

## Files To Read First

Frontend:

- `frontend/src/components/MapWorkspace.tsx`
- `frontend/src/lib/propertyTaxMap.ts`
- `frontend/src/styles.css`
- `frontend/src/types/esri-leaflet.d.ts`
- `frontend/package.json`

Backend:

- `backend/src/routes/taxParcels.ts`
- `backend/src/lib/propertyTaxParcelPoints.ts`
- `backend/tests/tax-parcels.smoke.test.ts`

Docs/config:

- `docs/property-tax-regrid-map-layer-reset-handoff.md`
- `docs/property-tax-regrid-live-layer-handoff.md`
- `.env.example`
- `docker-compose.yml`

## Test Plan

Build and automated checks:

```bash
cd frontend && npm run build
cd backend && npm run build
cd backend && npx vitest run tests/tax-parcels.smoke.test.ts
```

Manual acceptance checks:

- Regrid layer toggles on/off without freezing the map.
- Zooming into parcel-heavy areas remains responsive.
- Regrid parcel fabric does not render below the configured parcel detail zoom.
- Simplified Regrid parcel boundaries render at browsing zoom.
- Clicking a Regrid parcel still opens identify results and highlights the
  selected parcel.
- Clicking a property-tax point still identifies the containing Regrid parcel.
- Matched workbook points still highlight above the selected parcel.
- Property-tax points remain visible and clustered appropriately.
- QA markers, land records, management areas, basemap switching, and measurement
  tools still function.
- Browser console and Vite logs show no repeated Regrid request errors during
  normal use.

Performance acceptance checks:

- No sticky tooltip is bound for every Regrid feature.
- High-volume layers do not rely on thousands of React-rendered SVG markers.
- `Supercluster` index is not rebuilt on every bbox/zoom change.
- Stale property-tax point requests are aborted.
- CSS filters are not applied to high-volume map feature classes.

## Assumptions

- The current browser-visible Regrid FeatureServer URL remains acceptable for
  local/dev browser exposure.
- The first refactor pass keeps Leaflet and Esri Leaflet.
- If tuned Esri FeatureLayer rendering is still not smooth enough, the next
  step is to request or proxy a tiled/vector Regrid endpoint and use that as the
  parcel fabric renderer.
- Rich parcel detail moves from always-on hover/tooltips to explicit
  click/selection.

## Recommended Fresh-Context Prompt

```text
QAViewer needs a map performance refactor. Read docs/map-performance-refactor-handoff.md first.

The current map can show Regrid parcels and property-tax points, but it freezes
when zooming into dense parcel areas. Implement the handoff plan: tune the
Regrid layer, remove per-feature tooltips and expensive map CSS filters, reduce
React viewport churn, abort stale map requests, and refactor property-tax point
rendering/clustering so the map remains smooth.

Keep the existing backend product API contracts:
GET /api/tax-parcels/points?bbox=...
POST /api/tax-parcels/regrid-identify

Build and test both apps, then refresh Docker and verify the map no longer
freezes during normal pan/zoom with Regrid parcels and property-tax points
enabled.
```
