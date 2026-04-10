export const SEARCH_FIELDS = ["all", "parcelnumb", "county", "qa_id"] as const;

export type SearchField = (typeof SEARCH_FIELDS)[number];

export function parseSearchField(value: unknown): SearchField {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (SEARCH_FIELDS.includes(normalized as SearchField)) {
    return normalized as SearchField;
  }
  return "all";
}

export function buildQuestionAreaSearchClause(
  alias: string,
  placeholder: string,
  field: SearchField,
): string {
  switch (field) {
    case "qa_id":
      return `${alias}.code ILIKE ${placeholder}`;
    case "parcelnumb":
      return `
        COALESCE(${alias}.primary_parcel_number, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.primary_parcel_code, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.related_parcels::text, '') ILIKE ${placeholder}
      `;
    case "county":
      return `
        COALESCE(${alias}.county, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.state, '') ILIKE ${placeholder}
      `;
    case "all":
    default:
      return `
        ${alias}.code ILIKE ${placeholder}
        OR ${alias}.title ILIKE ${placeholder}
        OR ${alias}.summary ILIKE ${placeholder}
        OR COALESCE(${alias}.county, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.state, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.primary_parcel_number, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.primary_parcel_code, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.primary_owner_name, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.property_name, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.analysis_name, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.tract_name, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.search_keywords, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.related_parcels::text, '') ILIKE ${placeholder}
      `;
  }
}

export function buildParcelSearchClause(
  parcelAlias: string,
  questionAreaAlias: string,
  placeholder: string,
  field: SearchField,
): string {
  switch (field) {
    case "qa_id":
      return `COALESCE(${questionAreaAlias}.code, '') ILIKE ${placeholder}`;
    case "parcelnumb":
      return `
        COALESCE(${parcelAlias}.parcel_number, '') ILIKE ${placeholder}
        OR COALESCE(${parcelAlias}.ptv_parcel, '') ILIKE ${placeholder}
      `;
    case "county":
      return `
        COALESCE(${parcelAlias}.county, '') ILIKE ${placeholder}
        OR COALESCE(${parcelAlias}.state, '') ILIKE ${placeholder}
      `;
    case "all":
    default:
      return `
        COALESCE(${parcelAlias}.parcel_number, '') ILIKE ${placeholder}
        OR COALESCE(${parcelAlias}.ptv_parcel, '') ILIKE ${placeholder}
        OR COALESCE(${parcelAlias}.owner_name, '') ILIKE ${placeholder}
        OR COALESCE(${parcelAlias}.property_name, '') ILIKE ${placeholder}
        OR COALESCE(${parcelAlias}.analysis_name, '') ILIKE ${placeholder}
        OR COALESCE(${parcelAlias}.tract_name, '') ILIKE ${placeholder}
        OR COALESCE(${parcelAlias}.county, '') ILIKE ${placeholder}
        OR COALESCE(${parcelAlias}.state, '') ILIKE ${placeholder}
        OR COALESCE(${questionAreaAlias}.code, '') ILIKE ${placeholder}
      `;
  }
}
