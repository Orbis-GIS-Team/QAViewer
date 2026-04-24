import path from "node:path";

import { Router } from "express";

import { loadTaxBillAsset } from "../lib/taxParcels.js";

const router = Router();

router.get("/bills/:billId/content", async (req, res) => {
  const asset = await loadTaxBillAsset(req.params.billId);
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

router.get("/bills/:billId/download", async (req, res) => {
  const asset = await loadTaxBillAsset(req.params.billId);
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
