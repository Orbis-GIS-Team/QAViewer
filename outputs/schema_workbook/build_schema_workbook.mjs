import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outputDir = path.join(repoRoot, "outputs", "schema_workbook");
const schemaSnapshot = JSON.parse(
  (await fs.readFile(path.join(repoRoot, "outputs_db_schema.json"), "utf8")).replace(/^\uFEFF/, ""),
);

const generatedAt = new Date().toISOString().slice(0, 19).replace("T", " ");

const tablePurpose = {
  question_areas: "Primary review/workflow records. Each row is a point location where legal, management, or tax data needs review.",
  land_records: "Supporting deed/legal land-record overlay used on the map and to hydrate Atlas geometry by record number.",
  management_areas: "Supporting management/ownership overlay used on the map for comparison against question areas and land records.",
  atlas_land_records: "Atlas workbook land-record rows enriched with geometry from land_records when record numbers match.",
  atlas_documents: "Atlas document metadata loaded from the LR Documents workbook tab.",
  atlas_document_links: "Bridge table linking Atlas land records to child/supporting Atlas documents.",
  atlas_featureless_docs: "Atlas documents intentionally not tied to a land-record geometry.",
  atlas_document_manifest: "Document file manifest used to preview/download Atlas documents from disk.",
  atlas_import_rejects: "Strict Atlas import rejection log for invalid or duplicate workbook rows.",
  tax_parcels: "Tax parcel sidecar layer used to match parcels within a selected question-area buffer.",
  tax_bill_manifest: "Tax bill file manifest used to preview/download bills for matched tax parcels.",
  comments: "Reviewer/client discussion entries attached to question areas.",
  documents: "Uploaded file metadata for question-area supporting documents; binary files are stored on disk.",
  users: "Authenticated users and roles for workspace permissions and admin management.",
  seed_metadata: "Startup validation fingerprints for prepared data sources and sidecar datasets.",
};

const tableCategory = {
  question_areas: "Core workflow",
  land_records: "Supporting GIS layer",
  management_areas: "Supporting GIS layer",
  atlas_land_records: "Atlas support module",
  atlas_documents: "Atlas support module",
  atlas_document_links: "Atlas support module",
  atlas_featureless_docs: "Atlas support module",
  atlas_document_manifest: "Atlas support module",
  atlas_import_rejects: "Atlas support module",
  tax_parcels: "Tax parcel support module",
  tax_bill_manifest: "Tax parcel support module",
  comments: "Collaboration",
  documents: "Collaboration",
  users: "Security/admin",
  seed_metadata: "Runtime metadata",
};

const tableFrontend = {
  question_areas: "Yes - main reviewer workspace, map markers, details rail, filters, export",
  land_records: "Yes - map overlay and identify panel",
  management_areas: "Yes - map overlay and identify panel",
  atlas_land_records: "Yes - Atlas workspace for selected question area",
  atlas_documents: "Yes - Atlas document cards, preview, download",
  atlas_document_links: "Indirect - controls child document lists/page numbers",
  atlas_featureless_docs: "Yes - Atlas featureless document list when loaded",
  atlas_document_manifest: "Indirect - file status, preview, download metadata",
  atlas_import_rejects: "Partial - Atlas warning/import report endpoints",
  tax_parcels: "Yes - tax parcel workspace and map overlay",
  tax_bill_manifest: "Yes - tax bill cards, preview, download",
  comments: "Yes - question-area comments timeline",
  documents: "Yes - uploaded document list and downloads",
  users: "Yes - login/session and admin user management",
  seed_metadata: "No - backend startup validation only",
};

const editableTables = {
  question_areas: "Partially editable: status, severity, summary, description, assigned_reviewer; updated_at changes automatically.",
  comments: "Append-only from UI; body is created by users.",
  documents: "Created by upload; stored file metadata inserted by backend.",
  users: "Admin UI can create, update, and delete eligible users.",
};

const relationships = [
  ["comments", "question_area_id", "question_areas", "id", "Many comments belong to one question area.", "Hard FK, cascade delete"],
  ["comments", "author_id", "users", "id", "Each comment has a user author.", "Hard FK"],
  ["documents", "question_area_id", "question_areas", "id", "Uploaded files belong to one question area.", "Hard FK, cascade delete"],
  ["documents", "uploaded_by", "users", "id", "Each uploaded file records the uploading user.", "Hard FK"],
  ["atlas_document_links", "lr_number", "atlas_land_records", "lr_number", "Many child documents can link to one Atlas land record.", "Hard FK, cascade delete"],
  ["atlas_document_links", "document_number", "atlas_documents", "document_number", "Many links can point to one Atlas document.", "Hard FK, cascade delete"],
  ["atlas_featureless_docs", "document_number", "atlas_documents", "document_number", "Featureless docs are a subset of Atlas documents.", "Hard FK, cascade delete"],
  ["atlas_document_manifest", "document_number", "atlas_documents", "document_number", "Manifest rows attach file paths to Atlas document numbers.", "Logical join in API, no DB FK"],
  ["atlas_land_records", "lr_number", "land_records", "record_number", "Atlas geometry is hydrated from matching standardized land records.", "Logical join during import"],
  ["tax_bill_manifest", "parcel_id", "tax_parcels", "parcel_id", "Tax bills attach to tax parcels by parcel ID.", "Logical join in API, no DB FK"],
  ["atlas_land_records", "geom", "question_areas", "geom", "Selected question-area buffers find intersecting Atlas records.", "Spatial relationship"],
  ["tax_parcels", "geom", "question_areas", "geom", "Selected question-area buffers find intersecting tax parcels.", "Spatial relationship"],
  ["land_records", "geom", "question_areas", "geom", "Land record overlay is visually compared with question areas.", "Spatial context"],
  ["management_areas", "geom", "question_areas", "geom", "Management overlay is visually compared with question areas.", "Spatial context"],
];

const frontendFields = {
  question_areas: {
    id: ["API/detail internal", "Returned by detail API; used for comment/document lookup on backend."],
    code: ["Displayed", "Question Area ID in lists, details, selection, URLs, export, and API keys."],
    source_layer: ["Displayed", "Shown in detail payload as sourceLayer."],
    status: ["Displayed + editable", "Workflow badge/filter and editable status control."],
    severity: ["Displayed + editable", "Priority badge/filter and editable priority control."],
    actionability_state: ["Displayed + filter", "Marker symbol, legend, filters, and actionability badge."],
    title: ["Displayed", "List/search/detail title."],
    summary: ["Displayed + editable", "List/detail summary and editable review summary."],
    description: ["Displayed + editable", "Detailed notes/description and export."],
    county: ["Displayed + filter", "List/detail/search filter and export."],
    state: ["Displayed + filter", "List/detail/search filter and export."],
    parcel_code: ["Displayed + filter", "Support context/tax parcel code in list/detail/search/export."],
    owner_name: ["Displayed", "Record owner in detail/list/export."],
    property_name: ["Displayed + filter", "Property context in filters/detail/export."],
    tract_name: ["Displayed", "Tract context in detail/export."],
    fund_name: ["Displayed", "Fund context in detail/export."],
    land_services: ["Displayed", "Land services note in detail/export."],
    tax_bill_acres: ["Displayed", "Tax bill acres in detail/export."],
    gis_acres: ["Displayed", "GIS acres in detail/export."],
    exists_in_legal_layer: ["Displayed + filter", "Legal/deed evidence availability."],
    exists_in_management_layer: ["Displayed + filter", "Management data availability."],
    exists_in_client_tabular_bill_data: ["Displayed + filter", "Client bill data availability."],
    assigned_reviewer: ["Displayed + editable", "Assignment display, filter, and editable if user has assignment permission."],
    search_keywords: ["Search only", "Used by backend search; not rendered directly."],
    raw_properties: ["API/detail raw context", "Returned as rawProperties in detail; useful for audit/provenance."],
    geom: ["Map geometry", "Point marker location and spatial buffer source for Atlas/tax parcel modules."],
    created_at: ["Backend only", "Not currently returned by question-area API."],
    updated_at: ["Backend only", "Updated on workflow edits; not currently returned by API."],
  },
  land_records: {
    id: ["Displayed", "Feature ID in map identify panel."],
    parcel_number: ["Displayed", "Primary identify field."],
    deed_acres: ["Displayed", "Context identify field."],
    gis_acres: ["Displayed", "Context identify field."],
    record_type: ["Displayed", "Attribute identify field."],
    tract_key: ["Displayed", "Context identify field."],
    record_number: ["Displayed", "Primary identify field; also logical match to atlas_land_records.lr_number."],
    document_number: ["Displayed", "Primary identify field."],
    document_type: ["Displayed", "Attribute identify field."],
    record_status: ["Displayed", "Attribute identify field."],
    current_owner: ["Displayed", "Attribute identify field."],
    previous_owner: ["Displayed", "Attribute identify field."],
    tax_confirmed: ["Displayed", "Attribute identify field."],
    property_name: ["Displayed", "Context identify field."],
    fund_name: ["Displayed", "Context identify field."],
    region_name: ["Displayed", "Context identify field."],
    county: ["Displayed", "Context identify field."],
    state: ["Displayed", "Context identify field."],
    raw_properties: ["API layer payload", "All raw properties are sent to frontend for identify use."],
    geom: ["Map geometry", "Polygon overlay and identify hit-testing."],
  },
  management_areas: {
    id: ["Displayed", "Feature ID in map identify panel."],
    effective_date: ["Displayed", "Context identify field."],
    status: ["Displayed", "Attribute identify field."],
    property_code: ["Displayed", "Primary identify field."],
    property_name: ["Displayed", "Primary identify field."],
    portfolio: ["Displayed", "Primary identify field."],
    fund_name: ["Displayed", "Attribute identify field."],
    management_type: ["Displayed", "Attribute identify field."],
    country: ["Displayed", "Context identify field."],
    investment_manager: ["Displayed", "Attribute identify field."],
    region: ["Displayed", "Context identify field."],
    state: ["Displayed", "Context identify field."],
    county: ["Displayed", "Context identify field."],
    business_unit: ["Displayed", "Attribute identify field."],
    crops: ["Displayed", "Attribute identify field."],
    tillable_acres: ["Displayed", "Context identify field."],
    gross_acres: ["Displayed", "Context identify field."],
    gis_acres: ["Displayed", "Context identify field."],
    raw_properties: ["API layer payload", "All raw properties are sent to frontend for identify use."],
    geom: ["Map geometry", "Polygon overlay and identify hit-testing."],
  },
  atlas_land_records: {
    lr_number: ["Displayed", "Atlas record ID and key."],
    tract_key: ["Displayed", "Atlas record summary."],
    old_lr_number: ["API only", "Returned by backend but not currently normalized in frontend type."],
    primary_document_number: ["Displayed", "Parent document link/display."],
    primary_page_no: ["Displayed", "Parent page number."],
    property_name: ["Displayed", "Atlas record summary/context."],
    fund_name: ["Displayed", "Atlas record context."],
    region_name: ["Displayed", "Atlas record summary/context."],
    lr_type: ["Displayed", "Atlas record subtitle/badge context."],
    lr_status: ["Displayed", "Atlas record subtitle/badge context."],
    acq_date: ["Displayed", "Atlas acquisition date field."],
    tax_parcel_number: ["Displayed", "Atlas tax parcel number field."],
    gis_acres: ["Displayed", "Atlas acres field."],
    deed_acres: ["Displayed", "Atlas acres field."],
    doc_description_heading: ["API only", "Returned by backend; not currently normalized in frontend type."],
    lr_specs: ["API only", "Returned by backend; not currently normalized in frontend type."],
    township: ["Displayed", "Atlas legal location context."],
    range: ["Displayed", "Atlas legal location context."],
    section: ["Displayed", "Atlas legal location context."],
    fips: ["Displayed", "Atlas location context."],
    remark: ["Displayed", "Atlas record notes."],
    source_file: ["API only", "Returned by backend; not currently normalized in frontend type."],
    source_workbook_path: ["Backend/audit only", "Stored for provenance and import validation."],
    source_sheet: ["API only", "Returned as sourceSheet in backend record; not currently prominent in UI."],
    source_row_number: ["Backend/audit only", "Stored for import traceability."],
    geom: ["Map geometry", "Matched Atlas feature geometry and spatial query target; may be null."],
  },
  atlas_documents: {
    document_number: ["Displayed", "Document card key/title/subtitle."],
    doc_name: ["Displayed", "Document display title fallback."],
    doc_type: ["Displayed", "Document subtitle/badge context."],
    recording_instrument: ["API only", "Loaded into backend asset but not rendered in current frontend type."],
    recording_date: ["API only", "Loaded into backend asset but not rendered in current frontend type."],
    expiration_date: ["API only", "Loaded into backend asset but not rendered in current frontend type."],
    deed_acres: ["API only", "Loaded into backend asset but not rendered in current frontend type."],
    keywords: ["API only", "Loaded into backend asset but not rendered in current frontend type."],
    remark: ["API only", "Loaded into backend asset but not rendered in current frontend type."],
    source_file: ["API only", "Loaded into backend asset but not rendered in current frontend type."],
    source_workbook_path: ["Backend/audit only", "Import provenance."],
    source_sheet: ["Backend/audit only", "Import provenance."],
    source_row_number: ["Backend/audit only", "Import provenance."],
  },
  atlas_document_links: {
    id: ["Backend/API internal", "Used to order child document links."],
    lr_number: ["Indirect", "Determines which child documents appear for an Atlas land record."],
    document_number: ["Indirect", "Resolves the child document metadata."],
    page_no: ["Displayed", "Child document page label/target."],
    source_workbook_path: ["Backend/audit only", "Import provenance."],
    source_sheet: ["Backend/audit only", "Import provenance."],
    source_row_number: ["Backend/audit only", "Import provenance."],
  },
  atlas_featureless_docs: {
    document_number: ["Displayed", "Determines which featureless documents appear in Atlas document list."],
    source_workbook_path: ["Backend/audit only", "Import provenance."],
    source_sheet: ["Backend/audit only", "Import provenance."],
    source_row_number: ["Backend/audit only", "Import provenance."],
  },
  atlas_document_manifest: {
    id: ["Backend internal", "Surrogate key."],
    property_code: ["API only", "Loaded into backend asset; useful for provenance."],
    property_name: ["API only", "Loaded into backend asset; useful for provenance."],
    source_folder: ["Backend/audit only", "Document source folder provenance."],
    package_relative_path: ["Displayed/used", "Supports file identity and preview/download resolution."],
    file_name: ["Displayed", "Document title fallback and download filename."],
    extension: ["Displayed/used", "Previewability and document meta label."],
    size_bytes: ["Displayed", "Document size label."],
    document_number: ["Indirect", "Joins manifest files to Atlas document metadata."],
    source_workbook_path: ["Backend/audit only", "Import provenance."],
    source_docs_root_path: ["Backend/audit only", "Source package root provenance."],
    source_file_path: ["Backend only", "Server-side file resolution for preview/download."],
  },
  atlas_import_rejects: {
    id: ["API only", "Import report row identifier."],
    entity_type: ["Displayed/summary", "Grouped into Atlas import warning/report counts."],
    source_sheet: ["API report", "Import report context."],
    source_row_number: ["API report", "Import report context."],
    reject_reason: ["API report", "Reason a row was rejected."],
    raw_data: ["API report", "Rejected source row payload for audit."],
    created_at: ["Backend/audit only", "Reject creation timestamp."],
  },
  tax_parcels: {
    id: ["Backend/API internal", "Used as fallback match key."],
    parcel_id: ["Displayed", "Parcel card identity and tax bill join."],
    parcel_code: ["Displayed", "Parcel card title fallback."],
    account_number: ["Displayed", "Parcel card/detail identity fallback."],
    owner_name: ["Displayed", "Parcel subtitle/detail."],
    property_name: ["Displayed", "Parcel detail."],
    parcel_status: ["Displayed", "Parcel badge."],
    tax_program: ["Displayed", "Parcel badge."],
    ownership_type: ["Displayed", "Parcel detail."],
    county: ["Displayed", "Parcel subtitle/detail."],
    state: ["Displayed", "Parcel subtitle/detail."],
    gis_acres: ["Displayed", "Parcel detail."],
    description: ["Displayed", "Parcel description note."],
    land_use_type: ["Displayed", "Parcel detail."],
    tract_name: ["Displayed", "Parcel detail."],
    notes: ["Displayed", "Parcel notes."],
    raw_properties: ["Backend/audit only", "Retains shapefile source attributes; not returned in current tax parcel view."],
    geom: ["Map geometry", "Spatial match and tax parcel overlay geometry."],
  },
  tax_bill_manifest: {
    bill_id: ["Displayed/used", "Bill card key and preview/download route key."],
    parcel_id: ["Indirect", "Joins bills to matched tax parcel rows."],
    bill_year: ["Displayed", "Bill year badge/meta."],
    file_name: ["Displayed", "Bill title/download filename."],
    extension: ["Displayed/used", "Previewability and file meta."],
    size_bytes: ["Displayed", "File size meta."],
    bill_relative_path: ["Backend only", "Server-side file resolution."],
    source_root_path: ["Backend/audit only", "Source root provenance."],
    source_file_path: ["Backend/audit only", "Source file provenance."],
  },
  comments: {
    id: ["Displayed/API key", "Comment list key."],
    question_area_id: ["Backend relationship", "Attaches comment to question area."],
    author_id: ["Backend relationship", "Joins to user for author name/role."],
    body: ["Displayed", "Comment text."],
    created_at: ["Displayed", "Comment timestamp."],
  },
  documents: {
    id: ["Displayed/API key", "Document list key and download route key."],
    question_area_id: ["Backend relationship", "Attaches uploaded document to question area."],
    original_name: ["Displayed", "Uploaded document name/download filename."],
    stored_name: ["Backend only", "Disk filename in backend/uploads."],
    mime_type: ["Displayed", "Document metadata."],
    size_bytes: ["Displayed", "Document metadata."],
    uploaded_by: ["Backend relationship", "Uploader user ID."],
    created_at: ["Displayed", "Upload timestamp."],
  },
  users: {
    id: ["Displayed/API key", "Admin user list key and session identity."],
    name: ["Displayed + editable", "Login/session name, comment author name, admin management."],
    email: ["Displayed + editable", "Login credential and admin management."],
    password_hash: ["Backend only", "Never returned to frontend."],
    role: ["Displayed + editable", "Permissions, badges, admin role assignment."],
    created_at: ["Displayed", "Admin member-since date."],
  },
  seed_metadata: {
    key: ["Backend only", "Startup validation metadata key."],
    value: ["Backend only", "Stored hash/fingerprint."],
    updated_at: ["Backend only", "Metadata update timestamp."],
  },
};

const columnMeaning = {
  geom: "PostGIS geometry column used for map rendering and/or spatial matching.",
  raw_properties: "Original source attributes retained as JSON for provenance and flexible map identify payloads.",
  created_at: "Creation timestamp.",
  updated_at: "Last update timestamp.",
  source_workbook_path: "Filesystem path to the workbook used for import provenance.",
  source_docs_root_path: "Filesystem path to the source document root used for provenance.",
  source_file_path: "Server-side source file path used for file resolution/provenance.",
  source_sheet: "Workbook sheet name used for import traceability.",
  source_row_number: "Workbook row number used for import traceability.",
};

function titleCase(value) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function cleanType(column) {
  if (column.data_type === "USER-DEFINED" && column.udt_name === "geometry") {
    return "geometry";
  }
  if (column.data_type === "ARRAY") {
    return `${column.udt_name}[]`;
  }
  return column.data_type;
}

function constraintSummary(table, columnName) {
  const hits = [];
  for (const constraint of table.constraints ?? []) {
    const def = constraint.definition ?? "";
    if (
      def.includes(`(${columnName})`) ||
      def.includes(`(${columnName},`) ||
      def.includes(`, ${columnName})`) ||
      def.includes(columnName)
    ) {
      hits.push(`${constraint.constraint_type}: ${constraint.constraint_name}`);
    }
  }
  return hits.join("; ");
}

function indexSummary(table, columnName) {
  const hits = [];
  for (const index of table.indexes ?? []) {
    const def = index.definition ?? "";
    if (def.includes(`(${columnName})`) || def.includes(` ${columnName} `) || def.includes(`${columnName} `) || def.includes(`${columnName})`)) {
      hits.push(index.index_name);
    }
  }
  return hits.join("; ");
}

function geometryInfo(tableName, columnName) {
  const match = (schemaSnapshot.geometry_columns ?? []).find(
    (entry) => entry.table_name === tableName && entry.column_name === columnName,
  );
  return match ? `${match.type}, SRID ${match.srid}` : "";
}

function usageFor(tableName, columnName) {
  const tableMap = frontendFields[tableName] ?? {};
  if (tableMap[columnName]) {
    return tableMap[columnName];
  }
  if (columnName in columnMeaning) {
    return ["Backend/audit", columnMeaning[columnName]];
  }
  return ["Not specifically surfaced", `${titleCase(columnName)} stored on ${tableName}; no direct frontend rendering found in the current code scan.`];
}

function tableRows(table) {
  return table.columns.map((column) => {
    const [frontend, note] = usageFor(table.table_name, column.column_name);
    return [
      column.ordinal_position,
      column.column_name,
      cleanType(column),
      column.is_nullable === "YES" ? "Yes" : "No",
      column.column_default ?? "",
      constraintSummary(table, column.column_name),
      indexSummary(table, column.column_name),
      geometryInfo(table.table_name, column.column_name),
      frontend,
      note,
    ];
  });
}

function setHeader(range) {
  range.format = {
    fill: "#1F4E79",
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
  };
}

function styleTitle(range) {
  range.format = {
    fill: "#D9EAF7",
    font: { bold: true, color: "#1F2937" },
  };
}

function styleSheet(sheet, usedRangeAddress) {
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(4);
  const used = sheet.getRange(usedRangeAddress);
  used.format.wrapText = true;
  used.format.autofitRows();
}

const workbook = Workbook.create();

const overview = workbook.worksheets.add("Overview");
overview.getRange("A1:H1").merge();
overview.getRange("A1").values = [["QAViewer Database Dictionary"]];
overview.getRange("A1").format = { fill: "#17324D", font: { bold: true, color: "#FFFFFF", size: 16 } };
overview.getRange("A2:H2").merge();
overview.getRange("A2").values = [[`Generated ${generatedAt} from the live local Postgres catalog plus current backend/frontend code paths.`]];
overview.getRange("A4:H4").values = [["Table", "Category", "Rows", "Columns", "Frontend exposure", "Editable surface", "Purpose", "Primary notes"]];
setHeader(overview.getRange("A4:H4"));
const summaryRows = schemaSnapshot.tables.map((table) => [
  table.table_name,
  tableCategory[table.table_name] ?? "Application table",
  Number(table.row_count ?? 0),
  table.columns.length,
  tableFrontend[table.table_name] ?? "Unknown",
  editableTables[table.table_name] ?? "Read-only or backend-managed in current app",
  tablePurpose[table.table_name] ?? "",
  (table.constraints ?? []).some((c) => c.constraint_type === "FOREIGN KEY")
    ? "Has hard foreign-key relationships"
    : (schemaSnapshot.geometry_columns ?? []).some((g) => g.table_name === table.table_name)
      ? "Spatial table"
      : "",
]);
overview.getRangeByIndexes(4, 0, summaryRows.length, 8).values = summaryRows;
overview.tables.add(`A4:H${4 + summaryRows.length}`, true, "OverviewTable");
overview.getRange("A:H").format.autofitColumns();
overview.getRange("G:G").format.columnWidthPx = 420;
overview.getRange("H:H").format.columnWidthPx = 220;
overview.freezePanes.freezeRows(4);
overview.showGridLines = false;

const legend = workbook.worksheets.add("Legend");
legend.getRange("A1:F1").merge();
legend.getRange("A1").values = [["How To Read This Workbook"]];
styleTitle(legend.getRange("A1"));
legend.getRange("A3:B10").values = [
  ["Column", "Meaning"],
  ["Frontend visibility", "Whether the field is directly visible, indirectly drives UI/API behavior, map-only, API-only, or backend-only."],
  ["API only", "The backend returns or uses the value, but the current frontend does not visibly render it."],
  ["Displayed", "The current frontend renders the value in a list, panel, badge, card, identify popup, export, or admin view."],
  ["Map geometry", "The frontend uses the field as GeoJSON geometry or the backend uses it for spatial matching."],
  ["Backend/audit only", "Used for import traceability, startup validation, file resolution, or internal joins."],
  ["Logical join", "Tables are related by code/API convention but no database foreign key enforces it."],
  ["Row counts", "Live counts from the running local Postgres container at generation time."],
];
setHeader(legend.getRange("A3:B3"));
legend.getRange("A:B").format.autofitColumns();
legend.getRange("B:B").format.columnWidthPx = 620;
legend.showGridLines = false;

const relSheet = workbook.worksheets.add("Relationship Map");
relSheet.getRange("A1:H1").merge();
relSheet.getRange("A1").values = [["QAViewer Table Relationships"]];
styleTitle(relSheet.getRange("A1"));
relSheet.getRange("A3:F3").values = [["From table", "From field", "To table", "To field", "Business meaning", "Enforcement"]];
setHeader(relSheet.getRange("A3:F3"));
relSheet.getRangeByIndexes(3, 0, relationships.length, 6).values = relationships;
relSheet.tables.add(`A3:F${3 + relationships.length}`, true, "RelationshipTable");
relSheet.getRange("H3").values = [["Mermaid Map"]];
setHeader(relSheet.getRange("H3:H3"));
relSheet.getRange("H4").values = [[
  [
    "erDiagram",
    "  USERS ||--o{ COMMENTS : authors",
    "  USERS ||--o{ DOCUMENTS : uploads",
    "  QUESTION_AREAS ||--o{ COMMENTS : has",
    "  QUESTION_AREAS ||--o{ DOCUMENTS : has",
    "  ATLAS_LAND_RECORDS ||--o{ ATLAS_DOCUMENT_LINKS : links",
    "  ATLAS_DOCUMENTS ||--o{ ATLAS_DOCUMENT_LINKS : referenced_by",
    "  ATLAS_DOCUMENTS ||--o| ATLAS_FEATURELESS_DOCS : may_be_featureless",
    "  ATLAS_DOCUMENTS ||--o{ ATLAS_DOCUMENT_MANIFEST : file_manifest",
    "  LAND_RECORDS ||..o{ ATLAS_LAND_RECORDS : hydrates_geometry_by_record_number",
    "  TAX_PARCELS ||..o{ TAX_BILL_MANIFEST : bills_by_parcel_id",
    "  QUESTION_AREAS }o..o{ ATLAS_LAND_RECORDS : spatial_buffer_match",
    "  QUESTION_AREAS }o..o{ TAX_PARCELS : spatial_buffer_match",
    "  QUESTION_AREAS }o..o{ LAND_RECORDS : map_context",
    "  QUESTION_AREAS }o..o{ MANAGEMENT_AREAS : map_context",
  ].join("\n"),
]];
relSheet.getRange("H4").format = { font: { name: "Consolas" }, wrapText: true };
relSheet.getRange("A:F").format.autofitColumns();
relSheet.getRange("E:E").format.columnWidthPx = 420;
relSheet.getRange("H:H").format.columnWidthPx = 520;
relSheet.getRange("H4").format.rowHeightPx = 300;
relSheet.freezePanes.freezeRows(3);
relSheet.showGridLines = false;

for (const table of schemaSnapshot.tables) {
  const sheet = workbook.worksheets.add(table.table_name.slice(0, 31));
  sheet.getRange("A1:J1").merge();
  sheet.getRange("A1").values = [[table.table_name]];
  sheet.getRange("A1").format = { fill: "#17324D", font: { bold: true, color: "#FFFFFF", size: 14 } };
  sheet.getRange("A2:J2").merge();
  sheet.getRange("A2").values = [[tablePurpose[table.table_name] ?? "Application database table."]];
  sheet.getRange("A3:J3").values = [[
    `Rows: ${Number(table.row_count ?? 0).toLocaleString()}`,
    `Columns: ${table.columns.length}`,
    tableFrontend[table.table_name] ?? "",
    editableTables[table.table_name] ?? "Read-only/backend-managed in current app",
    "",
    "",
    "",
    "",
    "",
    "",
  ]];
  sheet.getRange("A4:J4").values = [[
    "Ordinal",
    "Field",
    "Database Type",
    "Nullable",
    "Default",
    "Constraints / Keys",
    "Indexes",
    "Geometry Metadata",
    "Frontend Visibility",
    "Pertinent Notes",
  ]];
  setHeader(sheet.getRange("A4:J4"));
  const rows = tableRows(table);
  sheet.getRangeByIndexes(4, 0, rows.length, 10).values = rows;
  sheet.tables.add(`A4:J${4 + rows.length}`, true, `${table.table_name.replace(/[^A-Za-z0-9]/g, "_")}Table`.slice(0, 255));
  sheet.getRange("A:J").format.autofitColumns();
  sheet.getRange("A:A").format.columnWidthPx = 70;
  sheet.getRange("B:B").format.columnWidthPx = 185;
  sheet.getRange("C:C").format.columnWidthPx = 150;
  sheet.getRange("D:D").format.columnWidthPx = 80;
  sheet.getRange("E:E").format.columnWidthPx = 220;
  sheet.getRange("F:G").format.columnWidthPx = 240;
  sheet.getRange("H:H").format.columnWidthPx = 150;
  sheet.getRange("I:I").format.columnWidthPx = 175;
  sheet.getRange("J:J").format.columnWidthPx = 420;
  styleSheet(sheet, `A1:J${4 + rows.length}`);
}

const errorScan = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
});
console.log(errorScan.ndjson);

await fs.mkdir(outputDir, { recursive: true });
for (const sheet of ["Overview", "Relationship Map", ...schemaSnapshot.tables.map((table) => table.table_name.slice(0, 31))]) {
  const preview = await workbook.render({ sheetName: sheet, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(
    path.join(outputDir, `${sheet.replace(/[^A-Za-z0-9_-]/g, "_")}.png`),
    new Uint8Array(await preview.arrayBuffer()),
  );
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(path.join(outputDir, "QAViewer_Database_Dictionary.xlsx"));
