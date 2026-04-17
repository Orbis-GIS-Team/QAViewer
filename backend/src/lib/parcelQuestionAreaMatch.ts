export function parcelQuestionAreaJoin(parcelAlias = "p", outputAlias = "qa") {
  return `
    LEFT JOIN LATERAL (
      SELECT match_qa.id, match_qa.code
      FROM question_areas match_qa
      WHERE (
        ${parcelAlias}.parcel_number IS NOT NULL
        AND match_qa.primary_parcel_number = ${parcelAlias}.parcel_number
        AND COALESCE(match_qa.county, '') = COALESCE(${parcelAlias}.county, '')
        AND COALESCE(match_qa.state, '') = COALESCE(${parcelAlias}.state, '')
      ) OR (
        ${parcelAlias}.ptv_parcel IS NOT NULL
        AND match_qa.primary_parcel_code = ${parcelAlias}.ptv_parcel
        AND COALESCE(match_qa.county, '') = COALESCE(${parcelAlias}.county, '')
        AND COALESCE(match_qa.state, '') = COALESCE(${parcelAlias}.state, '')
      )
      ORDER BY
        CASE
          WHEN ${parcelAlias}.parcel_number IS NOT NULL
            AND match_qa.primary_parcel_number = ${parcelAlias}.parcel_number
          THEN 0
          ELSE 1
        END,
        match_qa.code
      LIMIT 1
    ) ${outputAlias} ON true
  `;
}

export function questionAreaParcelJoin(questionAreaAlias = "qa", outputAlias = "linked_parcel") {
  return `
    LEFT JOIN LATERAL (
      SELECT match_p.id
      FROM parcel_features match_p
      WHERE (
        ${questionAreaAlias}.primary_parcel_number IS NOT NULL
        AND match_p.parcel_number = ${questionAreaAlias}.primary_parcel_number
        AND COALESCE(match_p.county, '') = COALESCE(${questionAreaAlias}.county, '')
        AND COALESCE(match_p.state, '') = COALESCE(${questionAreaAlias}.state, '')
      ) OR (
        ${questionAreaAlias}.primary_parcel_code IS NOT NULL
        AND match_p.ptv_parcel = ${questionAreaAlias}.primary_parcel_code
        AND COALESCE(match_p.county, '') = COALESCE(${questionAreaAlias}.county, '')
        AND COALESCE(match_p.state, '') = COALESCE(${questionAreaAlias}.state, '')
      )
      ORDER BY
        CASE
          WHEN ${questionAreaAlias}.primary_parcel_number IS NOT NULL
            AND match_p.parcel_number = ${questionAreaAlias}.primary_parcel_number
          THEN 0
          ELSE 1
        END,
        match_p.id
      LIMIT 1
    ) ${outputAlias} ON true
  `;
}
