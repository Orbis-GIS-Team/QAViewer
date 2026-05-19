create table if not exists public.users (
  id serial primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin', 'qa_reviewer', 'gis_team', 'land_records_team', 'client', 'other')),
  created_at timestamptz not null default now()
);

create table if not exists public.question_areas (
  id serial primary key,
  code text not null unique,
  source_layer text not null,
  status text not null check (status in ('review', 'active', 'resolved', 'hold')),
  severity text not null check (severity in ('high', 'medium', 'low')),
  actionability_state text not null default 'normal' check (actionability_state in ('normal', 'high_pain', 'no_parcel_data', 'in_progress')),
  title text not null,
  summary text not null,
  description text,
  county text,
  state text,
  parcel_code text,
  owner_name text,
  property_name text,
  tract_name text,
  fund_name text,
  land_services text,
  tax_bill_acres double precision,
  gis_acres double precision,
  spatial_overlay_notes text,
  legal_description text,
  risk text,
  latitude double precision,
  longitude double precision,
  questionnaire_source text,
  exists_in_legal_layer boolean,
  exists_in_management_layer boolean,
  exists_in_client_tabular_bill_data boolean,
  assigned_reviewer text,
  search_keywords text,
  raw_properties jsonb not null default '{}'::jsonb,
  geom geometry(Point, 4326) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.seed_metadata (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.land_records (
  objectid integer primary key,
  state varchar(50),
  county varchar(50),
  deedacres varchar(50),
  tractkey varchar(50),
  gisacres double precision,
  lr_number varchar(50),
  lr_type varchar(50),
  taxparcelnum varchar(100),
  l_desc varchar(100),
  fips varchar(50),
  docnumber varchar(50),
  source varchar(50),
  sourcepageno varchar(10),
  doctype varchar(50),
  lr_status varchar(25),
  current_owner varchar(100),
  previous_owner varchar(100),
  acq_date varchar(20),
  desc_type varchar(50),
  remark varchar(100),
  keyword varchar(50),
  docname varchar(150),
  trs varchar(50),
  lr_specs varchar(150),
  tax_confirm varchar(50),
  merge_src varchar(255),
  oldlrnum varchar(255),
  propertyname varchar(255),
  fundname varchar(255),
  regionname varchar(255),
  shape_length double precision,
  shape_area double precision,
  geom geometry(MultiPolygon, 4326) not null
);

create table if not exists public.management_areas (
  id serial primary key,
  effective_date text,
  status text,
  property_code text,
  property_name text,
  portfolio text,
  fund_name text,
  original_acquisition_date text,
  full_disposition_date text,
  management_type text,
  country text,
  investment_manager text,
  property_coordinates text,
  region text,
  state text,
  county text,
  business_unit text,
  crops text,
  tillable_acres double precision,
  gross_acres double precision,
  arable_hectares double precision,
  gross_hectares double precision,
  gis_acres double precision,
  gis_hectares double precision,
  raw_properties jsonb not null default '{}'::jsonb,
  geom geometry(MultiPolygon, 4326) not null
);

create table if not exists public.atlas_land_records (
  lr_number text primary key,
  tract_key text,
  old_lr_number text,
  primary_document_number text,
  primary_page_no text,
  property_name text,
  fund_name text,
  region_name text,
  lr_type text,
  lr_status text,
  acq_date text,
  tax_parcel_number text,
  gis_acres double precision,
  deed_acres double precision,
  doc_description_heading text,
  lr_specs text,
  township text,
  range text,
  section text,
  fips text,
  remark text,
  source_file text,
  source_workbook_path text,
  source_sheet text,
  source_row_number integer,
  geom geometry(Geometry, 4326)
);

create table if not exists public.atlas_documents (
  document_number text primary key,
  doc_name text,
  doc_type text,
  recording_instrument text,
  recording_date text,
  expiration_date text,
  deed_acres double precision,
  keywords text,
  remark text,
  source_file text,
  source_workbook_path text,
  source_sheet text,
  source_row_number integer
);

create table if not exists public.atlas_document_links (
  id serial primary key,
  lr_number text not null references public.atlas_land_records(lr_number) on delete cascade,
  document_number text not null references public.atlas_documents(document_number) on delete cascade,
  page_no text,
  source_workbook_path text,
  source_sheet text,
  source_row_number integer
);

create table if not exists public.atlas_featureless_docs (
  document_number text primary key references public.atlas_documents(document_number) on delete cascade,
  source_workbook_path text,
  source_sheet text,
  source_row_number integer
);

create table if not exists public.atlas_document_manifest (
  id serial primary key,
  property_code text,
  property_name text,
  source_folder text,
  package_relative_path text not null,
  file_name text,
  extension text,
  size_bytes bigint,
  document_number text,
  source_workbook_path text,
  source_docs_root_path text,
  source_file_path text
);

create table if not exists public.atlas_import_rejects (
  id serial primary key,
  entity_type text not null,
  source_workbook_path text,
  source_docs_root_path text,
  source_sheet text,
  source_row_number integer,
  reject_reason text not null,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.tax_parcels (
  id serial primary key,
  parcel_id text,
  parcel_code text,
  account_number text,
  owner_name text,
  property_name text,
  parcel_status text,
  tax_program text,
  ownership_type text,
  county text,
  state text,
  gis_acres double precision,
  description text,
  land_use_type text,
  tract_name text,
  notes text,
  raw_properties jsonb not null default '{}'::jsonb,
  geom geometry(MultiPolygon, 4326) not null
);

create table if not exists public.tax_bill_manifest (
  bill_id text primary key,
  parcel_id text not null,
  bill_year integer not null,
  file_name text not null,
  extension text,
  size_bytes bigint,
  bill_relative_path text not null,
  source_root_path text,
  source_file_path text
);

create table if not exists public.property_tax_parcel_points (
  id serial primary key,
  parcel_code text,
  account_number text,
  gis_acres double precision,
  state text,
  county text,
  property_name text,
  tract_name text,
  parcel_status text,
  tax_program text,
  exemption_enrollment_date text,
  exemption_expiration_date text,
  exemption_eligibility_date text,
  ownership_type text,
  purchase_date text,
  owner_name text,
  description text,
  fip_parcel_id text,
  notes text,
  land_use_type text,
  latitude double precision,
  longitude double precision,
  coordinate_status text not null default 'missing' check (coordinate_status in ('present', 'missing', 'invalid')),
  raw_properties jsonb not null default '{}'::jsonb,
  source_workbook_path text,
  source_sheet text,
  source_row_number integer,
  imported_at timestamptz not null default now(),
  geom geometry(Point, 4326)
);

create table if not exists public.comments (
  id serial primary key,
  question_area_id integer not null references public.question_areas(id) on delete cascade,
  author_id integer not null references public.users(id),
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  id serial primary key,
  question_area_id integer not null references public.question_areas(id) on delete cascade,
  original_name text not null,
  stored_name text not null,
  mime_type text,
  size_bytes integer not null,
  uploaded_by integer not null references public.users(id),
  created_at timestamptz not null default now()
);

create index if not exists question_areas_geom_idx on public.question_areas using gist (geom);
create index if not exists land_records_geom_idx on public.land_records using gist (geom);
create index if not exists land_records_lr_number_idx on public.land_records (lr_number);
create index if not exists management_areas_geom_idx on public.management_areas using gist (geom);
create index if not exists atlas_land_records_geom_idx on public.atlas_land_records using gist (geom);
create index if not exists tax_parcels_geom_idx on public.tax_parcels using gist (geom);

create index if not exists question_areas_status_idx on public.question_areas (status);
create index if not exists question_areas_severity_idx on public.question_areas (severity);
create index if not exists question_areas_actionability_state_idx on public.question_areas (actionability_state);
create unique index if not exists question_areas_parcel_code_unique_idx
  on public.question_areas (parcel_code)
  where parcel_code is not null;
create index if not exists atlas_land_records_property_name_idx on public.atlas_land_records (property_name);
create index if not exists atlas_land_records_fund_name_idx on public.atlas_land_records (fund_name);
create index if not exists tax_parcels_parcel_id_idx on public.tax_parcels (parcel_id);
create index if not exists tax_parcels_parcel_code_idx on public.tax_parcels (parcel_code);
create index if not exists tax_parcels_account_number_idx on public.tax_parcels (account_number);
create index if not exists property_tax_parcel_points_geom_idx
  on public.property_tax_parcel_points using gist (geom)
  where geom is not null;
create index if not exists property_tax_parcel_points_parcel_code_idx on public.property_tax_parcel_points (parcel_code);
create index if not exists property_tax_parcel_points_account_number_idx on public.property_tax_parcel_points (account_number);
create index if not exists property_tax_parcel_points_fip_parcel_id_idx on public.property_tax_parcel_points (fip_parcel_id);
create index if not exists property_tax_parcel_points_state_county_idx on public.property_tax_parcel_points (state, county);
create index if not exists tax_bill_manifest_parcel_id_idx on public.tax_bill_manifest (parcel_id);
create index if not exists tax_bill_manifest_bill_year_idx on public.tax_bill_manifest (bill_year);
create index if not exists tax_bill_manifest_bill_relative_path_idx on public.tax_bill_manifest (bill_relative_path);
create index if not exists atlas_document_links_lr_number_idx on public.atlas_document_links (lr_number);
create index if not exists atlas_document_links_document_number_idx on public.atlas_document_links (document_number);
create index if not exists atlas_document_manifest_document_number_idx on public.atlas_document_manifest (document_number);
create index if not exists atlas_document_manifest_package_relative_path_idx on public.atlas_document_manifest (package_relative_path);
create index if not exists atlas_import_rejects_entity_type_idx on public.atlas_import_rejects (entity_type);
create index if not exists atlas_import_rejects_source_workbook_path_idx on public.atlas_import_rejects (source_workbook_path);

create index if not exists comments_question_area_id_idx on public.comments (question_area_id);
create index if not exists documents_question_area_id_idx on public.documents (question_area_id);

create index if not exists question_areas_code_trgm_idx on public.question_areas using gin (code gin_trgm_ops);
create index if not exists question_areas_title_trgm_idx on public.question_areas using gin (title gin_trgm_ops);
create index if not exists question_areas_parcel_code_trgm_idx on public.question_areas using gin (parcel_code gin_trgm_ops);
create index if not exists tax_parcels_parcel_code_trgm_idx on public.tax_parcels using gin (parcel_code gin_trgm_ops);
create index if not exists property_tax_parcel_points_parcel_code_trgm_idx on public.property_tax_parcel_points using gin (parcel_code gin_trgm_ops);
create index if not exists question_areas_search_keywords_trgm_idx on public.question_areas using gin (search_keywords gin_trgm_ops);
