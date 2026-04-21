import { Router } from "express";

import { query } from "../lib/db.js";
import { buildQuestionAreaSearchClause, parseSearchField } from "../lib/search.js";

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

  const searchField = parseSearchField(req.query.field);
  const searchValue = `%${rawQuery}%`;
  const questionAreas = await query<{
    code: string;
    title: string;
    county: string | null;
    state: string | null;
    parcel_code: string | null;
    property_name: string | null;
  }>(
    `
      SELECT qa.code, qa.title, qa.county, qa.state, qa.parcel_code, qa.property_name
      FROM question_areas qa
      WHERE ${buildQuestionAreaSearchClause("qa", "$1", searchField)}
      ORDER BY qa.code
      LIMIT 10
    `,
    [searchValue],
  );

  res.json({
    results: questionAreas.rows.map((row) => ({
      type: "question_area",
      id: row.code,
      label: row.title,
      subtitle: [row.parcel_code, row.property_name, row.county, row.state]
        .filter(Boolean)
        .join(" | "),
    })),
  });
});

export default router;
