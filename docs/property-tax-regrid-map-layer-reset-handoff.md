# Property Tax Regrid Map Layer Reset Handoff

## Purpose

This document is the handoff for backing away from the custom Regrid GeoJSON viewport overlay and replacing it with a real map-layer integration.

The current custom approach is not the target architecture. Regrid should behave like a normal map overlay, similar to adding an ArcGIS `FeatureLayer` in ArcGIS Maps SDK. Workbook property-tax points should remain local support data backed by PostGIS. Spatial joins should happen only on explicit user interaction.

## Core Decision

Back away from the GeoJSON viewport rollup.

Do not use the custom flow where the frontend requests visible Regrid parcels from the backend, receives a GeoJSON `FeatureCollection`, and manually pushes those features into Leaflet as the parcel fabric.

GeoJSON is still acceptable for small, selected-result overlays, such as highlighting the selected Regrid parcel. It should not be the delivery mechanism for the whole parcel fabric.

## Desired Architecture

- Regrid parcel fabric is a real Leaflet map overlay backed by an ArcGIS-aware layer integration.
- Property-tax workbook points are local support data loaded from PostGIS.
- The frontend coordinates selection and identify behavior.
- Backend calls are used for local point loading and on-demand identify/join work.
- Normal pan/zoom rendering must not enrich visible Regrid parcels with workbook match counts.

Conceptual layer stack:

- Base maps: OpenStreetMap, USGS imagery.
- Regrid parcel fabric: ArcGIS FeatureServer-backed map layer, toggleable.
- Property-tax workbook points: local point markers/clusters from PostGIS, toggleable.
- Selected Regrid parcel highlight: small GeoJSON overlay above the Regrid layer.
- Matched workbook points: highlighted local points above the selected parcel.

## Preferred Implementation

Use `esri-leaflet` if the app stays on Leaflet.

Implementation direction:

1. Add `esri-leaflet` to the frontend dependencies.
2. Replace the custom `RegridServiceLayer` in `frontend/src/components/MapWorkspace.tsx`.
3. Add a new `RegridFeatureServiceLayer` component that imperatively creates and removes an `L.esri.featureLayer`.
4. Point the layer at the Regrid FeatureServer layer URL ending in `/rest/services/premium/FeatureServer/0`.
5. Wire it into the existing Leaflet pane stack, layer toggle state, and click handling.
6. Keep property-tax points loaded from `/api/tax-parcels/points?bbox=...`.
7. Keep `/api/tax-parcels/regrid-identify` for explicit identify/join behavior.

## Token Decision

The Regrid URL currently appears to be a tokenized ArcGIS FeatureServer endpoint.

Current implementation decision:

- The browser layer uses `esri-leaflet` directly when `VITE_REGRID_FEATURE_SERVICE_URL` is set.
- `VITE_REGRID_FEATURE_SERVICE_URL` is intentionally separate from the server-side `REGRID_FEATURE_SERVICE_URL` because Vite exposes `VITE_*` values to browser code.
- Only set `VITE_REGRID_FEATURE_SERVICE_URL` if the tokenized Regrid FeatureServer URL is approved for browser exposure.
- If the token must remain server-side, do not return to the viewport GeoJSON rollup.

Server-side alternatives if the token must stay private:

- Build a backend ArcGIS reverse proxy that preserves FeatureServer-compatible paths/query parameters so Esri Leaflet can behave like it is talking to a real FeatureServer, without exposing the token.
- Switch this map surface to ArcGIS Maps SDK if first-class secured FeatureLayer behavior is the better product choice.
- Ask Regrid for a browser-safe tiled `MapServer`, vector tile, WMS, WMTS, or XYZ endpoint. That would be closest to a basemap-style overlay.

## Files To Read First

Frontend:

- `frontend/src/components/MapWorkspace.tsx`
- `frontend/src/lib/propertyTaxMap.ts`
- `frontend/src/styles.css`
- `frontend/package.json`

Backend:

- `backend/src/routes/taxParcels.ts`
- `backend/src/lib/propertyTaxParcelPoints.ts`
- `backend/src/config.ts`
- `backend/tests/tax-parcels.smoke.test.ts`

Docs/config:

- `docs/property-tax-regrid-live-layer-handoff.md`
- `PropertyTax Map implementation/Regridservice.txt`
- `.env.example`
- `docker-compose.yml`

## Remove Or Stop Using

Stop using these as the normal Regrid parcel fabric renderer:

- `fetchRegridParcelFabric`
- `GET /api/tax-parcels/regrid-parcels/query`
- custom per-viewport Regrid GeoJSON loading
- custom `Invalid GeoJSON object` skip/retry paths
- map notices such as `No Regrid parcels returned for this map extent` from the custom fabric loader

The older enriched endpoint may remain temporarily for debugging, but it must not drive the visible parcel fabric:

- `GET /api/tax-parcels/regrid-parcels`

## Keep

Keep these pieces:

- `GET /api/tax-parcels/points?bbox=...`
- local property-tax point layer
- `POST /api/tax-parcels/regrid-identify`
- selected Regrid parcel highlight overlay
- identify panel
- `property_tax:read` permission gating
- PostGIS-backed point-in-polygon join for explicit identify actions

## Click Workflows

### Regrid Parcel Click

1. User clicks a parcel in the Regrid map layer.
2. The Regrid layer exposes either the clicked feature and geometry or at least the click lat/lng.
3. Frontend calls identify/join behavior.
4. If clicked feature geometry is available, use it for selected highlight.
5. Backend/PostGIS returns workbook points contained by the selected parcel.
6. Frontend highlights selected parcel and matched workbook points.
7. Identify panel shows Regrid attributes and workbook point-derived GIS attributes.

### Property-Tax Point Click

1. User clicks a local property-tax workbook point.
2. Frontend sends the point latitude/longitude to `POST /api/tax-parcels/regrid-identify`.
3. Backend identifies the containing Regrid parcel.
4. Backend runs the point-in-polygon join against `property_tax_parcel_points`.
5. Frontend highlights the selected Regrid parcel and matched workbook points.
6. Identify panel shows workbook data plus Regrid parcel attributes.

## Join Rule

Do not spatially join every visible Regrid feature during pan/zoom.

Only join on explicit interaction:

- Regrid parcel click.
- Property-tax point click.
- Future explicit identify/search commands.

Prefer PostGIS for the join because workbook points already live there and the database can handle indexed spatial operations correctly. A frontend-only join using the clicked Regrid geometry plus Turf can be considered later, but it should not be the first implementation.

## Implementation Phases

### Phase 1: Remove The Rollup Path From Normal Rendering

- Complete: the custom Regrid GeoJSON layer was removed from `MapWorkspace`.
- Complete: normal pan/zoom rendering no longer calls `fetchRegridParcelFabric` or `/api/tax-parcels/regrid-parcels/query`.
- Complete: selected parcel GeoJSON highlight remains.

### Phase 2: Add ArcGIS-Aware Layer Integration

- Complete: `esri-leaflet` is installed.
- Complete: `RegridFeatureServiceLayer` creates the FeatureServer layer imperatively.
- Complete: the FeatureServer layer uses the existing `regrid-parcels` pane/z-index and layer toggle.

### Phase 3: Wire Interaction

- Complete: parcel clicks call existing identify/join behavior.
- Complete: clicked Regrid feature geometry is used as highlight fallback when available.
- Complete: property-tax point click identify is preserved.

### Phase 4: Backend Cleanup

- Keep `POST /api/tax-parcels/regrid-identify`.
- Keep `GET /api/tax-parcels/points`.
- Stop treating `GET /api/tax-parcels/regrid-parcels/query` as a product path.
- Decide whether to delete, rename, or mark old Regrid GeoJSON endpoints as debug-only.

### Phase 5: Documentation And Verification

- Update `docs/property-tax-regrid-live-layer-handoff.md` or supersede it with this reset document.
- Document whether the Regrid token is browser-safe.
- Run builds and targeted tests.
- Verify Regrid appears as a normal map overlay.

## Verification Checklist

- Regrid layer toggles on/off as a map overlay.
- Panning and zooming do not call the custom `/regrid-parcels/query` endpoint.
- Property-tax points still load from PostGIS.
- Clicking a property-tax point identifies and highlights the containing Regrid parcel.
- Clicking a Regrid parcel shows workbook point matches.
- Normal Regrid rendering does not show `Invalid GeoJSON object`.
- Normal Regrid rendering does not show `No Regrid parcels returned for this map extent` from custom rollup code.
- Backend token handling is explicitly documented.

## Recommended Handoff Prompt

```text
QAViewer needs to back away from the custom Regrid GeoJSON viewport overlay. Read docs/property-tax-regrid-map-layer-reset-handoff.md first.

The desired behavior is for Regrid to be a real map layer in the Leaflet map, not a backend-proxied viewport GeoJSON rollup. Use an ArcGIS-aware map layer integration such as esri-leaflet FeatureLayer if the tokenized Regrid FeatureServer URL can be exposed to the browser. If the token must stay server-side, do not return to the GeoJSON rollup; build a FeatureServer-compatible backend proxy or consider ArcGIS Maps SDK.

Keep property-tax workbook points as local PostGIS-backed support data. Keep joins on explicit user interaction only. Do not enrich every visible Regrid feature during pan/zoom. Preserve selected parcel highlight and identify panel behavior.

Build and test both apps, update docs, and verify the map no longer calls /api/tax-parcels/regrid-parcels/query for normal Regrid fabric rendering.
```

## References

- Esri Leaflet FeatureLayer: https://developers.arcgis.com/esri-leaflet/api-reference/esri-leaflet/feature-layer/
- Esri Leaflet layer types: https://esri.github.io/esri-leaflet/tutorials/introduction-to-layer-types.html
- ArcGIS Feature Service query operation: https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/
