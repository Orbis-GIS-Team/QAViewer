import { Router } from "express";

import { query } from "../lib/db.js";
import { parcelQuestionAreaJoin } from "../lib/parcelQuestionAreaMatch.js";
import { featureCollection, parseBbox } from "../lib/utils.js";

const router = Router();

const layerConfig = {
  primary_parcels: {
    table: "parcel_features",
    geometryExpression: "ST_AsGeoJSON(geom, 5)::jsonb",
    wherePrefix: "",
    orderBy: "id",
    limit: 6000,
  },
  parcel_points: {
    table: "parcel_points",
    geometryExpression: "ST_AsGeoJSON(geom, 5)::jsonb",
    wherePrefix: "",
    orderBy: "id",
    limit: 6000,
  },
  management_tracts: {
    table: "management_tracts",
    geometryExpression: "ST_AsGeoJSON(geom, 5)::jsonb",
    wherePrefix: "",
    orderBy: "id",
    limit: 3000,
  },
} as const;

router.get("/:layerKey/:id", async (req, res) => {
  const layerKey = String(req.params.layerKey) as keyof typeof layerConfig;
  const layer = layerConfig[layerKey];

  if (!layer) {
    res.status(404).json({ message: "Unknown layer." });
    return;
  }

  const featureId = Number(req.params.id);
  if (!Number.isInteger(featureId) || featureId <= 0) {
    res.status(400).json({ message: "Invalid feature id." });
    return;
  }

  if (layerKey === "primary_parcels") {
    const result = await query<{
      id: number;
      properties: Record<string, unknown>;
      geometry: object;
    }>(
      `
        SELECT
          p.id,
          p.raw_properties
            || jsonb_build_object('questionAreaCode', qa.code) AS properties,
          ST_AsGeoJSON(p.geom, 5)::jsonb AS geometry
        FROM parcel_features p
        ${parcelQuestionAreaJoin("p", "qa")}
        WHERE p.id = $1
        LIMIT 1
      `,
      [featureId],
    );

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ message: "Feature not found." });
      return;
    }

    res.json({
      type: "Feature",
      geometry: row.geometry,
      properties: {
        id: row.id,
        ...row.properties,
      },
    });
    return;
  }

  const result = await query<{ id: number; properties: Record<string, unknown>; geometry: object }>(
    `
      SELECT id, raw_properties AS properties, ${layer.geometryExpression} AS geometry
      FROM ${layer.table}
      WHERE id = $1
      LIMIT 1
    `,
    [featureId],
  );

  const row = result.rows[0];
  if (!row) {
    res.status(404).json({ message: "Feature not found." });
    return;
  }

  res.json({
    type: "Feature",
    geometry: row.geometry,
    properties: {
      id: row.id,
      ...row.properties,
    },
  });
});

router.get("/:layerKey", async (req, res) => {
  const layerKey = String(req.params.layerKey) as keyof typeof layerConfig;
  const layer = layerConfig[layerKey];

  if (!layer) {
    res.status(404).json({ message: "Unknown layer." });
    return;
  }

  const clauses: string[] = [];
  const params: number[] = [];

  if (layer.wherePrefix) {
    clauses.push(layer.wherePrefix);
  }

  const bbox = parseBbox(String(req.query.bbox ?? ""));
  if (bbox) {
    const [west, south, east, north] = bbox;
    params.push(west, south, east, north);
    const geometryColumn = layerKey === "primary_parcels" ? "p.geom" : "geom";
    clauses.push(
      `${geometryColumn} && ST_MakeEnvelope($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length}, 4326)`,
    );
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  if (layerKey === "primary_parcels") {
    const result = await query<{ id: number; properties: Record<string, unknown>; geometry: object }>(
      `
        SELECT
          p.id,
          p.raw_properties || jsonb_build_object('questionAreaCode', qa.code) AS properties,
          ST_AsGeoJSON(p.geom, 5)::jsonb AS geometry
        FROM parcel_features p
        ${parcelQuestionAreaJoin("p", "qa")}
        ${whereClause}
        ORDER BY ${layer.orderBy}
        LIMIT ${layer.limit}
      `,
      params,
    );

    res.json(
      featureCollection(
        result.rows.map((row) => ({
          type: "Feature",
          geometry: row.geometry as never,
          properties: {
            id: row.id,
            ...row.properties,
          },
        })),
      ),
    );
    return;
  }

  const result = await query<{ id: number; properties: Record<string, unknown>; geometry: object }>(
    `
      SELECT id, raw_properties AS properties, ${layer.geometryExpression} AS geometry
      FROM ${layer.table}
      ${whereClause}
      ORDER BY ${layer.orderBy}
      LIMIT ${layer.limit}
    `,
    params,
  );

  res.json(
    featureCollection(
      result.rows.map((row) => ({
        type: "Feature",
        geometry: row.geometry as never,
        properties: {
          id: row.id,
          ...row.properties,
        },
      })),
    ),
  );
});

export default router;
