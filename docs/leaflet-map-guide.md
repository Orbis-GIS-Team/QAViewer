# Leaflet Map Guide — QAViewer

This document explains how Leaflet works in general, and specifically how it is being used in this project. It is intended as a reference for making symbology and configuration changes to the map.

---

## What is Leaflet?

[Leaflet](https://leafletjs.com/) is the most widely used open-source JavaScript library for interactive maps. It is lightweight, fast, and has a very large ecosystem of plugins.

At its core, Leaflet gives you:

- A **map container** — a `<div>` element that renders tiles (the actual base map imagery).
- **Layers** — things you draw on top of the base tiles (polygons, points, lines, popups, etc.).
- **Controls** — UI widgets like the zoom buttons, scale bar, and attribution text.
- **Events** — hooks for when the user pans, zooms, clicks, hovers, etc.

Everything in Leaflet is JavaScript. You create a map, add layers to it, and optionally style or react to those layers.

---

## What is React-Leaflet?

This project uses **react-leaflet** (version 5), which is a thin React wrapper around the core Leaflet library. Instead of writing imperative JavaScript like `map.addLayer(...)`, you write declarative JSX like `<GeoJSON data={...} />`.

Underneath, react-leaflet is still calling the regular Leaflet API — it just synchronizes Leaflet's state with React's rendering cycle.

The two packages installed are:

| Package | Role |
|---|---|
| `leaflet` | The core mapping engine |
| `react-leaflet` | React components that wrap the Leaflet API |

---

## Core Concepts You Need to Know

### Tiles (the base map)

The background map imagery you see (roads, terrain, satellite, etc.) comes from a **tile layer**. Tiles are pre-rendered image squares served from a remote server. The most common free provider is OpenStreetMap.

A tile URL looks like this:
```
https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png
```
- `{z}` = zoom level
- `{x}` and `{y}` = grid position of the tile
- `{s}` = subdomain (for load balancing across `a`, `b`, `c` servers)

### Layers

On top of the base tiles, you add your own data as layers. The main layer types relevant here are:

- **GeoJSON Layer** — renders geographic shapes (polygons, lines, points) from GeoJSON data.
- **Circle Marker** — a fixed-pixel-size circle drawn at a geographic coordinate. Used for points that shouldn't scale with zoom.

### Styling Layers

Every layer accepts a `style` property that controls how it looks. For polygon and line layers, the style object can include:

| Property | What it does | Example value |
|---|---|---|
| `color` | Stroke (border/outline) color | `"#ef4444"` |
| `weight` | Stroke width in pixels | `2` |
| `fillColor` | Interior fill color | `"#f87171"` |
| `fillOpacity` | Fill transparency (0 = invisible, 1 = solid) | `0.3` |
| `opacity` | Stroke transparency | `1` |
| `dashArray` | Makes the stroke dashed | `"5, 5"` |

For **point** layers rendered via `circleMarker`, the options are:

| Property | What it does | Example value |
|---|---|---|
| `radius` | Size of the circle in pixels | `4` |
| `color` | Border color of the circle | `"#2ab7a9"` |
| `weight` | Border width in pixels | `1` |
| `fillColor` | Fill color of the circle | `"#5eead4"` |
| `fillOpacity` | Fill transparency | `0.9` |

### Panes

A **Pane** controls the draw order (z-order) of layers. Layers in a higher `zIndex` pane are drawn on top of layers in a lower `zIndex` pane. This is how you ensure question-area markers appear above parcel and management context layers.

---

## How Leaflet is Used in QAViewer

The map lives entirely inside `frontend/src/components/MapWorkspace.tsx`.

### The Map Container

```tsx
<MapContainer center={[39.5, -95]} zoom={4} className="leaflet-shell" zoomControl={false}>
  ...
</MapContainer>
```

- **`center={[39.5, -95]}`** — starts the map centered on the contiguous US (latitude 39.5, longitude -95).
- **`zoom={4}`** — starts at zoom level 4, which shows the whole country.
- **`zoomControl={false}`** — disables the default `+` / `-` zoom buttons (they aren't being replaced, so the user zooms with scroll/pinch).

### The Base Tile Layer

```tsx
<TileLayer
  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
/>
```

This loads the standard OpenStreetMap base map. To switch to a different base map (e.g., satellite imagery, a minimal style, etc.), you would change the `url` here.

### Panes and Their Z-Order

The layers are drawn in this order from bottom to top:

| Pane name | `zIndex` | What it contains |
|---|---|---|
| `management` | 370 | Management tracts |
| `parcels` | 390 | Primary parcels |
| `points` | 410 | Parcel points |
| `question-areas` | 430 | Question area polygons (always on top) |

A higher `zIndex` = drawn on top of everything below it. Question areas are always on top because they are the primary focus of the application.

### The Current Data Layers

Each layer is fetched from the backend API and conditionally rendered based on the layer visibility toggles in the left panel.

#### 1. Management Tracts (`management_tracts`)
Management tract polygons.
```tsx
style={{ color: "#39ff14", weight: 2.5, fillColor: "url(#management-pattern)", fillOpacity: 1 }}
```
- Bright green patterned fill used as management context.

#### 2. Primary Parcels (`primary_parcels`)
The primary parcel polygons from the geodatabase.
```tsx
style={primaryParcelStyle}
```
- Yellow parcel outlines used as reference boundaries, with a blue highlight when selected.

#### 3. Parcel Points (`parcel_points`)
Point features rendered as circle markers.
```tsx
L.circleMarker(latlng, {
  radius: 4,
  color: "#0f766e",
  weight: 1,
  fillColor: "#5eead4",
  fillOpacity: 0.9,
})
```
- Small 4px teal circles with a lighter teal fill. This layer uses `pointToLayer` so GeoJSON points render as styled circle markers.

#### 4. Question Areas (`question_areas`)
These are the core review records. The current UI renders transparent question-area geometry for map fitting and click isolation, then draws clickable question-area centroid markers above the context layers.

```tsx
<GeoJSON data={questionAreas} interactive={false} style={{ color: "transparent", weight: 0 }} />
<QAMarkerLayer questionAreas={questionAreas} selectedCode={selectedCode} onSelect={selectQuestionArea} />
```

- Question areas are selected through the `?` centroid marker.
- Selected markers pulse so the active review record is visible above parcels and management context.

### Viewport Tracking (`MapViewportWatcher`)

```tsx
function MapViewportWatcher({ onChange }) {
  const map = useMap();

  useEffect(() => {
    onChange(map.getBounds().toBBoxString());
  }, [map, onChange]);

  useMapEvents({
    moveend(event) {
      onChange(event.target.getBounds().toBBoxString());
    },
  });

  return null;
}
```

Every time the user finishes panning or zooming, this component reads the new map bounds and calls `onChange` with a bounding box string in the format `west,south,east,north` (e.g., `"-126,24,-66,49"`). That bounding box is then passed to the API as a `bbox` query parameter so only features within the visible area are fetched.

### Auto-Focus (`MapFocus`)

```tsx
function MapFocus({ detail }) {
  const map = useMap();
  const code = detail?.code ?? null;

  useEffect(() => {
    if (!detail) return;
    const bounds = L.geoJSON(detail.geometry).getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.35));
    }
  }, [code, map]);

  return null;
}
```

When a question area is selected (either from the list or the map), this component automatically zooms and pans the map to fit that feature's geometry, with 35% padding around its bounding box so it doesn't fill the entire view edge-to-edge.

---

## How Leaflet Connects to PostGIS

Leaflet has no direct connection to PostGIS. It only knows about GeoJSON — a standard text format for geographic shapes. The connection is indirect and goes through several steps. Understanding this chain is important because each step is a potential place where data can be filtered, transformed, or styled.

### The Full Data Pipeline

```
PostGIS (geometry stored in database)
    ↓  SQL query with ST_AsGeoJSON()
Express API (backend)
    ↓  HTTP response as GeoJSON FeatureCollection
React fetch call (frontend)
    ↓  JavaScript object in browser memory
Leaflet GeoJSON layer (renders shapes on map)
```

Leaflet never touches the database. PostGIS never knows Leaflet exists. The API in the middle translates between them.

---

### Step 1 — PostGIS stores geometry natively

PostGIS is a spatial extension for PostgreSQL. It adds a special `geometry` column type that can store geographic shapes — polygons, points, lines — directly in the database, alongside all the other regular data columns.

Every map-visible table in this project has a `geom` column of this type. From `backend/src/lib/schema.ts`:

| Table | Geometry type |
|---|---|
| `question_areas` | `geometry(MultiPolygon, 4326)` |
| `parcel_features` | `geometry(MultiPolygon, 4326)` |
| `parcel_points` | `geometry(Point, 4326)` |
| `management_tracts` | `geometry(MultiPolygon, 4326)` |

The `4326` is the SRID (Spatial Reference ID) — it means all coordinates are stored in **WGS 84 longitude/latitude**, which is the same coordinate system Leaflet uses. No reprojection is needed.

---

### Step 2 — PostGIS converts geometry to GeoJSON in the SQL query

PostGIS has a built-in function called `ST_AsGeoJSON()` that converts a geometry column into a GeoJSON-formatted text string. The backend uses this directly inside its SQL queries so geometry arrives at the API layer already in a format the browser can use.

For example, the question areas query in `backend/src/routes/questionAreas.ts`:

```sql
SELECT
  code,
  status,
  severity,
  title,
  -- ... other columns ...
  ST_AsGeoJSON(geom, 5)::jsonb AS geometry
FROM question_areas
WHERE ...
```

The `5` argument is the number of decimal places of precision in the output coordinates. `::jsonb` casts the result from a text string into a native PostgreSQL JSON object, which the `pg` Node.js driver then delivers directly as a JavaScript object — no `JSON.parse()` needed.
---

### Step 3 — The bounding box filter (`ST_MakeEnvelope`)

To avoid sending every feature in the entire database to the browser on every map move, the API uses a **spatial bounding box filter**. This is one of the most important performance mechanisms in the app.

From `backend/src/routes/layers.ts` and `backend/src/routes/questionAreas.ts`:

```sql
WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
```

- `ST_MakeEnvelope(west, south, east, north, srid)` creates a rectangular polygon from four coordinates.
- The `&&` operator is a PostGIS **bounding box intersection** test. It returns true if the feature's geometry overlaps with the envelope. It is extremely fast because every `geom` column has a **GIST spatial index** (also defined in `schema.ts`), which allows PostGIS to discard non-intersecting features without reading their full geometry.

The four coordinate values come from Leaflet's `MapViewportWatcher` component, which calls `map.getBounds().toBBoxString()` every time the user finishes panning or zooming. That string (`"west,south,east,north"`) is parsed by `parseBbox()` in `backend/src/lib/utils.ts` and injected as SQL parameters.

**In plain terms:** When you pan the map, Leaflet tells the API exactly what rectangle is visible. PostGIS uses a spatial index to instantly find only the features that fall inside that rectangle. Only those features are sent to the browser. Features outside the viewport are never transferred.

---

### Step 4 — The API assembles and returns a GeoJSON FeatureCollection

After the SQL query runs, the Express route assembles the result rows into a standard GeoJSON `FeatureCollection`. The `featureCollection()` helper in `backend/src/lib/utils.ts` wraps the array:

```ts
export function featureCollection(features: Feature[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features,
  };
}
```

Each row becomes one `Feature` object with:
- `type: "Feature"`
- `geometry` — the GeoJSON geometry object that PostGIS produced
- `properties` — all the non-spatial columns (code, status, severity, owner name, etc.)

The full response is a single JSON object like this:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "MultiPolygon", "coordinates": [...] },
      "properties": { "code": "QA-001", "severity": "high", "status": "review", ... }
    },
    ...
  ]
}
```

---

### Step 5 — React fetches the GeoJSON and passes it to Leaflet

In `MapWorkspace.tsx`, a `useEffect` hook calls the API whenever the map viewport or filters change:

```tsx
useEffect(() => {
  const params = new URLSearchParams({
    bbox: mapBbox,
    limit: "600",
  });
  if (searchFilter) params.set("search", searchFilter);

  apiRequest<QuestionAreaCollection>(`/question-areas?${params.toString()}`, {
    token: session.token,
  }).then((payload) => {
    setQuestionAreas(payload); // stores the FeatureCollection in React state
  });
}, [mapBbox, searchFilter, searchField, session.token]);
```

The `payload` variable is now a standard JavaScript object matching the GeoJSON `FeatureCollection` structure. It is stored in React state via `setQuestionAreas`.

---

### Step 6 — Leaflet renders the GeoJSON

Question area geometry is passed to a transparent `<GeoJSON>` layer, while visible selection happens through centroid markers:

```tsx
<GeoJSON data={questionAreas} interactive={false} style={{ color: "transparent", weight: 0 }} />
<QAMarkerLayer questionAreas={questionAreas} selectedCode={selectedCode} onSelect={selectQuestionArea} />
```

- **`GeoJSON`** keeps geometry available to Leaflet without drawing a visible polygon fill.
- **`QAMarkerLayer`** renders the clickable `?` markers from question-area centroids.
- **Selection** sets the active question-area code and loads the detail panel.

---

### GIST Spatial Indexes

PostGIS uses a special index type called **GIST** (Generalized Search Tree) for geometry columns. It works like a filing system organized by location rather than by value. When PostGIS evaluates `geom && ST_MakeEnvelope(...)`, it can use the GIST index to jump directly to features near that area without scanning every row.

All geometry columns in this project are indexed:

```sql
CREATE INDEX IF NOT EXISTS question_areas_geom_idx    ON question_areas    USING GIST (geom);
CREATE INDEX IF NOT EXISTS parcel_features_geom_idx   ON parcel_features   USING GIST (geom);
CREATE INDEX IF NOT EXISTS parcel_points_geom_idx     ON parcel_points     USING GIST (geom);
CREATE INDEX IF NOT EXISTS management_tracts_geom_idx ON management_tracts USING GIST (geom);
```

Without these indexes, every bounding box query would do a full table scan, which would be very slow at scale.

---

### PostGIS Functions Used in This Project

| Function | Where used | What it does |
|---|---|---|
| `ST_AsGeoJSON(geom, precision)` | All layer and question area queries | Converts a PostGIS geometry into a GeoJSON string |
| `ST_MakeEnvelope(west, south, east, north, srid)` | All bbox-filtered queries | Creates a rectangular polygon from four coordinates |
| `&&` operator | All bbox-filtered queries | Fast bounding box intersection test (uses GIST index) |
| `ST_AsGeoJSON(centroid, precision)` | Question area detail query | Exports the pre-computed centroid point as GeoJSON |

---

### Layer Fetch Limits

Each API endpoint enforces a maximum number of features returned per request. These limits exist to prevent the browser from becoming slow when many features are in view.

| Layer | Max features per request |
|---|---|
| `primary_parcels` | 6,000 |
| `parcel_points` | 6,000 |
| `management_tracts` | 3,000 |
| Question areas | 1,000 (user-configurable up to 1,000) |

If you are zoomed out far enough that more features than the limit exist in the viewport, only the first N rows (ordered by `id`) will be returned. Zooming in reduces the viewport and therefore reduces the number of matching features, eventually showing all of them.

---

## Quick Reference: Where to Change Symbology

| What you want to change | Where to find it in `MapWorkspace.tsx` |
|---|---|
| Question area selected marker styling | `createQAMarker()` function |
| Management tract fill/outline | `<Pane name="management">` — `GeoJSON` `style` prop |
| Primary parcel fill/outline | `<Pane name="parcels">` — `GeoJSON` `style` prop |
| Parcel point size/color | `<Pane name="points">` — `circleMarker` options inside `pointToLayer` |
| Base map tile source | `<TileLayer url="...">` |
| Map starting position / zoom | `<MapContainer center={[...]} zoom={...}>` |
| Draw order of layers | `zIndex` value on each `<Pane>` |
