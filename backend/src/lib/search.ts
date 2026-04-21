export const SEARCH_FIELDS = ["all", "parcel_code", "county", "qa_id"] as const;

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
    case "parcel_code":
      return `
        COALESCE(${alias}.parcel_code, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.property_name, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.owner_name, '') ILIKE ${placeholder}
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
        OR COALESCE(${alias}.parcel_code, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.owner_name, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.property_name, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.tract_name, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.fund_name, '') ILIKE ${placeholder}
        OR COALESCE(${alias}.search_keywords, '') ILIKE ${placeholder}
      `;
  }
}
