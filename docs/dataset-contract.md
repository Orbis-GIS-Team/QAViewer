# QAViewer Dataset Contract

This document defines the active standardized seed contract for QAViewer after the NNC cutover.

## Canonical Seed Outputs

The backend imports these files from `data/standardized/`:

- `question_areas.geojson`
- `land_records.geojson`
- `management_areas.geojson`
- `manifest.json`

Do not make backend or frontend code depend directly on a source geodatabase. Convert source GIS data into this standardized dataset first.

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

## `land_records.geojson`

Expected geometry:

- `MultiPolygon` or `Polygon`

Expected properties used by the seed loader:

- `state`
- `county`
- `parcel_number`
- `deed_acres`
- `gis_acres`
- `fips`
- `description`
- `record_type`
- `tract_key`
- `record_number`
- `document_number`
- `source_name`
- `source_page_number`
- `document_type`
- `record_status`
- `current_owner`
- `previous_owner`
- `acquisition_date`
- `description_type`
- `remark`
- `keyword`
- `document_name`
- `trs`
- `record_specs`
- `tax_confirmed`
- `merge_source`
- `old_record_number`
- `property_name`
- `fund_name`
- `region_name`

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
