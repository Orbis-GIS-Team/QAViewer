import path from "node:path";

import { Router } from "express";

import {
  loadAtlasDocumentAsset,
  loadAtlasFeaturelessDocuments,
  loadAtlasImportReport,
} from "../lib/atlas.js";
import { requirePermission } from "../lib/rbac.js";

const router = Router();

router.use(requirePermission("atlas_land_records:read"));

router.get("/featureless-docs", async (_req, res) => {
  const documents = await loadAtlasFeaturelessDocuments();
  res.json({
    count: documents.length,
    documents,
  });
});

router.get("/import-report", async (req, res) => {
  const rawLimit = Number(req.query.limit ?? 200);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 200;
  const report = await loadAtlasImportReport(limit);
  res.json(report);
});

router.get("/documents/:documentNumber/content", async (req, res) => {
  const asset = await loadAtlasDocumentAsset(req.params.documentNumber);
  if (!asset) {
    res.status(404).json({ message: "Atlas document not found." });
    return;
  }

  if (!asset.packageRelativePath || !asset.filePath || !asset.hasFile) {
    res.status(404).json({ message: "Atlas document file is missing from package storage." });
    return;
  }

  if (!asset.isPreviewable || !asset.mimeType) {
    res.status(415).json({ message: "Inline preview is not supported for this Atlas document." });
    return;
  }

  const downloadName = asset.fileName ?? `${asset.documentNumber}${path.extname(asset.filePath)}`;
  res.type(asset.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${downloadName.replace(/"/g, '\\"')}"`);
  res.sendFile(asset.filePath);
});

router.get("/documents/:documentNumber/download", async (req, res) => {
  const asset = await loadAtlasDocumentAsset(req.params.documentNumber);
  if (!asset) {
    res.status(404).json({ message: "Atlas document not found." });
    return;
  }

  if (!asset.packageRelativePath || !asset.filePath || !asset.hasFile) {
    res.status(404).json({ message: "Atlas document file is missing from package storage." });
    return;
  }

  res.download(asset.filePath, asset.fileName ?? asset.documentNumber);
});

export default router;
