# QAViewer Dataset Contract

QAViewer is reusable across datasets by keeping one normalized seed contract for the app and changing only the export configuration for each source dataset.

## Normalized Seed Outputs

The backend imports these files from `data/generated/`:

- `question_areas.geojson`
- `primary_parcels.geojson`
- `parcel_points.geojson`
- `management_tracts.geojson`
- `manifest.json`

Do not make backend or frontend code depend on a source geodatabase directly. New datasets should be exported into these files first.

## Source Dataset Requirements

The source dataset must expose these logical layers. The physical layer names can vary and are passed to `scripts/export_seed_data.py`.

| Logical layer | Default layer name | Purpose |
| --- | --- | --- |
| Primary mismatch areas | `BTG_Spatial_Fix_Primary_Erase` | Question areas from features present or authoritative on the primary side |
| Comparison mismatch areas | `BTG_Spatial_Fix_Comparison_Erase` | Question areas from features present or authoritative on the comparison side |
| Primary parcels | `BTG_Spatial_Fix_Primary_Layer` | Parcel polygons used for context and parcel-level review |
| Parcel points | `BTG_Points_NoArches_12Feb26` | Point context layer |
| Management tracts | `BTG_MGMT_NoArches` | Management polygon context layer |

All geometry layers must have a defined CRS. The exporter reprojects to EPSG:4326 for browser and PostGIS import.

## Required Source Fields

The source schema should remain stable across datasets. Field names are currently case-sensitive for supporting layers because the exporter validates those layers directly.

### Primary Parcels

- `parcelnumb`
- `County`
- `State`
- `RegridOwner`
- `PropertyName`
- `AnalysisName`
- `TractName`
- `QA_Status`
- `PTVParcel`
- `Exists_in_Mgt`
- `Exists_in_PTV`
- `GIS_Acres`
- `SpatialOverlayNotes`
- geometry

### Parcel Points

- `ParcelID`
- `ParcelCode`
- `OwnerName`
- `County`
- `State`
- `Descriptio`
- `TractName`
- `Latitude`
- `Longitude`
- `LandUseTyp`
- geometry

### Management Tracts

- `Fund`
- `PU_Number`
- `PU`
- `Tract_Numb`
- `Tract_Name`
- `Ownership`
- `Comment`
- `Book_Area`
- geometry

### Mismatch Question Areas

Mismatch layers are read broadly because source mismatch exports can carry slightly different attribution. The exporter looks for these aliases when present:

- Parcel number: `parcelnumb`, `parcel_number`, `ParcelNumber`, `ParcelID`, `ParcelCode`
- Parcel code: `PTVParcel`, `ptv_parcel`, `ParcelCode`, `parcel_code`
- Owner: `RegridOwner`, `OwnerName`, `owner_name`, `Ownership`
- County: `County`, `county`
- State: `State`, `state`, `STATE`
- Property: `PropertyName`, `property_name`, `Property`
- Analysis: `AnalysisName`, `analysis_name`
- Tract: `TractName`, `Tract_Name`, `tract_name`
- Notes: `SpatialOverlayNotes`, `QA_Status`, `Comment`, `Descriptio`, `Description`
- Acres: `GIS_Acres`, `gis_acres`, `ACRES`, `Book_Area`

Mismatch layers must include non-empty geometry. At least one feature must come from each mismatch layer.

## Export Configuration

Defaults match the original source names:

```bash
.venv/bin/python scripts/export_seed_data.py
```

Override source path and layer names with CLI args:

```bash
.venv/bin/python scripts/export_seed_data.py \
  --source path/to/source.gdb \
  --primary-mismatch-layer Primary_Mismatch \
  --comparison-mismatch-layer Comparison_Mismatch \
  --primary-parcels-layer Primary_Parcels \
  --parcel-points-layer Parcel_Points \
  --management-tracts-layer Management_Tracts
```

Or set equivalent environment variables:

- `QAVIEWER_SOURCE_GDB`
- `QAVIEWER_OUTPUT_DIR`
- `QAVIEWER_QA_PRIMARY_LAYER`
- `QAVIEWER_QA_COMPARISON_LAYER`
- `QAVIEWER_PRIMARY_PARCELS_LAYER`
- `QAVIEWER_PARCEL_POINTS_LAYER`
- `QAVIEWER_MANAGEMENT_TRACTS_LAYER`

## Reseed Workflow

After generating new seed files, reset local PostGIS explicitly:

```bash
docker compose down -v
docker compose up --build
```

Then verify:

```bash
cd backend
npm run test:smoke
```
