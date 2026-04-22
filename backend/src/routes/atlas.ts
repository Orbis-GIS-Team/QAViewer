import path from "node:path";

import { Router } from "express";

import { loadAtlasDocumentAsset } from "../lib/atlas.js";

const router = Router();

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
