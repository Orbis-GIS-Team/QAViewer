# QAViewer Dataset Contract

This document defines the active standardized seed contract for QAViewer after the NNC cutover.

## Canonical Prepared Data

QAViewer runs against prepared PostgreSQL/PostGIS tables. Backend startup validates that the
runtime tables and required data already exist; it does not import source GIS packages or
standardized files.

Required prepared runtime layers:

- `question_areas`
- `land_records`
- `management_areas`

The `land_records` table is prepared from the concrete `LandRecords` layer in a source file
geodatabase, then loaded into PostGIS outside API startup. The browser remains decoupled from
source files and reads land records only through the API.

## Runtime Model

A question area represents a location where property tax boundaries may not match legal deed retracement or the management/ownership data the client uses to represent what they own and manage.

The active application model is:

- `question_areas`: primary review records, stored as point geometry
- `land_records`: supporting legal/land-record overlay layer
- `management_areas`: supporting management overlay layer

All geometry is expected to be in EPSG:4326.

## `question_areas.geojson`

Expected geometry:

- `Point`

Expected properties used by the active app:

- `code`
- `source_layer`
- `status`
- `severity`
- `actionability_state`
- `title`
- `summary`
- `description`
- `county`
- `state`
- `parcel_code`
- `owner_name`
- `property_name`
- `tract_name`
- `fund_name`
- `land_services`
- `tax_bill_acres`
- `gis_acres`
- `exists_in_legal_layer`
- `exists_in_management_layer`
- `exists_in_client_tabular_bill_data`
- `assigned_reviewer`
- `search_keywords`

Additional source properties may be retained in the file and are stored in `raw_properties`.

## `land_records`

Expected geometry:

- `MultiPolygon`
- SRID `4326`

The source layer schema is `LandRecordLayerUpdate/Data.gdb` layer `LandRecords`. PostgreSQL
column names are the lower-case GDAL/PostGIS import names:

- `objectid`
- `state`
- `county`
- `deedacres`
- `tractkey`
- `gisacres`
- `lr_number`
- `lr_type`
- `taxparcelnum`
- `l_desc`
- `fips`
- `docnumber`
- `source`
- `sourcepageno`
- `doctype`
- `lr_status`
- `current_owner`
- `previous_owner`
- `acq_date`
- `desc_type`
- `remark`
- `keyword`
- `docname`
- `trs`
- `lr_specs`
- `tax_confirm`
- `merge_src`
- `oldlrnum`
- `propertyname`
- `fundname`
- `regionname`
- `shape_length`
- `shape_area`
- `geom`

Current expected row count from `LandRecordLayerUpdate/Data.gdb`: `1316`.

## `management_areas.geojson`

Expected geometry:

- `MultiPolygon` or `Polygon`

Expected properties used by the seed loader:

- `effective_date`
- `status`
- `property_code`
- `property_name`
- `portfolio`
- `fund_name`
- `original_acquisition_date`
- `full_disposition_date`
- `management_type`
- `country`
- `investment_manager`
- `property_coordinates`
- `region`
- `state`
- `county`
- `business_unit`
- `crops`
- `tillable_acres`
- `gross_acres`
- `arable_hectares`
- `gross_hectares`
- `gis_acres`
- `gis_hectares`

## Manifest

`manifest.json` is hashed by the backend after seeding. If the manifest changes while the database is already populated, the backend fails fast and requires an explicit local reset/reseed.

## Reset and reseed workflow

After changing the standardized seed dataset or the schema:

```bash
docker compose down -v
docker compose up --build
```

Then verify:

```bash
cd backend
npm run test:smoke
```

## Historical note

Older docs in this repository may describe the retired `data/generated/` and parcel-centered BTG export pipeline. Those documents are historical only and should not be used as the current contract.
