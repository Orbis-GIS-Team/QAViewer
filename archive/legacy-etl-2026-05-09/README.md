# Legacy ETL Archive

Archived: 2026-05-09

This folder contains the source-data and loader assets that supported the old runtime seed/ETL workflow.

QAViewer now starts in prepared-database validation mode and should read application data from PostgreSQL/PostGIS tables. Runtime startup should not import GeoJSON, workbooks, shapefiles, geodatabases, or document folders from this archive.

Archived paths:

- `data/`
- `DataBuild/`
- `DataStandardiztion/`
- `BTG_PTV_Implementation.gdb/`
- `Combined_LR_Upload_First3Tabs.xlsx`
- `LR_Documents/`
- `scripts/export_seed_data.py`
- `backend/src/lib/seed.ts`

If any of these sources need to be used again, restore or copy them intentionally and run an explicit data preparation/import command outside API startup.
