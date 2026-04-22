import { useEffect, useState } from "react";

import type { Geometry } from "geojson";

import { apiRequest } from "./api";

export const ATLAS_BUFFER_OPTIONS = [100, 500, 1000, 5000] as const;

export type AtlasBufferFeet = (typeof ATLAS_BUFFER_OPTIONS)[number];

export type AtlasTarget = {
  code: string;
  title: string | null;
  summary: string | null;
  parcelCode: string | null;
  county: string | null;
  state: string | null;
};

export type AtlasDocument = {
  documentNumber: string | null;
  docName: string | null;
  docType: string | null;
  pageNo: number | null;
  packageRelativePath: string | null;
  fileName: string | null;
  extension: string | null;
  sizeBytes: number | null;
  hasFile: boolean;
  isPreviewable: boolean;
  contentUrl: string | null;
  downloadUrl: string | null;
};

export type AtlasRecord = {
  lrNumber: string | null;
  tractKey: string | null;
  propertyName: string | null;
  fundName: string | null;
  regionName: string | null;
  lrType: string | null;
  lrStatus: string | null;
  acqDate: string | null;
  taxParcelNumber: string | null;
  gisAcres: number | null;
  deedAcres: number | null;
  township: string | null;
  range: string | null;
  section: string | null;
  fips: string | null;
  remark: string | null;
  primaryDocumentNumber: string | null;
  geometry: Geometry | null;
  documents: AtlasDocument[];
};

export type AtlasWarning = {
  code: string | null;
  message: string | null;
  severity: string | null;
  lrNumber: string | null;
  documentNumber: string | null;
};

export type AtlasQueryResult = {
  questionAreaCode: string | null;
  bufferValue: number | null;
  bufferUnit: string | null;
  bufferGeometry: Geometry | null;
  matchedRecordCount: number;
  linkedDocumentCount: number;
  records: AtlasRecord[];
  warnings: AtlasWarning[];
};

export type AtlasQueryState = {
  result: AtlasQueryResult | null;
  loading: boolean;
  error: string | null;
};

export function useAtlasQuery({
  token,
  questionAreaCode,
  bufferFeet,
}: {
  token: string;
  questionAreaCode: string | null;
  bufferFeet: AtlasBufferFeet;
}): AtlasQueryState {
  const [result, setResult] = useState<AtlasQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!questionAreaCode) {
      setResult(null);
      setLoading(false);
      setError(null);
      return;
    }

    let alive = true;
    setLoading(true);
    setError(null);
    setResult(null);

    const params = new URLSearchParams({
      buffer: String(bufferFeet),
      unit: "feet",
    });

    apiRequest<AtlasQueryResult>(
      `/question-areas/${encodeURIComponent(questionAreaCode)}/atlas?${params.toString()}`,
      { token },
    )
      .then((payload) => {
        if (alive) {
          setResult(normalizeAtlasQueryResult(payload));
        }
      })
      .catch((requestError) => {
        if (alive) {
          setError(requestError instanceof Error ? requestError.message : "Failed to load Atlas data.");
        }
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [bufferFeet, questionAreaCode, token]);

  return { result, loading, error };
}

export function atlasBufferLabel(bufferFeet: AtlasBufferFeet) {
  return `${bufferFeet.toLocaleString()} ft`;
}

export function atlasDocumentTitle(document: AtlasDocument) {
  return document.docName?.trim() || document.fileName?.trim() || document.documentNumber || "Document";
}

export function atlasDocumentSubtitle(document: AtlasDocument) {
  const pieces = [document.docType, document.documentNumber, document.pageNo ? `p.${document.pageNo}` : null].filter(
    Boolean,
  );

  return pieces.join(" | ");
}

export function atlasDocumentMeta(document: AtlasDocument) {
  const pieces = [
    atlasExtensionLabel(document.extension),
    document.sizeBytes !== null ? formatAtlasBytes(document.sizeBytes) : null,
  ].filter(Boolean);

  return pieces.join(" | ");
}

export function atlasDocumentKey(document: AtlasDocument, index: number) {
  return [document.documentNumber, document.fileName, index].filter(Boolean).join("-");
}

export function atlasRecordSummary(record: AtlasRecord) {
  return [record.tractKey, record.propertyName, record.regionName].filter(Boolean).join(" | ");
}

export function atlasRecordSubtitle(record: AtlasRecord) {
  return [record.lrType, record.lrStatus].filter(Boolean).join(" | ");
}

export function atlasPreviewKind(document: AtlasDocument, mimeType: string | null) {
  const extension = normalizeAtlasExtension(document.extension);
  const type = mimeType?.toLowerCase() ?? "";

  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"].includes(extension)) {
    return "image" as const;
  }

  if (type === "application/pdf" || extension === "pdf") {
    return "pdf" as const;
  }

  return "other" as const;
}

export function isAtlasPreviewableDocument(document: AtlasDocument) {
  if (document.isPreviewable) {
    return true;
  }

  const extension = normalizeAtlasExtension(document.extension);
  return ["pdf", "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"].includes(extension);
}

function normalizeAtlasQueryResult(payload: unknown): AtlasQueryResult {
  const root = isPlainObject(payload) ? payload : {};
  const source = isPlainObject(root.data) ? root.data : root;

  const records = toAtlasRecordArray(source.records);
  const linkedDocumentCount = toNumber(source.linkedDocumentCount) ?? records.reduce(
    (total, record) => total + record.documents.length,
    0,
  );

  return {
    questionAreaCode: toStringValue(source.questionAreaCode),
    bufferValue: toNumber(source.bufferValue),
    bufferUnit: toStringValue(source.bufferUnit) ?? "feet",
    bufferGeometry: toGeometry(source.bufferGeometry),
    matchedRecordCount: toNumber(source.matchedRecordCount) ?? records.length,
    linkedDocumentCount,
    records,
    warnings: toAtlasWarningArray(source.warnings),
  };
}

function toAtlasRecordArray(value: unknown): AtlasRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => normalizeAtlasRecord(entry));
}

function normalizeAtlasRecord(value: unknown): AtlasRecord {
  const source = isPlainObject(value) ? value : {};
  const documentsSource =
    "documents" in source && Array.isArray(source.documents)
      ? source.documents
      : "linkedDocuments" in source && Array.isArray(source.linkedDocuments)
        ? source.linkedDocuments
        : [];

  return {
    lrNumber: toStringValue(source.lrNumber),
    tractKey: toStringValue(source.tractKey),
    propertyName: toStringValue(source.propertyName),
    fundName: toStringValue(source.fundName),
    regionName: toStringValue(source.regionName),
    lrType: toStringValue(source.lrType),
    lrStatus: toStringValue(source.lrStatus),
    acqDate: toStringValue(source.acqDate),
    taxParcelNumber: toStringValue(source.taxParcelNumber),
    gisAcres: toNumber(source.gisAcres),
    deedAcres: toNumber(source.deedAcres),
    township: toStringValue(source.township),
    range: toStringValue(source.range),
    section: toStringValue(source.section),
    fips: toStringValue(source.fips),
    remark: toStringValue(source.remark),
    primaryDocumentNumber: toStringValue(source.primaryDocumentNumber),
    geometry: toGeometry(source.geometry),
    documents: toAtlasDocumentArray(documentsSource),
  };
}

function toAtlasDocumentArray(value: unknown): AtlasDocument[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => normalizeAtlasDocument(entry));
}

function normalizeAtlasDocument(value: unknown): AtlasDocument {
  const source = isPlainObject(value) ? value : {};

  return {
    documentNumber: toStringValue(source.documentNumber),
    docName: toStringValue(source.docName),
    docType: toStringValue(source.docType),
    pageNo: toNumber(source.pageNo),
    packageRelativePath: toStringValue(source.packageRelativePath),
    fileName: toStringValue(source.fileName),
    extension: toStringValue(source.extension),
    sizeBytes: toNumber(source.sizeBytes),
    hasFile: toBoolean(source.hasFile ?? source.fileExists),
    isPreviewable: toBoolean(source.isPreviewable ?? source.previewable),
    contentUrl: toStringValue(source.contentUrl),
    downloadUrl: toStringValue(source.downloadUrl),
  };
}

function toAtlasWarningArray(value: unknown): AtlasWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => normalizeAtlasWarning(entry));
}

function normalizeAtlasWarning(value: unknown): AtlasWarning {
  const source = isPlainObject(value) ? value : {};

  return {
    code: toStringValue(source.code ?? source.type),
    message: toStringValue(source.message),
    severity: toStringValue(source.severity),
    lrNumber: toStringValue(source.lrNumber),
    documentNumber: toStringValue(source.documentNumber),
  };
}

function normalizeAtlasExtension(value: string | null) {
  return value?.trim().replace(/^\./, "").toLowerCase() ?? "";
}

function atlasExtensionLabel(value: string | null) {
  const normalized = normalizeAtlasExtension(value);
  return normalized ? normalized.toUpperCase() : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringValue(value: unknown) {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function toBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "n"].includes(normalized)) {
      return false;
    }
  }

  return false;
}

function toGeometry(value: unknown): Geometry | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const geometryType = toStringValue(value.type);
  if (!geometryType || !("coordinates" in value)) {
    return null;
  }

  return value as unknown as Geometry;
}

function formatAtlasBytes(bytes: number) {
  if (!Number.isFinite(bytes)) {
    return "Unknown size";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
