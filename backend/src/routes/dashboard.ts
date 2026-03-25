import { Router } from "express";

import { query } from "../lib/db.js";

const router = Router();

router.get("/summary", async (_req, res) => {
  const [statusCounts, severityCounts, questionAreas, comments, documents] = await Promise.all([
    query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text AS count FROM question_areas GROUP BY status ORDER BY status`,
    ),
    query<{ severity: string; count: string }>(
      `SELECT severity, COUNT(*)::text AS count FROM question_areas GROUP BY severity ORDER BY severity`,
    ),
    query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM question_areas`),
    query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM comments`),
    query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM documents`),
  ]);

  res.json({
    questionAreas: Number(questionAreas.rows[0]?.count ?? 0),
    comments: Number(comments.rows[0]?.count ?? 0),
    documents: Number(documents.rows[0]?.count ?? 0),
    statuses: Object.fromEntries(
      statusCounts.rows.map((row) => [row.status, Number(row.count)]),
    ),
    severities: Object.fromEntries(
      severityCounts.rows.map((row) => [row.severity, Number(row.count)]),
    ),
  });
});

router.get("/search", async (req, res) => {
  const rawQuery = String(req.query.q ?? "").trim();
  if (rawQuery.length < 2) {
    res.json({ results: [] });
    return;
  }

  const searchValue = `%${rawQuery}%`;
  const [questionAreas, parcels] = await Promise.all([
    query<{
      code: string;
      title: string;
      county: string | null;
      state: string | null;
      primary_parcel_code: string | null;
      source_group: string;
    }>(
      `
        SELECT code, title, county, state, primary_parcel_code, source_group
        FROM question_areas
        WHERE code ILIKE $1
           OR title ILIKE $1
           OR summary ILIKE $1
           OR COALESCE(primary_parcel_number, '') ILIKE $1
           OR COALESCE(primary_parcel_code, '') ILIKE $1
           OR COALESCE(primary_owner_name, '') ILIKE $1
           OR COALESCE(search_keywords, '') ILIKE $1
        ORDER BY code
        LIMIT 8
      `,
      [searchValue],
    ),
    query<{
      id: number;
      parcel_number: string | null;
      owner_name: string | null;
      county: string | null;
      state: string | null;
      question_area_code: string | null;
    }>(
      `
        SELECT
          p.id,
          p.parcel_number,
          p.owner_name,
          p.county,
          p.state,
          qa.code AS question_area_code
        FROM parcel_features p
        LEFT JOIN LATERAL (
          SELECT qa.code
          FROM question_areas qa
          WHERE (
            p.parcel_number IS NOT NULL
            AND qa.primary_parcel_number = p.parcel_number
            AND COALESCE(qa.county, '') = COALESCE(p.county, '')
            AND COALESCE(qa.state, '') = COALESCE(p.state, '')
          ) OR (
            p.ptv_parcel IS NOT NULL
            AND qa.primary_parcel_code = p.ptv_parcel
            AND COALESCE(qa.county, '') = COALESCE(p.county, '')
            AND COALESCE(qa.state, '') = COALESCE(p.state, '')
          )
          ORDER BY
            CASE
              WHEN p.parcel_number IS NOT NULL AND qa.primary_parcel_number = p.parcel_number THEN 0
              ELSE 1
            END,
            qa.code
          LIMIT 1
        ) qa ON true
        WHERE COALESCE(p.parcel_number, '') ILIKE $1
           OR COALESCE(p.owner_name, '') ILIKE $1
           OR COALESCE(p.county, '') ILIKE $1
           OR COALESCE(p.state, '') ILIKE $1
        ORDER BY p.parcel_number NULLS LAST
        LIMIT 8
      `,
      [searchValue],
    ),
  ]);

  res.json({
    results: [
      ...questionAreas.rows.map((row) => ({
        type: "question_area",
        id: row.code,
        label: row.title,
        subtitle: [row.primary_parcel_code, row.county, row.state].filter(Boolean).join(" | "),
        sourceGroup: row.source_group,
      })),
      ...parcels.rows.map((row) => ({
        type: "parcel",
        id: String(row.id),
        label: row.parcel_number ?? "Unnamed parcel",
        subtitle: [row.owner_name, row.county, row.state].filter(Boolean).join(" | "),
        questionAreaCode: row.question_area_code,
      })),
    ].slice(0, 10),
  });
});

export default router;
