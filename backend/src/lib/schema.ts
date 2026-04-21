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
      role TEXT NOT NULL CHECK (role IN ('admin', 'client')),
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
    ALTER TABLE users
    ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'client'))
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS question_areas (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      source_layer TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('review', 'active', 'resolved', 'hold')),
      severity TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
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
    CREATE TABLE IF NOT EXISTS seed_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS land_records (
      id SERIAL PRIMARY KEY,
      state TEXT,
      county TEXT,
      parcel_number TEXT,
      deed_acres DOUBLE PRECISION,
      gis_acres DOUBLE PRECISION,
      fips TEXT,
      description TEXT,
      record_type TEXT,
      tract_key TEXT,
      record_number TEXT,
      document_number TEXT,
      source_name TEXT,
      source_page_number TEXT,
      document_type TEXT,
      record_status TEXT,
      current_owner TEXT,
      previous_owner TEXT,
      acquisition_date TEXT,
      description_type TEXT,
      remark TEXT,
      keyword TEXT,
      document_name TEXT,
      trs TEXT,
      record_specs TEXT,
      tax_confirmed BOOLEAN,
      merge_source TEXT,
      old_record_number TEXT,
      property_name TEXT,
      fund_name TEXT,
      region_name TEXT,
      raw_properties JSONB NOT NULL DEFAULT '{}'::jsonb,
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
    CREATE INDEX IF NOT EXISTS management_areas_geom_idx ON management_areas USING GIST (geom);

    CREATE INDEX IF NOT EXISTS question_areas_status_idx ON question_areas (status);
    CREATE INDEX IF NOT EXISTS question_areas_severity_idx ON question_areas (severity);

    CREATE INDEX IF NOT EXISTS comments_question_area_id_idx ON comments (question_area_id);
    CREATE INDEX IF NOT EXISTS documents_question_area_id_idx ON documents (question_area_id);

    CREATE INDEX IF NOT EXISTS question_areas_code_trgm_idx ON question_areas USING GIN (code gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS question_areas_title_trgm_idx ON question_areas USING GIN (title gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS question_areas_parcel_code_trgm_idx ON question_areas USING GIN (parcel_code gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS question_areas_search_keywords_trgm_idx ON question_areas USING GIN (search_keywords gin_trgm_ops);
  `);
}
