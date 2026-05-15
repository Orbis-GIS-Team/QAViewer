import path from "node:path";

import { Router } from "express";

import { loadTaxBillAsset } from "../lib/taxParcels.js";
import {
  identifyRegridParcelAtPoint,
  loadPropertyTaxParcelPoint,
  loadPropertyTaxParcelPointCollection,
  loadRegridParcelFabricCollection,
  loadRegridParcelCollection,
  normalizePropertyTaxRegridMinZoom,
} from "../lib/propertyTaxParcelPoints.js";
import { requirePermission } from "../lib/rbac.js";
import { parseBbox } from "../lib/utils.js";

const router = Router();

router.get("/points", requirePermission("property_tax_map:read"), async (req, res) => {
  const bboxValue = req.query.bbox;
  const bbox = typeof bboxValue === "string" ? parseBbox(bboxValue) : null;
  if (bboxValue !== undefined && !bbox) {
    res.status(400).json({ message: "Invalid bbox. Expected west,south,east,north." });
    return;
  }

  const collection = await loadPropertyTaxParcelPointCollection(bbox);
  res.json(collection);
});

router.get("/points/:id", requirePermission("property_tax_map:read"), async (req, res) => {
  const pointId = Number(req.params.id);
  if (!Number.isInteger(pointId) || pointId <= 0) {
    res.status(400).json({ message: "Invalid property tax parcel point id." });
    return;
  }

  const point = await loadPropertyTaxParcelPoint(pointId);
  if (!point) {
    res.status(404).json({ message: "Property tax parcel point not found." });
    return;
  }

  res.json(point);
});

router.get("/regrid-parcels", requirePermission("property_tax_map:read"), async (req, res) => {
  const bbox = typeof req.query.bbox === "string" ? parseBbox(req.query.bbox) : null;
  if (!bbox) {
    res.status(400).json({ message: "Invalid bbox. Expected west,south,east,north." });
    return;
  }

  const zoom = Number(req.query.zoom);
  if (!Number.isFinite(zoom)) {
    res.status(400).json({ message: "Invalid zoom." });
    return;
  }

  try {
    const collection = await loadRegridParcelCollection(bbox, zoom);
    const features = req.query.matchedOnly === "true"
      ? collection.features.filter((feature) => Boolean(feature.properties?.isMatched))
      : collection.features;
    res.json({
      ...collection,
      features,
      metadata: {
        minZoom: normalizePropertyTaxRegridMinZoom(),
      },
    });
  } catch (error) {
    res.status(503).json({
      message: error instanceof Error ? error.message : "Failed to load Regrid parcels.",
    });
  }
});

// Debug compatibility path only. The visible Regrid parcel fabric is rendered
// by a real FeatureServer-backed browser map layer, not this GeoJSON endpoint.
router.get("/regrid-parcels/query", requirePermission("property_tax:read"), async (req, res) => {
  const bbox = typeof req.query.bbox === "string" ? parseBbox(req.query.bbox) : null;
  if (!bbox) {
    res.status(400).json({ message: "Invalid bbox. Expected west,south,east,north." });
    return;
  }

  const zoom = Number(req.query.zoom);
  if (!Number.isFinite(zoom)) {
    res.status(400).json({ message: "Invalid zoom." });
    return;
  }

  try {
    const collection = await loadRegridParcelFabricCollection(bbox, zoom);
    res.json({
      ...collection,
      metadata: {
        minZoom: normalizePropertyTaxRegridMinZoom(),
        enriched: false,
      },
    });
  } catch (error) {
    res.status(503).json({
      message: error instanceof Error ? error.message : "Failed to load Regrid parcel fabric.",
    });
  }
});

router.post("/regrid-identify", requirePermission("property_tax_map:read"), async (req, res) => {
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    res.status(400).json({ message: "A valid latitude and longitude are required." });
    return;
  }

  try {
    const result = await identifyRegridParcelAtPoint(latitude, longitude);
    res.json(result);
  } catch (error) {
    res.status(503).json({
      message: error instanceof Error ? error.message : "Failed to identify Regrid parcel.",
    });
  }
});

router.get("/bills/:billId/content", requirePermission("property_tax:read"), async (req, res) => {
  const billId = String(req.params.billId);
  const asset = await loadTaxBillAsset(billId);
  if (!asset) {
    res.status(404).json({ message: "Tax bill not found." });
    return;
  }

  if (!asset.filePath || !asset.hasFile) {
    res.status(404).json({ message: "Tax bill file is missing from package storage." });
    return;
  }

  if (!asset.isPreviewable || !asset.mimeType) {
    res.status(415).json({ message: "Inline preview is not supported for this tax bill." });
    return;
  }

  const downloadName = asset.filename || `${asset.billId}${path.extname(asset.filePath)}`;
  res.type(asset.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${downloadName.replace(/"/g, '\\"')}"`);
  res.sendFile(asset.filePath);
});

router.get("/bills/:billId/download", requirePermission("property_tax:read"), async (req, res) => {
  const billId = String(req.params.billId);
  const asset = await loadTaxBillAsset(billId);
  if (!asset) {
    res.status(404).json({ message: "Tax bill not found." });
    return;
  }

  if (!asset.filePath || !asset.hasFile) {
    res.status(404).json({ message: "Tax bill file is missing from package storage." });
    return;
  }

  res.download(asset.filePath, asset.filename || asset.billId);
});

export default router;
