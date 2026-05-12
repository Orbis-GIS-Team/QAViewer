import type { PoolClient } from "pg";

export async function ensureSchema(client: PoolClient): Promise<void> {
  await client.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
  await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'qa_reviewer', 'gis_team', 'land_records_team', 'client', 'other')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    UPDATE users
    SET role = 'client'
    WHERE role = 'reviewer'
  `);

  await client.query(`
    ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_check
  `);

  await client.query(`
    UPDATE users
    SET role = 'other'
    WHERE role NOT IN ('admin', 'qa_reviewer', 'gis_team', 'land_records_team', 'client', 'other')
  `);

  await client.query(`
    ALTER TABLE users
    ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'qa_reviewer', 'gis_team', 'land_records_team', 'client', 'other'))
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS question_areas (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      source_layer TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('review', 'active', 'resolved', 'hold')),
      severity TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
      actionability_state TEXT NOT NULL DEFAULT 'normal' CHECK (actionability_state IN ('normal', 'high_pain', 'no_parcel_data', 'in_progress')),
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      description TEXT,
      county TEXT,
      state TEXT,
      parcel_code TEXT,
      owner_name TEXT,
      property_name TEXT,
      tract_name TEXT,
      fund_name TEXT,
      land_services TEXT,
      tax_bill_acres DOUBLE PRECISION,
      gis_acres DOUBLE PRECISION,
      exists_in_legal_layer BOOLEAN,
      exists_in_management_layer BOOLEAN,
      exists_in_client_tabular_bill_data BOOLEAN,
      assigned_reviewer TEXT,
      search_keywords TEXT,
      raw_properties JSONB NOT NULL DEFAULT '{}'::jsonb,
      geom geometry(Point, 4326) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    ALTER TABLE question_areas
    ADD COLUMN IF NOT EXISTS actionability_state TEXT
  `);

  await client.query(`
    UPDATE question_areas
    SET actionability_state = 'normal'
    WHERE actionability_state IS NULL
  `);

  await client.query(`
    ALTER TABLE question_areas
    ALTER COLUMN actionability_state SET DEFAULT 'normal',
    ALTER COLUMN actionability_state SET NOT NULL
  `);

  await client.query(`
    ALTER TABLE question_areas
    DROP CONSTRAINT IF EXISTS question_areas_actionability_state_check
  `);

  await client.query(`
    ALTER TABLE question_areas
    ADD CONSTRAINT question_areas_actionability_state_check
    CHECK (actionability_state IN ('normal', 'high_pain', 'no_parcel_data', 'in_progress'))
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS seed_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS land_records (
      objectid INTEGER PRIMARY KEY,
      state VARCHAR(50),
      county VARCHAR(50),
      deedacres VARCHAR(50),
      tractkey VARCHAR(50),
      gisacres DOUBLE PRECISION,
      lr_number VARCHAR(50),
      lr_type VARCHAR(50),
      taxparcelnum VARCHAR(100),
      l_desc VARCHAR(100),
      fips VARCHAR(50),
      docnumber VARCHAR(50),
      source VARCHAR(50),
      sourcepageno VARCHAR(10),
      doctype VARCHAR(50),
      lr_status VARCHAR(25),
      current_owner VARCHAR(100),
      previous_owner VARCHAR(100),
      acq_date VARCHAR(20),
      desc_type VARCHAR(50),
      remark VARCHAR(100),
      keyword VARCHAR(50),
      docname VARCHAR(150),
      trs VARCHAR(50),
      lr_specs VARCHAR(150),
      tax_confirm VARCHAR(50),
      merge_src VARCHAR(255),
      oldlrnum VARCHAR(255),
      propertyname VARCHAR(255),
      fundname VARCHAR(255),
      regionname VARCHAR(255),
      shape_length DOUBLE PRECISION,
      shape_area DOUBLE PRECISION,
      geom geometry(MultiPolygon, 4326) NOT NULL
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS management_areas (
      id SERIAL PRIMARY KEY,
      effective_date TEXT,
      status TEXT,
      property_code TEXT,
      property_name TEXT,
      portfolio TEXT,
      fund_name TEXT,
      original_acquisition_date TEXT,
      full_disposition_date TEXT,
      management_type TEXT,
      country TEXT,
      investment_manager TEXT,
      property_coordinates TEXT,
      region TEXT,
      state TEXT,
      county TEXT,
      business_unit TEXT,
      crops TEXT,
      tillable_acres DOUBLE PRECISION,
      gross_acres DOUBLE PRECISION,
      arable_hectares DOUBLE PRECISION,
      gross_hectares DOUBLE PRECISION,
      gis_acres DOUBLE PRECISION,
      gis_hectares DOUBLE PRECISION,
      raw_properties JSONB NOT NULL DEFAULT '{}'::jsonb,
      geom geometry(MultiPolygon, 4326) NOT NULL
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS atlas_land_records (
      lr_number TEXT PRIMARY KEY,
      tract_key TEXT,
      old_lr_number TEXT,
      primary_document_number TEXT,
      primary_page_no TEXT,
      property_name TEXT,
      fund_name TEXT,
      region_name TEXT,
      lr_type TEXT,
      lr_status TEXT,
      acq_date TEXT,
      tax_parcel_number TEXT,
      gis_acres DOUBLE PRECISION,
      deed_acres DOUBLE PRECISION,
      doc_description_heading TEXT,
      lr_specs TEXT,
      township TEXT,
      range TEXT,
      section TEXT,
      fips TEXT,
      remark TEXT,
      source_file TEXT,
      source_workbook_path TEXT,
      source_sheet TEXT,
      source_row_number INTEGER,
      geom geometry(Geometry, 4326)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS atlas_documents (
      document_number TEXT PRIMARY KEY,
      doc_name TEXT,
      doc_type TEXT,
      recording_instrument TEXT,
      recording_date TEXT,
      expiration_date TEXT,
      deed_acres DOUBLE PRECISION,
      keywords TEXT,
      remark TEXT,
      source_file TEXT,
      source_workbook_path TEXT,
      source_sheet TEXT,
      source_row_number INTEGER
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS atlas_document_links (
      id SERIAL PRIMARY KEY,
      lr_number TEXT NOT NULL REFERENCES atlas_land_records(lr_number) ON DELETE CASCADE,
      document_number TEXT NOT NULL REFERENCES atlas_documents(document_number) ON DELETE CASCADE,
      page_no TEXT,
      source_workbook_path TEXT,
      source_sheet TEXT,
      source_row_number INTEGER
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS atlas_featureless_docs (
      document_number TEXT PRIMARY KEY REFERENCES atlas_documents(document_number) ON DELETE CASCADE,
      source_workbook_path TEXT,
      source_sheet TEXT,
      source_row_number INTEGER
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS atlas_document_manifest (
      id SERIAL PRIMARY KEY,
      property_code TEXT,
      property_name TEXT,
      source_folder TEXT,
      package_relative_path TEXT NOT NULL,
      file_name TEXT,
      extension TEXT,
      size_bytes BIGINT,
      document_number TEXT,
      source_workbook_path TEXT,
      source_docs_root_path TEXT,
      source_file_path TEXT
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS atlas_import_rejects (
      id SERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      source_workbook_path TEXT,
      source_docs_root_path TEXT,
      source_sheet TEXT,
      source_row_number INTEGER,
      reject_reason TEXT NOT NULL,
      raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS tax_parcels (
      id SERIAL PRIMARY KEY,
      parcel_id TEXT,
      parcel_code TEXT,
      account_number TEXT,
      owner_name TEXT,
      property_name TEXT,
      parcel_status TEXT,
      tax_program TEXT,
      ownership_type TEXT,
      county TEXT,
      state TEXT,
      gis_acres DOUBLE PRECISION,
      description TEXT,
      land_use_type TEXT,
      tract_name TEXT,
      notes TEXT,
      raw_properties JSONB NOT NULL DEFAULT '{}'::jsonb,
      geom geometry(MultiPolygon, 4326) NOT NULL
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS tax_bill_manifest (
      bill_id TEXT PRIMARY KEY,
      parcel_id TEXT NOT NULL,
      bill_year INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      extension TEXT,
      size_bytes BIGINT,
      bill_relative_path TEXT NOT NULL,
      source_root_path TEXT,
      source_file_path TEXT
    )
  `);

  await client.query(`
    ALTER TABLE atlas_land_records
    ADD COLUMN IF NOT EXISTS primary_page_no TEXT,
    ADD COLUMN IF NOT EXISTS source_workbook_path TEXT,
    ADD COLUMN IF NOT EXISTS source_sheet TEXT,
    ADD COLUMN IF NOT EXISTS source_row_number INTEGER
  `);

  await client.query(`
    ALTER TABLE atlas_documents
    ADD COLUMN IF NOT EXISTS source_workbook_path TEXT,
    ADD COLUMN IF NOT EXISTS source_sheet TEXT,
    ADD COLUMN IF NOT EXISTS source_row_number INTEGER
  `);

  await client.query(`
    ALTER TABLE atlas_document_links
    ADD COLUMN IF NOT EXISTS page_no TEXT,
    ADD COLUMN IF NOT EXISTS source_workbook_path TEXT,
    ADD COLUMN IF NOT EXISTS source_sheet TEXT,
    ADD COLUMN IF NOT EXISTS source_row_number INTEGER
  `);

  await client.query(`
    ALTER TABLE atlas_featureless_docs
    ADD COLUMN IF NOT EXISTS source_workbook_path TEXT,
    ADD COLUMN IF NOT EXISTS source_sheet TEXT,
    ADD COLUMN IF NOT EXISTS source_row_number INTEGER
  `);

  await client.query(`
    ALTER TABLE atlas_document_manifest
    ADD COLUMN IF NOT EXISTS source_workbook_path TEXT,
    ADD COLUMN IF NOT EXISTS source_docs_root_path TEXT,
    ADD COLUMN IF NOT EXISTS source_file_path TEXT
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      question_area_id INTEGER NOT NULL REFERENCES question_areas(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      question_area_id INTEGER NOT NULL REFERENCES question_areas(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER NOT NULL,
      uploaded_by INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS question_areas_geom_idx ON question_areas USING GIST (geom);
    CREATE INDEX IF NOT EXISTS land_records_geom_idx ON land_records USING GIST (geom);
    CREATE INDEX IF NOT EXISTS land_records_lr_number_idx ON land_records (lr_number);
    CREATE INDEX IF NOT EXISTS management_areas_geom_idx ON management_areas USING GIST (geom);
    CREATE INDEX IF NOT EXISTS atlas_land_records_geom_idx ON atlas_land_records USING GIST (geom);
    CREATE INDEX IF NOT EXISTS tax_parcels_geom_idx ON tax_parcels USING GIST (geom);

    CREATE INDEX IF NOT EXISTS question_areas_status_idx ON question_areas (status);
    CREATE INDEX IF NOT EXISTS question_areas_severity_idx ON question_areas (severity);
    CREATE INDEX IF NOT EXISTS question_areas_actionability_state_idx ON question_areas (actionability_state);
    CREATE INDEX IF NOT EXISTS atlas_land_records_property_name_idx ON atlas_land_records (property_name);
    CREATE INDEX IF NOT EXISTS atlas_land_records_fund_name_idx ON atlas_land_records (fund_name);
    CREATE INDEX IF NOT EXISTS tax_parcels_parcel_id_idx ON tax_parcels (parcel_id);
    CREATE INDEX IF NOT EXISTS tax_parcels_parcel_code_idx ON tax_parcels (parcel_code);
    CREATE INDEX IF NOT EXISTS tax_parcels_account_number_idx ON tax_parcels (account_number);
    CREATE INDEX IF NOT EXISTS tax_bill_manifest_parcel_id_idx ON tax_bill_manifest (parcel_id);
    CREATE INDEX IF NOT EXISTS tax_bill_manifest_bill_year_idx ON tax_bill_manifest (bill_year);
    CREATE INDEX IF NOT EXISTS tax_bill_manifest_bill_relative_path_idx ON tax_bill_manifest (bill_relative_path);
    CREATE INDEX IF NOT EXISTS atlas_document_links_lr_number_idx ON atlas_document_links (lr_number);
    CREATE INDEX IF NOT EXISTS atlas_document_links_document_number_idx ON atlas_document_links (document_number);
    CREATE INDEX IF NOT EXISTS atlas_document_manifest_document_number_idx ON atlas_document_manifest (document_number);
    CREATE INDEX IF NOT EXISTS atlas_document_manifest_package_relative_path_idx ON atlas_document_manifest (package_relative_path);
    CREATE INDEX IF NOT EXISTS atlas_import_rejects_entity_type_idx ON atlas_import_rejects (entity_type);
    CREATE INDEX IF NOT EXISTS atlas_import_rejects_source_workbook_path_idx ON atlas_import_rejects (source_workbook_path);

    CREATE INDEX IF NOT EXISTS comments_question_area_id_idx ON comments (question_area_id);
    CREATE INDEX IF NOT EXISTS documents_question_area_id_idx ON documents (question_area_id);

    CREATE INDEX IF NOT EXISTS question_areas_code_trgm_idx ON question_areas USING GIN (code gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS question_areas_title_trgm_idx ON question_areas USING GIN (title gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS question_areas_parcel_code_trgm_idx ON question_areas USING GIN (parcel_code gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS tax_parcels_parcel_code_trgm_idx ON tax_parcels USING GIN (parcel_code gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS question_areas_search_keywords_trgm_idx ON question_areas USING GIN (search_keywords gin_trgm_ops);
  `);
}
