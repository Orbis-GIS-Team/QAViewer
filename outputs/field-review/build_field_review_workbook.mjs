import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "C:/dev/QAViewer/outputs/field-review";
const outputPath = path.join(outputDir, "qaviewer_ui_field_review.xlsx");

const publicTables = [
  ["public.users", 5, "App users and roles", "No"],
  ["public.question_areas", 77, "Main review items", "Sidebar"],
  ["public.seed_metadata", 3, "Runtime seed and validation metadata", "No"],
  ["public.land_records", 1316, "Land record overlay polygons", "Identify"],
  ["public.management_areas", 340, "Management overlay polygons", "Identify"],
  ["public.atlas_land_records", 1693, "Atlas support data", "No"],
  ["public.atlas_documents", 497, "Atlas document metadata", "No"],
  ["public.atlas_document_links", 2703, "Atlas LR to document links", "No"],
  ["public.atlas_featureless_docs", 0, "Atlas docs without geometry links", "No"],
  ["public.atlas_document_manifest", 497, "Atlas file manifest", "No"],
  ["public.atlas_import_rejects", 609, "Atlas import reject log", "No"],
  ["public.tax_parcels", 6, "Parcel polygon support layer", "No"],
  ["public.tax_bill_manifest", 8, "Tax bill file manifest", "No"],
  ["public.property_tax_parcel_points", 4606, "Parcel point support/search data", "No"],
  ["public.comments", 1, "Question-area comments", "No"],
  ["public.documents", 1, "Question-area document metadata", "No"],
  ["public.spatial_ref_sys", 8500, "PostGIS spatial reference system table", "No"],
];

const reviewColumns = [
  "UI Surface",
  "Table",
  "Field",
  "Data Type",
  "Shown Now",
  "Current Location",
  "Current Label",
  "Suggested Action",
  "Your Decision",
  "Target Location",
  "Priority",
  "Notes",
];

const questionAreaRows = [
  ["Question Area Sidebar", "question_areas", "title", "text", "Yes", "Identifying", "Title", "keep", "", "", "", "Primary name for the review item."],
  ["Question Area Sidebar", "question_areas", "summary", "text", "Yes", "Identifying", "Summary", "keep", "", "", "", "Short issue summary shown under the title."],
  ["Question Area Sidebar", "question_areas", "parcel_code", "text", "Yes", "Identifying", "Tax Parcel Code", "keep", "", "", "", "Stable parcel identifier."],
  ["Question Area Sidebar", "question_areas", "owner_name", "text", "Yes", "Identifying", "Record Owner", "keep", "", "", "", "Useful for quick confirmation."],
  ["Question Area Sidebar", "question_areas", "county", "text", "Yes", "Identifying", "County", "keep", "", "", "", "Geographic context."],
  ["Question Area Sidebar", "question_areas", "state", "text", "Yes", "Identifying", "State", "keep", "", "", "", "Geographic context."],
  ["Question Area Sidebar", "question_areas", "property_name", "text", "Yes", "Identifying", "Property", "keep", "", "", "", "Property grouping context."],
  ["Question Area Sidebar", "question_areas", "tract_name", "text", "Yes", "Identifying", "Tract", "review", "", "", "", "Keep if tract-level review matters."],
  ["Question Area Sidebar", "question_areas", "fund_name", "text", "Yes", "Identifying", "Fund", "review", "", "", "", "Potentially useful for internal users only."],
  ["Question Area Sidebar", "question_areas", "questionnaire_source", "text", "Yes", "Questionnaire", "Questionnaire Source", "move_to_advanced", "", "", "", "Source provenance, not core decision data."],
  ["Question Area Sidebar", "question_areas", "risk", "text", "Yes", "Questionnaire", "Risk", "keep", "", "", "", "Decision signal."],
  ["Question Area Sidebar", "question_areas", "latitude", "double precision", "Yes", "Questionnaire", "Latitude", "move_to_advanced", "", "", "", "Technical coordinate data."],
  ["Question Area Sidebar", "question_areas", "longitude", "double precision", "Yes", "Questionnaire", "Longitude", "move_to_advanced", "", "", "", "Technical coordinate data."],
  ["Question Area Sidebar", "question_areas", "tax_bill_acres", "double precision", "Yes", "Questionnaire", "Tax Bill Acres", "keep", "", "", "", "Core acreage comparison input."],
  ["Question Area Sidebar", "question_areas", "gis_acres", "double precision", "Yes", "Questionnaire", "GIS Acres", "keep", "", "", "", "Core acreage comparison input."],
  ["Question Area Sidebar", "question_areas", "land_services", "text", "Yes", "Questionnaire", "Land Services", "review", "", "", "", "May be useful if workflow depends on it."],
  ["Question Area Sidebar", "question_areas", "exists_in_legal_layer", "boolean", "Yes", "Questionnaire", "Legal/Deed Evidence", "keep", "", "", "", "Directly supports the mismatch decision."],
  ["Question Area Sidebar", "question_areas", "exists_in_management_layer", "boolean", "Yes", "Questionnaire", "Management Data", "keep", "", "", "", "Directly supports the mismatch decision."],
  ["Question Area Sidebar", "question_areas", "exists_in_client_tabular_bill_data", "boolean", "Yes", "Questionnaire", "In Client Bill Data", "keep", "", "", "", "Directly supports the mismatch decision."],
  ["Question Area Sidebar", "question_areas", "assigned_reviewer", "text", "Yes", "Questionnaire", "Assigned Reviewer", "keep_reviewer_only", "", "", "", "Useful for internal workflow, likely not for clients."],
  ["Question Area Sidebar", "question_areas", "spatial_overlay_notes", "text", "Yes", "Questionnaire", "Spatial Overlay Notes", "keep", "", "", "", "Core explanatory context."],
  ["Question Area Sidebar", "question_areas", "legal_description", "text", "Yes", "Questionnaire", "Legal Description", "keep_collapsed", "", "", "", "Keep, possibly as expandable long text."],
  ["Question Area Sidebar", "question_areas", "code", "text", "No", "Not shown", "", "promote_to_header", "", "", "", "Stable QA ID; good header candidate."],
  ["Question Area Sidebar", "question_areas", "status", "text", "No", "Edit controls only", "", "promote_to_header", "", "", "", "Workflow state should be visible at a glance."],
  ["Question Area Sidebar", "question_areas", "severity", "text", "No", "Edit controls only", "", "promote_to_header", "", "", "", "Priority signal; likely better as badge/chip."],
  ["Question Area Sidebar", "question_areas", "actionability_state", "text", "No", "Not shown", "", "promote_to_header", "", "", "", "Useful if it affects triage."],
  ["Question Area Sidebar", "question_areas", "description", "text", "No", "Edit controls only", "", "review_for_promotion", "", "", "", "Could become a review-notes section."],
  ["Question Area Sidebar", "question_areas", "source_layer", "text", "No", "Not shown", "", "hide", "", "", "", "Technical provenance."],
  ["Question Area Sidebar", "question_areas", "search_keywords", "text", "No", "Not shown", "", "hide", "", "", "", "Search support only."],
  ["Question Area Sidebar", "question_areas", "raw_properties", "jsonb", "No", "Not shown", "", "hide", "", "", "", "Raw import payload."],
  ["Question Area Sidebar", "question_areas", "geom", "geometry(Point,4326)", "No", "Map only", "", "hide", "", "", "", "Spatial object, not direct sidebar content."],
  ["Question Area Sidebar", "question_areas", "created_at", "timestamptz", "No", "Not shown", "", "hide", "", "", "", "Audit only."],
  ["Question Area Sidebar", "question_areas", "updated_at", "timestamptz", "No", "Not shown", "", "hide", "", "", "", "Audit only."],
  ["Question Area Sidebar", "question_areas", "id", "integer", "No", "Not shown", "", "hide", "", "", "", "Internal surrogate key."],
];

const landRecordRows = [
  ["Identify Widget", "land_records", "taxparcelnum", "varchar", "Yes", "Identifiers", "Tax Parcel Number", "keep", "", "", "", "Primary parcel identifier."],
  ["Identify Widget", "land_records", "lr_number", "varchar", "Yes", "Identifiers", "LR Number", "keep", "", "", "", "Primary land record identifier."],
  ["Identify Widget", "land_records", "docnumber", "varchar", "Yes", "Identifiers", "Document Number", "keep", "", "", "", "Links to source doc."],
  ["Identify Widget", "land_records", "current_owner", "varchar", "Yes", "Attributes", "Current Owner", "keep", "", "", "", "Useful for quick verification."],
  ["Identify Widget", "land_records", "previous_owner", "varchar", "Yes", "Attributes", "Previous Owner", "review", "", "", "", "May be useful, may be clutter."],
  ["Identify Widget", "land_records", "lr_type", "varchar", "Yes", "Attributes", "LR Type", "keep", "", "", "", "Record classification."],
  ["Identify Widget", "land_records", "doctype", "varchar", "Yes", "Attributes", "Document Type", "keep", "", "", "", "Source doc classification."],
  ["Identify Widget", "land_records", "lr_status", "varchar", "Yes", "Attributes", "LR Status", "keep", "", "", "", "Workflow status in support layer."],
  ["Identify Widget", "land_records", "tax_confirm", "varchar", "Yes", "Attributes", "Tax Confirmed", "review", "", "", "", "Potentially useful, but may be clutter."],
  ["Identify Widget", "land_records", "propertyname", "varchar", "Yes", "Context", "Property", "keep", "", "", "", "Core context."],
  ["Identify Widget", "land_records", "tractkey", "varchar", "Yes", "Context", "Tract Key", "keep", "", "", "", "Core context."],
  ["Identify Widget", "land_records", "fundname", "varchar", "Yes", "Context", "Fund", "review", "", "", "", "Internal context, maybe role-specific."],
  ["Identify Widget", "land_records", "county", "varchar", "Yes", "Context", "County", "keep", "", "", "", "Core context."],
  ["Identify Widget", "land_records", "state", "varchar", "Yes", "Context", "State", "keep", "", "", "", "Core context."],
  ["Identify Widget", "land_records", "regionname", "varchar", "Yes", "Context", "Region", "review", "", "", "", "May be lower value than county/state."],
  ["Identify Widget", "land_records", "deedacres", "varchar", "Yes", "Context", "Deed Acres", "keep", "", "", "", "Acreage comparison input."],
  ["Identify Widget", "land_records", "gisacres", "double precision", "Yes", "Context", "GIS Acres", "keep", "", "", "", "Acreage comparison input."],
  ["Identify Widget", "land_records", "l_desc", "varchar", "No", "Not shown", "", "review_for_promotion", "", "", "", "Possible richer context field."],
  ["Identify Widget", "land_records", "remark", "varchar", "No", "Not shown", "", "review_for_promotion", "", "", "", "Possible richer context field."],
  ["Identify Widget", "land_records", "keyword", "varchar", "No", "Not shown", "", "review_for_promotion", "", "", "", "Possible richer context field."],
  ["Identify Widget", "land_records", "docname", "varchar", "No", "Not shown", "", "review_for_promotion", "", "", "", "Could be useful if document names are meaningful."],
  ["Identify Widget", "land_records", "lr_specs", "varchar", "No", "Not shown", "", "review_for_promotion", "", "", "", "Potential advanced detail."],
  ["Identify Widget", "land_records", "objectid", "integer", "No", "Not shown", "", "hide", "", "", "", "Internal GIS id."],
  ["Identify Widget", "land_records", "fips", "varchar", "No", "Not shown", "", "hide", "", "", "", "Likely too technical for default identify."],
  ["Identify Widget", "land_records", "source", "varchar", "No", "Not shown", "", "hide", "", "", "", "Provenance only."],
  ["Identify Widget", "land_records", "sourcepageno", "varchar", "No", "Not shown", "", "hide", "", "", "", "Provenance only."],
  ["Identify Widget", "land_records", "acq_date", "varchar", "No", "Not shown", "", "hide", "", "", "", "Not currently part of identify workflow."],
  ["Identify Widget", "land_records", "desc_type", "varchar", "No", "Not shown", "", "hide", "", "", "", "Lower-value technical descriptor."],
  ["Identify Widget", "land_records", "trs", "varchar", "No", "Not shown", "", "hide", "", "", "", "Technical location field."],
  ["Identify Widget", "land_records", "merge_src", "varchar", "No", "Not shown", "", "hide", "", "", "", "ETL lineage only."],
  ["Identify Widget", "land_records", "oldlrnum", "varchar", "No", "Not shown", "", "hide", "", "", "", "Legacy reference id."],
  ["Identify Widget", "land_records", "shape_length", "double precision", "No", "Not shown", "", "hide", "", "", "", "Geometry metric."],
  ["Identify Widget", "land_records", "shape_area", "double precision", "No", "Not shown", "", "hide", "", "", "", "Geometry metric."],
  ["Identify Widget", "land_records", "geom", "geometry(MultiPolygon,4326)", "No", "Map only", "", "hide", "", "", "", "Spatial object."],
];

const managementRows = [
  ["Identify Widget", "management_areas", "property_code", "text", "Yes", "Identifiers", "Property Code", "keep", "", "", "", "Primary property identifier."],
  ["Identify Widget", "management_areas", "property_name", "text", "Yes", "Identifiers", "Property", "keep", "", "", "", "Primary property name."],
  ["Identify Widget", "management_areas", "portfolio", "text", "Yes", "Identifiers", "Portfolio", "keep", "", "", "", "Useful grouping context."],
  ["Identify Widget", "management_areas", "status", "text", "Yes", "Attributes", "Status", "keep", "", "", "", "Useful current-state context."],
  ["Identify Widget", "management_areas", "fund_name", "text", "Yes", "Attributes", "Fund", "review", "", "", "", "May be lower value for some users."],
  ["Identify Widget", "management_areas", "management_type", "text", "Yes", "Attributes", "Management Type", "keep", "", "", "", "Useful classification."],
  ["Identify Widget", "management_areas", "investment_manager", "text", "Yes", "Attributes", "Investment Manager", "review", "", "", "", "Potentially role-specific."],
  ["Identify Widget", "management_areas", "business_unit", "text", "Yes", "Attributes", "Business Unit", "review", "", "", "", "Potentially role-specific."],
  ["Identify Widget", "management_areas", "crops", "text", "Yes", "Attributes", "Crops", "review", "", "", "", "May matter only for some properties."],
  ["Identify Widget", "management_areas", "county", "text", "Yes", "Context", "County", "keep", "", "", "", "Core context."],
  ["Identify Widget", "management_areas", "state", "text", "Yes", "Context", "State", "keep", "", "", "", "Core context."],
  ["Identify Widget", "management_areas", "region", "text", "Yes", "Context", "Region", "keep", "", "", "", "Useful regional context."],
  ["Identify Widget", "management_areas", "country", "text", "Yes", "Context", "Country", "keep", "", "", "", "Useful context in mixed geographies."],
  ["Identify Widget", "management_areas", "gross_acres", "double precision", "Yes", "Context", "Gross Acres", "keep", "", "", "", "Acreage context."],
  ["Identify Widget", "management_areas", "tillable_acres", "double precision", "Yes", "Context", "Tillable Acres", "review", "", "", "", "Potentially useful but maybe secondary."],
  ["Identify Widget", "management_areas", "gis_acres", "double precision", "Yes", "Context", "GIS Acres", "keep", "", "", "", "Acreage context."],
  ["Identify Widget", "management_areas", "effective_date", "text", "Yes", "Context", "Effective Date", "review", "", "", "", "May matter if users care about currentness."],
  ["Identify Widget", "management_areas", "original_acquisition_date", "text", "No", "Not shown", "", "review_for_promotion", "", "", "", "Candidate if acquisition timing matters."],
  ["Identify Widget", "management_areas", "full_disposition_date", "text", "No", "Not shown", "", "review_for_promotion", "", "", "", "Candidate if disposition timing matters."],
  ["Identify Widget", "management_areas", "id", "integer", "No", "Not shown", "", "hide", "", "", "", "Internal surrogate key."],
  ["Identify Widget", "management_areas", "property_coordinates", "text", "No", "Not shown", "", "hide", "", "", "", "Technical source field."],
  ["Identify Widget", "management_areas", "arable_hectares", "double precision", "No", "Not shown", "", "hide", "", "", "", "Likely redundant with acre fields."],
  ["Identify Widget", "management_areas", "gross_hectares", "double precision", "No", "Not shown", "", "hide", "", "", "", "Likely redundant with acre fields."],
  ["Identify Widget", "management_areas", "gis_hectares", "double precision", "No", "Not shown", "", "hide", "", "", "", "Likely redundant with acre fields."],
  ["Identify Widget", "management_areas", "raw_properties", "jsonb", "No", "Not shown", "", "hide", "", "", "", "Raw import payload."],
  ["Identify Widget", "management_areas", "geom", "geometry(MultiPolygon,4326)", "No", "Map only", "", "hide", "", "", "", "Spatial object."],
];

const propertyTaxPointRows = [
  ["Identify Widget", "property_tax_parcel_points", "id", "integer", "Yes", "Workbook Data", "Id", "hide", "", "", "", "Currently shown due to generic rendering, but likely internal-only."],
  ["Identify Widget", "property_tax_parcel_points", "parcelCode", "text", "Yes", "Workbook Data", "Parcel Code", "keep", "", "", "", "Primary parcel identifier."],
  ["Identify Widget", "property_tax_parcel_points", "accountNumber", "text", "Yes", "Workbook Data", "Account Number", "keep", "", "", "", "Useful tax/account identifier."],
  ["Identify Widget", "property_tax_parcel_points", "gisAcres", "double precision", "Yes", "Workbook Data", "GIS Acres", "keep", "", "", "", "Acreage context."],
  ["Identify Widget", "property_tax_parcel_points", "state", "text", "Yes", "Workbook Data", "State", "keep", "", "", "", "Core context."],
  ["Identify Widget", "property_tax_parcel_points", "county", "text", "Yes", "Workbook Data", "County", "keep", "", "", "", "Core context."],
  ["Identify Widget", "property_tax_parcel_points", "propertyName", "text", "Yes", "Workbook Data", "Property Name", "keep", "", "", "", "Property grouping context."],
  ["Identify Widget", "property_tax_parcel_points", "tractName", "text", "Yes", "Workbook Data", "Tract Name", "review", "", "", "", "Keep if tract-level context helps reviewers."],
  ["Identify Widget", "property_tax_parcel_points", "parcelStatus", "text", "Yes", "Workbook Data", "Parcel Status", "review", "", "", "", "Potentially useful, may be noise."],
  ["Identify Widget", "property_tax_parcel_points", "taxProgram", "text", "Yes", "Workbook Data", "Tax Program", "review", "", "", "", "Likely role-specific."],
  ["Identify Widget", "property_tax_parcel_points", "exemptionEnrollmentDate", "text", "Yes", "Workbook Data", "Exemption Enrollment Date", "move_to_advanced", "", "", "", "Detailed tax-program timing field."],
  ["Identify Widget", "property_tax_parcel_points", "exemptionExpirationDate", "text", "Yes", "Workbook Data", "Exemption Expiration Date", "move_to_advanced", "", "", "", "Detailed tax-program timing field."],
  ["Identify Widget", "property_tax_parcel_points", "exemptionEligibilityDate", "text", "Yes", "Workbook Data", "Exemption Eligibility Date", "move_to_advanced", "", "", "", "Detailed tax-program timing field."],
  ["Identify Widget", "property_tax_parcel_points", "ownershipType", "text", "Yes", "Workbook Data", "Ownership Type", "review", "", "", "", "May be useful, but not always primary."],
  ["Identify Widget", "property_tax_parcel_points", "purchaseDate", "text", "Yes", "Workbook Data", "Purchase Date", "move_to_advanced", "", "", "", "Date detail, likely secondary."],
  ["Identify Widget", "property_tax_parcel_points", "ownerName", "text", "Yes", "Workbook Data", "Owner Name", "keep", "", "", "", "Core verification field."],
  ["Identify Widget", "property_tax_parcel_points", "description", "text", "Yes", "Workbook Data", "Description", "review_for_promotion", "", "", "", "May be useful explanatory context."],
  ["Identify Widget", "property_tax_parcel_points", "fipParcelId", "text", "Yes", "Workbook Data", "Fip Parcel Id", "review", "", "", "", "Useful if this is a key operational identifier."],
  ["Identify Widget", "property_tax_parcel_points", "notes", "text", "Yes", "Workbook Data", "Notes", "keep_collapsed", "", "", "", "Potentially useful long text, maybe collapsed."],
  ["Identify Widget", "property_tax_parcel_points", "landUseType", "text", "Yes", "Workbook Data", "Land Use Type", "review", "", "", "", "Possibly useful, but secondary."],
  ["Identify Widget", "property_tax_parcel_points", "latitude", "double precision", "Yes", "Workbook Data", "Latitude", "move_to_advanced", "", "", "", "Technical coordinate field."],
  ["Identify Widget", "property_tax_parcel_points", "longitude", "double precision", "Yes", "Workbook Data", "Longitude", "move_to_advanced", "", "", "", "Technical coordinate field."],
  ["Identify Widget", "property_tax_parcel_points", "coordinateStatus", "text", "Yes", "Workbook Data", "Coordinate Status", "move_to_advanced", "", "", "", "Technical data-quality field."],
  ["Identify Widget", "property_tax_parcel_points", "sourceWorkbookPath", "text", "Yes", "Workbook Data", "Source Workbook Path", "move_to_advanced", "", "", "", "Provenance/debug field."],
  ["Identify Widget", "property_tax_parcel_points", "sourceSheet", "text", "No", "Not shown", "", "review_for_promotion", "", "", "", "Not currently shown because of the 24-row cap."],
  ["Identify Widget", "property_tax_parcel_points", "sourceRowNumber", "integer", "No", "Not shown", "", "review_for_promotion", "", "", "", "Not currently shown because of the 24-row cap."],
  ["Identify Widget", "property_tax_parcel_points", "rawProperties", "jsonb", "No", "Not shown", "", "hide", "", "", "", "Raw import payload."],
  ["Identify Widget", "property_tax_parcel_points", "geometry", "point", "No", "Not shown", "", "hide", "", "", "", "Spatial object detail."],
];

function writeSheet(workbook, name, title, subtitle, columns, rows) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = true;

  sheet.getRange("A1").values = [[title]];
  sheet.getRange("A2").values = [[subtitle]];
  sheet.getRange(`A4:${columnLetter(columns.length)}4`).values = [columns];
  sheet.getRange(`A5:${columnLetter(columns.length)}${rows.length + 4}`).values = rows;

  sheet.getRange("A1").format = {
    font: { name: "Calibri", size: 16, bold: true, color: "#0F172A" },
  };
  sheet.getRange("A2").format = {
    font: { name: "Calibri", size: 11, color: "#475569", italic: true },
  };
  sheet.getRange(`A4:${columnLetter(columns.length)}4`).format = {
    fill: { type: "solid", color: "#1D4ED8" },
    font: { name: "Calibri", size: 11, bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: "#93C5FD" },
  };
  sheet.getRange(`A5:${columnLetter(columns.length)}${rows.length + 4}`).format = {
    font: { name: "Calibri", size: 10, color: "#0F172A" },
    verticalAlignment: "top",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: "#CBD5E1" },
  };

  sheet.freezePanes.freezeRows(4);
  sheet.getUsedRange().format.autofitColumns();
  sheet.getUsedRange().format.autofitRows();
  return sheet;
}

function columnLetter(count) {
  let n = count;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

const workbook = Workbook.create();

async function saveBlob(blob, filePath) {
  const buffer = Buffer.from(await blob.arrayBuffer());
  await fs.writeFile(filePath, buffer);
}

const overview = workbook.worksheets.add("Overview");
overview.getRange("A1").values = [["QAViewer UI Field Review Workbook"]];
overview.getRange("A2").values = [[
  "Use this workbook to decide which fields should stay visible, move to advanced, be promoted, or be hidden from the current UI.",
]];
overview.getRange("A4:B10").values = [
  ["Column", "How to use it"],
  ["Suggested Action", "Starting recommendation based on current code and review workflow."],
  ["Your Decision", "Enter your final decision: keep, hide, move_to_advanced, promote, reviewer_only, or other."],
  ["Target Location", "Example: header, identifying, questionnaire, advanced, identify-identifiers, identify-context."],
  ["Priority", "Example: now, later, optional."],
  ["Notes", "Use for exceptions, role rules, label changes, or ordering comments."],
  ["Return Workflow", "Send the edited workbook back and I can implement the UI from it."],
];
overview.getRange("D4:E11").values = [
  ["Schema / Source", "Notes"],
  ["Live database", "Supabase project QAViewer Dev, queried on 2026-05-20."],
  ["Current sidebar code", "frontend/src/components/MapWorkspace.tsx"],
  ["Current identify code", "frontend/src/components/MapWorkspace.tsx"],
  ["Public table count", "17"],
  ["Total database table count", "53"],
  ["Best focus first", "question_areas, land_records, management_areas"],
  ["Reminder", "This workbook is for UI visibility decisions, not schema deletion."],
];
overview.getRange("A1").format = {
  font: { name: "Calibri", size: 18, bold: true, color: "#0F172A" },
};
overview.getRange("A2").format = {
  font: { name: "Calibri", size: 11, color: "#475569" },
  wrapText: true,
};
overview.getRange("A4:B10").format = {
  borders: { preset: "outside", style: "thin", color: "#CBD5E1" },
  wrapText: true,
};
overview.getRange("D4:E11").format = {
  borders: { preset: "outside", style: "thin", color: "#CBD5E1" },
  wrapText: true,
};
overview.getRange("A4:B4").format = {
  fill: { type: "solid", color: "#1D4ED8" },
  font: { name: "Calibri", size: 11, bold: true, color: "#FFFFFF" },
};
overview.getRange("D4:E4").format = {
  fill: { type: "solid", color: "#0F766E" },
  font: { name: "Calibri", size: 11, bold: true, color: "#FFFFFF" },
};
overview.freezePanes.freezeRows(3);
overview.getUsedRange().format.autofitColumns();
overview.getUsedRange().format.autofitRows();

writeSheet(
  workbook,
  "Public Tables",
  "Public Schema Table Inventory",
  "Reference inventory of the live QAViewer public schema and whether each table is part of the current UI.",
  ["Table", "Row Count", "Purpose", "Current UI Surface"],
  publicTables,
);

writeSheet(
  workbook,
  "Question Areas",
  "Question Area Sidebar Review",
  "Review every question_areas field for the current details sidebar. Focus on what should be visible by default.",
  reviewColumns,
  questionAreaRows,
);

writeSheet(
  workbook,
  "Land Records",
  "Land Records Identify Review",
  "Review every land_records field for the current identify widget.",
  reviewColumns,
  landRecordRows,
);

writeSheet(
  workbook,
  "Management Areas",
  "Management Areas Identify Review",
  "Review every management_areas field for the current identify widget.",
  reviewColumns,
  managementRows,
);

writeSheet(
  workbook,
  "Tax Points",
  "Property Tax Points Identify Review",
  "Review every property_tax_parcel_points field for the workbook-match section of the identify widget.",
  reviewColumns,
  propertyTaxPointRows,
);

await fs.mkdir(outputDir, { recursive: true });
const previewRange = "A1:L18";
await workbook.inspect({
  kind: "table",
  range: "Question Areas!A1:L18",
  include: "values",
  tableMaxRows: 18,
  tableMaxCols: 12,
  summary: "Question areas review preview",
});
const overviewPreview = await workbook.render({ sheetName: "Overview", range: "A1:E11", format: "png" });
await saveBlob(overviewPreview, path.join(outputDir, "qaviewer_ui_field_review_overview.png"));
const questionAreaPreview = await workbook.render({ sheetName: "Question Areas", range: previewRange, format: "png" });
await saveBlob(questionAreaPreview, path.join(outputDir, "qaviewer_ui_field_review_question_areas.png"));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

console.log(JSON.stringify({ outputPath }));
