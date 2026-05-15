# Property Tax Regrid Live Layer Handoff

## Purpose

This document supersedes the earlier crash-focused Regrid handoff for the next implementation context.

The desired behavior is not just "fetch Regrid parcels as a GeoJSON overlay." The desired behavior is:

- Regrid parcel fabric behaves like a real map layer in the application.
- Workbook property-tax points remain local GIS/support data.
- Selecting a workbook point identifies the containing Regrid parcel and highlights that parcel.
- Clicking a Regrid parcel identifies workbook point records contained by that parcel and shows those point-derived GIS attributes.
- Whole-viewport Regrid parcel rendering should not be coupled to point-match enrichment.

## Current Misalignment

The current implementation made Regrid parcels a backend-fetched GeoJSON overlay:

- Frontend calls `fetchRegridParcels({ bbox, zoom })`.
- Backend calls the Regrid ArcGIS FeatureServer `/query?f=geojson`.
- Backend enriches every returned Regrid feature with `isMatched` and `matchedPointCount`.
- Frontend renders the returned viewport feature collection with React Leaflet `<GeoJSON>`.
- A separate point layer renders workbook points as clusters/markers.

That is useful for proof-of-concept debugging, but it is not the requested model. It makes the visible parcel fabric depend on custom bbox fetch state, backend result caps, and per-feature join work. It also means Regrid is not really a Leaflet layer in the layer stack; it is a manually managed GeoJSON result.

## Current Regrid Service

Local reference:

- `PropertyTax Map implementation/Regridservice.txt`

The currently supplied URL is an ArcGIS FeatureServer layer endpoint ending in:

```text
/rest/services/premium/FeatureServer/0
```

This is not a standard XYZ tile URL. Do not plug it into Leaflet `TileLayer` directly.

Possible layer strategies:

1. Use `esri-leaflet` `featureLayer` against the Regrid FeatureServer URL.
2. Use a Regrid-provided tiled `MapServer`, vector tile, WMS, or XYZ endpoint if available.
3. Build a custom Leaflet layer that queries the FeatureServer by tile/bounds.

Preferred first implementation:

- Use `esri-leaflet` or a small equivalent Leaflet integration for the Regrid FeatureServer.
- Keep the Regrid token URL out of frontend config unless the token is approved for browser exposure.
- If the Regrid token must stay server-side, add a backend proxy strategy before implementing direct browser layer access.

## Target Architecture

## Current Implementation Status

Current implementation:

- Regrid parcel fabric is rendered as a real Leaflet overlay through `esri-leaflet` `FeatureLayer`, configured by `VITE_REGRID_FEATURE_SERVICE_URL`.
- `MapWorkspace` no longer requests `/api/tax-parcels/regrid-parcels/query` on pan or zoom for normal parcel fabric rendering.
- The backend `GET /api/tax-parcels/regrid-parcels` and `GET /api/tax-parcels/regrid-parcels/query` endpoints remain as debug compatibility GeoJSON paths only.
- `POST /api/tax-parcels/regrid-identify` remains the on-demand point-in-polygon join path and returns `joinMethod` plus an explicit `message`.
- Workbook property-tax point clicks call identify, highlight the containing Regrid parcel, and highlight workbook point matches.
- Selected Regrid parcel geometry is rendered as a small GeoJSON highlight above the live fabric layer.

Important caveat:

- `VITE_REGRID_FEATURE_SERVICE_URL` is browser-visible by design. Only set it to a Regrid FeatureServer URL if the tokenized URL is approved for browser exposure. If the token must remain private, keep this variable unset and implement a FeatureServer-compatible backend proxy or switch to a first-class secured ArcGIS layer approach rather than restoring the viewport GeoJSON rollup.

### Visual Layer Stack

The map should have these conceptual layers:

- Base maps: OpenStreetMap, USGS imagery.
- Regrid parcel fabric: live Regrid service layer, toggleable in Leaflet layer control.
- Workbook property-tax points: local point markers/clusters, optional and toggleable.
- Selected Regrid parcel highlight: one selected parcel geometry rendered as GeoJSON above the live Regrid layer.
- Matched workbook point highlight: selected point or contained points rendered above the parcel highlight.

The Regrid parcel fabric should not require fetching and storing every visible parcel in React state just to show the layer.

### Data Flow

Use Regrid service rendering for the parcel fabric.

Use backend API calls only for:

- workbook point collection within viewport,
- identifying the Regrid parcel at a clicked point,
- joining a selected Regrid parcel to workbook points,
- returning selected parcel geometry for highlight.

Do not enrich every visible Regrid feature with workbook match counts during normal pan/zoom. That turns every map movement into an expensive spatial join.

### Click Workflows

Workbook point click:

1. User clicks a property-tax point marker.
2. Frontend calls backend identify with the point latitude/longitude.
3. Backend queries Regrid at that coordinate.
4. Backend finds workbook point rows contained by the returned Regrid parcel geometry.
5. Frontend stores the selected Regrid parcel id/geometry and matched workbook rows.
6. Frontend highlights the returned Regrid parcel geometry and opens the identify panel.

Regrid parcel click:

1. User clicks a parcel in the live Regrid layer.
2. Frontend receives the clicked Regrid feature if the layer library exposes it, or sends click lat/lng to backend.
3. Backend identifies the parcel from Regrid and spatially joins workbook points contained by that parcel.
4. Frontend highlights the selected parcel and shows workbook point GIS data plus Regrid parcel attributes.

## Recommended Implementation Plan

### Phase 1: Confirm Service Capability

Check what Regrid actually provides for this account/service:

- FeatureServer layer URL: already confirmed.
- MapServer or tiled endpoint: unknown.
- Vector tile endpoint: unknown.
- WMS endpoint: unknown.
- Browser CORS support for the configured FeatureServer URL: verify with the selected Regrid URL.
- Whether the tokenized URL may be exposed to browser clients: still requires an operator/client decision before setting `VITE_REGRID_FEATURE_SERVICE_URL`.

Outcome of this phase is currently:

- Direct browser feature layer with `esri-leaflet` when `VITE_REGRID_FEATURE_SERVICE_URL` is configured.
- Backend-proxied FeatureServer-compatible adapter, ArcGIS secured layer handling, or a different Regrid tile/vector endpoint remains the next step if the token cannot be exposed.

### Phase 2: Split Rendering From Joining

Backend:

- Keep `/api/tax-parcels/points?bbox=...` for workbook point display.
- Keep or replace `/api/tax-parcels/regrid-identify` as the on-demand join endpoint.
- Stop using `/api/tax-parcels/regrid-parcels` as the normal parcel fabric rendering path.
- Consider renaming the current endpoint to make its role explicit if retained, such as `/regrid-parcels/query` or `/regrid-parcels/enriched`.

Frontend:

- Add a dedicated `RegridFeatureServiceLayer` component.
- Render that component in the Leaflet layer stack as an overlay.
- Remove whole-viewport `regridParcels` state from normal map render flow.
- Keep GeoJSON rendering only for selected/highlighted parcel geometry.

### Phase 3: Add Stable Selection State

Replace `activeLatlng`-based parcel selection with explicit selected parcel state:

```ts
type SelectedRegridParcel = {
  parcelId: string | null;
  geometry: Geometry;
  properties: RegridParcelProperties;
  matches: PropertyTaxParcelPointDetail[];
  selectedFrom: "regrid-parcel" | "property-tax-point";
};
```

Use this state to drive:

- selected parcel highlight,
- identify panel content,
- selected/matched point styling.

### Phase 4: On-Demand Join API

Backend should expose a deliberate identify/join contract:

`POST /api/tax-parcels/regrid-identify`

Input options:

```json
{
  "latitude": 34.0666,
  "longitude": -91.63497
}
```

Optional future input if the live layer exposes feature geometry:

```json
{
  "regridFeature": {
    "type": "Feature",
    "geometry": {},
    "properties": {}
  }
}
```

Response should be explicit:

```json
{
  "clicked": { "latitude": 34.0666, "longitude": -91.63497 },
  "regridParcel": {},
  "matches": [],
  "matchCount": 0,
  "joinMethod": "point-in-polygon",
  "message": null
}
```

Keep the spatial join in PostGIS for correctness and performance. Frontend-only spatial joins can be considered later with Turf, but PostGIS is already present and indexed.

### Phase 5: Frontend Components

Recommended file split:

- `frontend/src/components/RegridFeatureServiceLayer.tsx`
- `frontend/src/components/SelectedRegridParcelOverlay.tsx`
- `frontend/src/components/PropertyTaxPointLayer.tsx`
- `frontend/src/components/RegridIdentifyPanel.tsx`
- `frontend/src/lib/propertyTaxMap.ts`

Keep `MapWorkspace.tsx` responsible for orchestration only:

- map viewport state,
- layer visibility,
- selected parcel state,
- handlers that call API helpers.

### Phase 6: Tests And Verification

Backend tests:

- below-min-zoom behavior if old query endpoint remains,
- invalid bbox and invalid zoom,
- missing Regrid URL,
- Regrid upstream error,
- identify by lat/lng,
- identify returns multiple workbook matches,
- identify returns zero workbook matches.

Frontend verification:

- Regrid service layer can be toggled on/off.
- Regrid service layer remains visible while panning/zooming.
- Workbook point click highlights containing Regrid parcel.
- Regrid parcel click opens identify panel with workbook point attributes.
- App does not blank if Regrid service fails.

Manual checks:

```powershell
cd backend
npm run build
npm test
```

```powershell
cd frontend
npm run build
```

```powershell
docker compose up -d --build api web
curl.exe -sS http://localhost:3001/api/health
curl.exe -I http://localhost:5173
```

## Files To Read First In Next Context

Frontend:

- `frontend/src/components/MapWorkspace.tsx`
- `frontend/src/lib/propertyTaxMap.ts`
- `frontend/src/styles.css`
- `frontend/package.json`

Backend:

- `backend/src/routes/taxParcels.ts`
- `backend/src/lib/propertyTaxParcelPoints.ts`
- `backend/src/lib/schema.ts`
- `backend/src/config.ts`
- `backend/tests/tax-parcels.smoke.test.ts`

Runtime/config:

- `docker-compose.yml`
- `.env.example`
- `PropertyTax Map implementation/Regridservice.txt`
- `PropertyTax Map implementation/ParcelsListingReport.xlsx`

## Implementation Notes

- Do not move the Regrid tokenized URL into frontend config until token exposure is approved.
- Do not use the current whole-viewport enriched GeoJSON endpoint as the long-term parcel fabric renderer.
- Do not require Regrid config during API startup validation unless the product decides property-tax/Regrid is mandatory.
- Keep workbook import explicit and outside API startup.
- Keep browser-to-PostGIS access behind the API.

## Handoff Prompt

Use this prompt in a fresh context:

```text
QAViewer's current Regrid/property-tax implementation fetches Regrid parcels as backend-proxied GeoJSON and renders that FeatureCollection as a React Leaflet GeoJSON overlay. That is not the desired architecture. Read docs/property-tax-regrid-live-layer-handoff.md first. The desired behavior is for Regrid to be a real live map layer in the Leaflet map, while workbook property-tax points are local support data used for on-demand spatial joins. Implement a dedicated Regrid service layer if the supplied FeatureServer URL can support browser/service-layer rendering, otherwise add the needed backend proxy layer. Keep whole-viewport GeoJSON only out of the normal parcel fabric path; use GeoJSON for selected parcel highlight and identify results. Selecting a workbook point should identify/highlight the containing Regrid parcel. Clicking a Regrid parcel should show workbook point GIS data joined to that parcel. Preserve backend token safety, build/test both apps, and update docs/tests for the final chosen service-layer approach.
```
