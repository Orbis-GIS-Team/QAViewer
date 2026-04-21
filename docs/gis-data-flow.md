# How QAViewer Uses PostGIS

> Archived note: this document describes the retired parcel-centered runtime model. It is kept for historical reference only and should not be treated as the active architecture after the NNC cutover. Use `docs/dataset-contract.md`, `docs/nnc-cutover-plan.md`, `README.md`, and `AGENTS.md` for current behavior.

This document focuses on how the app works with PostGIS at runtime.

Short version:

- PostGIS stores the map geometries and related GIS attributes.
- The Express API queries PostGIS for the current map extent.
- PostGIS sends geometry back as GeoJSON.
- React Leaflet renders that GeoJSON in the browser.

The browser never talks to PostGIS directly. All database access goes through the backend API.

## 1. What PostGIS is doing in this app

QAViewer uses PostGIS for four main jobs:

1. Store geometry in typed spatial columns.
2. Filter map data by the current viewport.
3. Convert database geometry into GeoJSON for the frontend.
4. Speed up map queries with spatial indexes.

It is not currently being used as a live GIS analysis engine. The app is not doing runtime overlay analysis, polygon clipping, or spatial joins between question areas and parcels.

## 2. The main runtime flow

The runtime loop looks like this:

1. Leaflet tracks the current visible map bounds in the browser.
2. The frontend sends that bounding box to the API.
3. The API runs SQL against PostGIS using the geometry columns.
4. PostGIS filters the rows and returns geometry as GeoJSON.
5. The frontend renders the results as Leaflet layers and markers.

In other words, PostGIS is the spatial backend for the review screen.

## 3. Which tables PostGIS is serving

The main spatial tables are:

| Table | Geometry column | Purpose in the app |
|---|---|---|
| `question_areas` | `geom geometry(MultiPolygon, 4326)` | Main review items |
| `question_areas` | `centroid geometry(Point, 4326)` | Marker placement for question areas |
| `parcel_features` | `geom geometry(MultiPolygon, 4326)` | Parcel polygons |
| `parcel_points` | `geom geometry(Point, 4326)` | Toggleable parcel point context layer |
| `management_tracts` | `geom geometry(MultiPolygon, 4326)` | Management overlay |

These columns are defined in:

- `backend/src/lib/schema.ts`

All runtime geometry is stored in EPSG:4326, which keeps the API and Leaflet on the same coordinate system.

## 4. How the frontend drives PostGIS queries

The map screen is in:

- `frontend/src/components/MapWorkspace.tsx`

Leaflet reports the visible map bounds through `MapViewportWatcher`, which calls:

- `map.getBounds().toBBoxString()`

That produces a string like:

```text
west,south,east,north
```

The frontend then uses that bbox in API requests such as:

- `GET /api/question-areas?bbox=...`
- `GET /api/layers/primary_parcels?bbox=...`
- `GET /api/layers/parcel_points?bbox=...`
- `GET /api/layers/management_tracts?bbox=...`

So the map is not loading all GIS data at once and filtering in the browser. It is asking PostGIS for only the features that intersect the current view.

## 5. The core spatial query pattern

The most important PostGIS pattern in the app is the bbox filter.

The backend turns the incoming bbox string into SQL using:

```sql
geom && ST_MakeEnvelope(west, south, east, north, 4326)
```

What this means:

- `ST_MakeEnvelope(...)` creates a rectangle from the current map bounds.
- `&&` checks whether a feature's bounding box overlaps that rectangle.
- Because the geometry columns have GiST indexes, this is fast enough for map panning and zooming.

This pattern is used in:

- `backend/src/routes/questionAreas.ts`
- `backend/src/routes/layers.ts`

Important nuance:

- The app is currently using bbox intersection, not exact `ST_Intersects(...)`.
- That is a practical map-serving choice and usually faster.
- It means PostGIS is being used more like a spatial filter than a full analysis engine.

## 6. How geometry gets from PostGIS to Leaflet

The backend does not send raw PostGIS geometry objects to the browser.

Instead, the API converts them in SQL with:

```sql
ST_AsGeoJSON(geom, 5)::jsonb
```

and, for question-area markers:

```sql
ST_AsGeoJSON(centroid, 5)::jsonb
```

That matters because Leaflet already knows how to render GeoJSON directly.

So the response chain is:

PostGIS geometry -> `ST_AsGeoJSON(...)` -> JSON API response -> React Leaflet `GeoJSON` / `Marker`

This is why the frontend stays simple. It does not need custom geometry decoding logic.

## 7. How question areas work with PostGIS

Question areas are the main spatial records in the app.

At runtime, PostGIS is used for three things on this table:

1. Filtering question areas to the visible map extent.
2. Returning the polygon geometry for selection/focus.
3. Returning the stored centroid point for marker placement.

The list endpoint:

- `GET /api/question-areas`

returns a GeoJSON feature collection where each feature includes:

- polygon geometry from `question_areas.geom`
- marker point in `properties.centroid`
- review metadata like status, severity, title, parcel identifiers

The detail endpoint:

- `GET /api/question-areas/:code`

returns the full polygon and centroid for one record plus comments and documents.

The centroid is stored in the database rather than recomputed during every map request, which keeps the runtime query simpler.

## 8. How parcel layers work with PostGIS

Parcel polygons come from the `parcel_features` table and management overlays come from `management_tracts`.

The layer endpoint:

- `GET /api/layers/:layerKey`

uses PostGIS to:

1. filter by bbox
2. serialize geometry to GeoJSON
3. return the original GIS attributes from `raw_properties`

For `primary_parcels`, the backend also enriches each parcel with a `questionAreaCode` when it can find a related question area.

That means a parcel coming out of PostGIS is not just geometry. It is geometry plus enough business context for the UI to know whether clicking it should open a question area.

## 9. How question areas are linked to parcels

This is one of the most important runtime design choices:

- question areas and parcels are not linked by spatial intersection
- they are linked by business keys

The backend uses a `LEFT JOIN LATERAL` query that tries to match:

- `question_areas.primary_parcel_number` to `parcel_features.parcel_number`
- or `question_areas.primary_parcel_code` to `parcel_features.ptv_parcel`
- with county/state checks to make the match safer

That pattern appears in:

- `backend/src/routes/questionAreas.ts`
- `backend/src/routes/layers.ts`
- `backend/src/routes/parcels.ts`
- `backend/src/routes/dashboard.ts`

So even though this is a GIS app, the main parcel-to-question-area relationship is attribute-based, not geometry-based.

## 10. How PostGIS helps the map feel responsive

The schema adds GiST indexes on the geometry columns:

- `question_areas.geom`
- `question_areas.centroid`
- `parcel_features.geom`
- `parcel_points.geom`
- `management_tracts.geom`

These indexes are what make bbox filtering practical when the user pans and zooms.

There are also non-spatial indexes used by the app:

- B-tree indexes for workflow/status fields
- trigram (`pg_trgm`) indexes for question-area text search fields

That means the app combines:

- spatial indexing for map requests
- text indexing for search and lookup

## 11. What PostGIS is not doing right now

The current app is not using PostGIS for:

- live topology or overlay analysis
- parcel/question-area matching by `ST_Intersects`
- tile generation
- vector tile serving
- geometry editing in the browser
- geofencing or nearest-neighbor search

PostGIS is still central, but its current role is mostly:

- authoritative geometry storage
- spatial windowing
- GeoJSON output

## 12. What happens when a user clicks something

### Clicking a question-area marker

1. The frontend already has the marker location from the centroid returned by PostGIS.
2. It requests `GET /api/question-areas/:code`.
3. The backend fetches the record from PostGIS and returns full geometry plus related metadata.
4. Leaflet zooms to that geometry.

### Clicking a parcel polygon

1. The parcel polygon came from `parcel_features.geom` through `/api/layers/primary_parcels`.
2. The frontend requests `GET /api/parcels/:id`.
3. The backend returns the parcel geometry and attributes.
4. If the parcel has a linked `questionAreaCode`, the UI pivots into the question-area workflow.

## 13. The most accurate mental model

If you want the cleanest way to think about the architecture, it is this:

- Leaflet is the renderer.
- Express is the translator.
- PostGIS is the spatial source behind the translator.

The app asks PostGIS:

- "Which features are in this map window?"
- "Give me that geometry as GeoJSON."
- "What non-spatial metadata goes with it?"
- "Which parcel/question-area record is related to this one?"

That is the main way QAViewer is "working with PostGIS" today.

## 14. Small note on ingest

The GIS data still arrives in PostGIS from generated GeoJSON seed files, but that is an upstream concern. Once the app is running, the important thing is that all map and detail behavior is driven from the PostGIS tables above, not from the `.gdb` files or the generated GeoJSON files directly.
