# Property Tax Regrid Map Handoff

## Current Symptom

The Regrid/property-tax map feature is partially working, but the frontend can blank to a white screen while zooming in to the zoom level where the property-tax layer becomes detailed.

Observed behavior from the current browser session:

- At low zoom, orange clustered property-tax markers appear.
- At closer zoom, individual blue point markers appear for a few seconds.
- Regrid parcels and other existing overlays are visible in the same area.
- Shortly after the detailed point/Regrid layer appears, the full app view becomes a blank white screen.

This handoff is for a fresh debugging context. Do not assume the backend data load is the failing part: the backend endpoints were previously verified to return point data and Regrid parcel data.

## Files To Read First

Frontend map implementation:

- [MapWorkspace.tsx](../frontend/src/components/MapWorkspace.tsx)
- [propertyTaxMap.ts](../frontend/src/lib/propertyTaxMap.ts)
- [styles.css](../frontend/src/styles.css)
- [package.json](../frontend/package.json)
- [package-lock.json](../frontend/package-lock.json)

Backend/API implementation:

- [taxParcels.ts](../backend/src/routes/taxParcels.ts)
- [propertyTaxParcelPoints.ts](../backend/src/lib/propertyTaxParcelPoints.ts)
- [importPropertyTaxParcelPoints.ts](../backend/src/db/importPropertyTaxParcelPoints.ts)
- [schema.ts](../backend/src/lib/schema.ts)
- [startupDatabase.ts](../backend/src/lib/startupDatabase.ts)
- [config.ts](../backend/src/config.ts)
- [tax-parcels.smoke.test.ts](../backend/tests/tax-parcels.smoke.test.ts)

Runtime/config:

- [docker-compose.yml](../docker-compose.yml)
- [.env.example](../.env.example)
- Local `.env` is ignored by git and currently holds `REGRID_FEATURE_SERVICE_URL`.
- [Regridservice.txt](<../PropertyTax Map implementation/Regridservice.txt>)
- [ParcelsListingReport.xlsx](<../PropertyTax Map implementation/ParcelsListingReport.xlsx>)

## Runtime Data Flow

The source workbook is `PropertyTax Map implementation/ParcelsListingReport.xlsx`.

The import script is:

```powershell
cd backend
npm run db:import-property-tax-points
```

In Docker, run it as:

```powershell
docker compose run --rm api npm run db:import-property-tax-points
```

The import reads `PROPERTY_TAX_PARCEL_WORKBOOK_PATH`, creates/updates `property_tax_parcel_points`, and stores every spreadsheet row:

- Rows with valid `Latitude` and `Longitude` get `geom geometry(Point, 4326)`.
- Rows missing coordinates stay in the database with `geom = NULL`.
- Current import result was `4,606` rows total, `4,421` with valid point geometry, `185` missing coordinates, `0` invalid coordinates.

The backend uses `REGRID_FEATURE_SERVICE_URL` to proxy the Regrid ArcGIS FeatureServer. The frontend does not call Regrid directly.

## Backend API Surface

All endpoints below are mounted under `/api/tax-parcels` and require `property_tax:read`.

`GET /points?bbox=west,south,east,north`

- Returns GeoJSON point features from `property_tax_parcel_points`.
- Filters to `geom IS NOT NULL`.
- Uses the provided map bbox.
- Hard limit in current code is `10000`.

`GET /points/:id`

- Returns one full spreadsheet-derived feature, including `rawProperties` when available.
- Useful for detail workflows, but the current map mainly uses the collection endpoint.

`GET /regrid-parcels?bbox=west,south,east,north&zoom=12`

- Returns Regrid parcel polygons as GeoJSON.
- Calls the configured FeatureServer `/query?f=geojson`.
- Starts returning data only when `zoom >= PROPERTY_TAX_REGRID_MIN_ZOOM`, currently `12`.
- Adds `isMatched` and `matchedPointCount` by checking whether stored workbook points fall inside each Regrid polygon via PostGIS `ST_Covers`.

`POST /regrid-identify`

Body:

```json
{
  "latitude": 34.0666,
  "longitude": -91.63497
}
```

- Queries Regrid for the parcel at the clicked point.
- Uses the returned parcel polygon to find workbook points contained inside it.
- Returns `regridParcel`, `matches`, and `matchCount`.

## Frontend Workflow

The main map lives in [MapWorkspace.tsx](../frontend/src/components/MapWorkspace.tsx).

Important state:

- `mapBbox`: updated by `MapViewportWatcher` on map movement.
- `mapZoom`: updated by `MapViewportWatcher`.
- `propertyTaxLayerVisibility`: toggles `regridParcels` and `propertyTaxPoints`.
- `regridParcels`: Regrid GeoJSON returned from backend.
- `propertyTaxPoints`: spreadsheet point GeoJSON returned from backend.
- `propertyTaxMapError`: API/load error shown over the map.
- `regridIdentifyState`: selected parcel identify panel state.

Fetch behavior:

- A `useEffect` in `MapWorkspace` watches `canReadPropertyTax`, `mapBbox`, `mapZoom`, `propertyTaxLayerVisibility`, and `session.token`.
- If points are enabled, it calls `fetchPropertyTaxPoints({ bbox, token })`.
- If Regrid parcels are enabled, it calls `fetchRegridParcels({ bbox, token, zoom })`.
- `fetchRegridParcels` returns an empty collection before zoom `12`.

Rendering behavior:

- `RegridParcelLayer` renders backend-proxied Regrid polygons via React Leaflet `GeoJSON`.
- `PropertyTaxPointLayer` builds a new `Supercluster` index from `propertyTaxPoints`.
- Below zoom `12`, it renders orange `CircleMarker` clusters.
- At zoom `12+`, it renders individual blue `CircleMarker` points.
- `RegridIdentifyPanel` opens after clicking a Regrid polygon and calling `POST /regrid-identify`.

## Known Risk Areas For The White Screen

The white screen appears to happen after detailed property-tax points are rendered, so start debugging in the frontend, not the import.

Likely places to inspect first:

- `PropertyTaxPointLayer` in [MapWorkspace.tsx](../frontend/src/components/MapWorkspace.tsx): cluster-to-point transition at zoom `12`.
- `RegridParcelLayer` in [MapWorkspace.tsx](../frontend/src/components/MapWorkspace.tsx): large GeoJSON polygon rendering at the same zoom threshold.
- `fetchRegridParcels` and `fetchPropertyTaxPoints` in [propertyTaxMap.ts](../frontend/src/lib/propertyTaxMap.ts): payload shape normalization.
- CSS for `.property-tax-point-marker`, `.property-tax-cluster-marker`, `.regrid-identify-panel`, and legend swatches in [styles.css](../frontend/src/styles.css).

Specific suspicions to validate:

- A frontend runtime exception during `clusters.map(...)` when a `Supercluster` return feature is not shaped like expected.
- A Leaflet/React Leaflet render exception from a Regrid polygon geometry that is large, invalid, or not accepted by `GeoJSON`.
- Too many full polygon features being rendered at once when Regrid returns up to `1999` parcel polygons.
- Repeated `moveend` fetches causing stale layer state or an expensive render loop while zooming.
- A missing frontend error boundary makes any render exception blank the full app.

Useful first debugging step:

1. Open browser devtools console before zooming.
2. Reproduce the white screen.
3. Capture the first red JavaScript error and stack trace.
4. Check Network for `/api/tax-parcels/points` and `/api/tax-parcels/regrid-parcels`.
5. Temporarily hide `Regrid Parcels` in the legend and retest.
6. Temporarily hide `Property Tax Points` in the legend and retest.

Those last two checks should isolate whether the crash is in point rendering or polygon rendering.

## Current Setup Requirements

Required environment:

```text
PROPERTY_TAX_PARCEL_WORKBOOK_PATH=PropertyTax Map implementation/ParcelsListingReport.xlsx
REGRID_FEATURE_SERVICE_URL=<tokenized Regrid FeatureServer layer URL>
PROPERTY_TAX_REGRID_MIN_ZOOM=12
```

The local `.env` contains the real Regrid URL and is ignored by `.gitignore`.

The Docker stack expects:

```powershell
docker compose up -d --build api web
```

If the frontend dependency volume is stale, refresh dependencies inside the web container:

```powershell
docker compose exec web npm install
docker compose restart web
```

## Verification Commands

Backend build:

```powershell
cd backend
npm run build
```

Backend tests:

```powershell
cd backend
npm test
```

Frontend build:

```powershell
cd frontend
npm run build
```

Docker health:

```powershell
curl.exe -sS http://localhost:3001/api/health
curl.exe -I http://localhost:5173
```

Verify points endpoint:

```powershell
$body = @{ email = 'admin@qaviewer.local'; password = 'admin123!' } | ConvertTo-Json
$login = Invoke-RestMethod -Uri 'http://localhost:3001/api/auth/login' -Method Post -ContentType 'application/json' -Body $body
$token = $login.token
Invoke-RestMethod -Uri 'http://localhost:3001/api/tax-parcels/points?bbox=-126,24,-66,49' -Headers @{ Authorization = "Bearer $token" }
```

Verify Regrid endpoint near a known Arkansas parcel:

```powershell
$body = @{ email = 'admin@qaviewer.local'; password = 'admin123!' } | ConvertTo-Json
$login = Invoke-RestMethod -Uri 'http://localhost:3001/api/auth/login' -Method Post -ContentType 'application/json' -Body $body
$token = $login.token
Invoke-RestMethod -Uri 'http://localhost:3001/api/tax-parcels/regrid-parcels?bbox=-91.64,34.064,-91.63,34.069&zoom=14' -Headers @{ Authorization = "Bearer $token" }
```

Expected Regrid behavior:

- Returns several features.
- Some features should have `isMatched: true`.
- Matched features include `matchedPointCount`.

## Suggested Fix Direction For Next Context

Start with diagnosis, not broad refactoring.

Recommended order:

1. Reproduce in browser with devtools console open and capture the first runtime exception.
2. Toggle off `Regrid Parcels` and retest zoom.
3. Toggle off `Property Tax Points` and retest zoom.
4. Add a small map-level error boundary so future render exceptions do not blank the whole app.
5. If point rendering is the trigger, harden `PropertyTaxPointLayer` against unexpected Supercluster feature shapes and cap rendered point count by viewport.
6. If Regrid rendering is the trigger, add tighter zoom/bbox gating, simplify geometry, or render only matched polygons instead of all returned Regrid polygons.
7. Keep backend proxy/token behavior intact; do not move the Regrid URL into frontend config.

## Handoff Prompt

Use this prompt in a fresh context:

```text
QAViewer has a new Regrid/property-tax map overlay. It loads spreadsheet parcel points into PostGIS and proxies Regrid FeatureServer parcels through the backend. The feature works until zooming into detailed display, then the browser app turns white. Do not redesign the feature. Read docs/property-tax-regrid-handoff.md first, then inspect frontend/src/components/MapWorkspace.tsx and frontend/src/lib/propertyTaxMap.ts. Reproduce with devtools, isolate whether Regrid polygons or property-tax points cause the crash, add a contained fix, add an error boundary if appropriate, and verify backend/frontend builds.
```
