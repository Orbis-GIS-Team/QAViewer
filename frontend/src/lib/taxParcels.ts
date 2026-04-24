import { useEffect, useState } from "react";

import type { Geometry } from "geojson";

import { apiRequest } from "./api";

export const TAX_PARCEL_BUFFER_OPTIONS = [100, 500, 1000, 5000] as const;

export type TaxParcelBufferFeet = (typeof TAX_PARCEL_BUFFER_OPTIONS)[number];

export type TaxParcelTarget = {
  code: string;
  title: string | null;
  summary: string | null;
  parcelCode: string | null;
  county: string | null;
  state: string | null;
};

export type TaxBill = {
  billId: string;
  parcelId: string | null;
  year: number | null;
  filename: string | null;
  extension: string | null;
  sizeBytes: number | null;
  hasFile: boolean;
  isPreviewable: boolean;
  contentUrl: string | null;
  downloadUrl: string | null;
};

export type TaxParcel = {
  parcelId: string | null;
  parcelCode: string | null;
  accountNumber: string | null;
  ownerName: string | null;
  propertyName: string | null;
  parcelStatus: string | null;
  taxProgram: string | null;
  ownershipType: string | null;
  county: string | null;
  state: string | null;
  gisAcres: number | null;
  description: string | null;
  landUseType: string | null;
  tractName: string | null;
  notes: string | null;
  overlapAreaSqMeters: number | null;
  pointDistanceMeters: number | null;
  primaryRank: number;
  isPrimaryMatch: boolean;
  geometry: Geometry | null;
  bills: TaxBill[];
};

export type TaxParcelWarning = {
  code: string | null;
  message: string | null;
  severity: string | null;
  billId?: string | null;
  parcelId?: string | null;
};

export type TaxParcelQueryResult = {
  questionAreaCode: string | null;
  bufferValue: number | null;
  bufferUnit: string | null;
  bufferGeometry: Geometry | null;
  matchedParcelCount: number;
  matchedBillCount: number;
  parcels: TaxParcel[];
  warnings: TaxParcelWarning[];
};

export type TaxParcelQueryState = {
  result: TaxParcelQueryResult | null;
  loading: boolean;
  error: string | null;
};

export function useTaxParcelQuery({
  token,
  questionAreaCode,
  bufferFeet,
  enabled = true,
}: {
  token: string;
  questionAreaCode: string | null;
  bufferFeet: TaxParcelBufferFeet;
  enabled?: boolean;
}): TaxParcelQueryState {
  const [result, setResult] = useState<TaxParcelQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !questionAreaCode) {
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

    apiRequest<TaxParcelQueryResult>(
      `/question-areas/${encodeURIComponent(questionAreaCode)}/tax-parcels?${params.toString()}`,
      { token },
    )
      .then((payload) => {
        if (alive) {
          setResult(normalizeTaxParcelQueryResult(payload));
        }
      })
      .catch((requestError) => {
        if (alive) {
          setError(requestError instanceof Error ? requestError.message : "Failed to load tax parcel data.");
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
  }, [bufferFeet, enabled, questionAreaCode, token]);

  return { result, loading, error };
}

export function taxParcelBufferLabel(bufferFeet: TaxParcelBufferFeet) {
  return `${bufferFeet.toLocaleString()} ft`;
}

export function taxParcelKey(parcel: TaxParcel, index: number) {
  return parcel.parcelCode ?? parcel.parcelId ?? parcel.accountNumber ?? `tax-parcel-${index}`;
}

export function taxParcelTitle(parcel: TaxParcel) {
  return parcel.parcelCode ?? parcel.parcelId ?? parcel.accountNumber ?? "Matched tax parcel";
}

export function taxParcelSubtitle(parcel: TaxParcel) {
  return [parcel.ownerName, parcel.county, parcel.state].filter(Boolean).join(" | ");
}

export function taxBillTitle(bill: TaxBill) {
  return bill.filename ?? ([bill.year, bill.parcelId].filter(Boolean).join("_") || "Tax bill");
}

export function taxBillMeta(bill: TaxBill) {
  return [
    bill.year ? String(bill.year) : null,
    taxBillExtensionLabel(bill.extension),
    bill.sizeBytes !== null ? formatTaxParcelBytes(bill.sizeBytes) : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

export function isTaxBillPreviewable(bill: TaxBill) {
  if (bill.isPreviewable) {
    return true;
  }

  const extension = normalizeExtension(bill.extension);
  return ["pdf", "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"].includes(extension);
}

export function taxParcelAreaLabel(squareMeters: number | null | undefined) {
  if (squareMeters === null || squareMeters === undefined || !Number.isFinite(squareMeters)) {
    return "None";
  }

  if (squareMeters >= 10_000) {
    return `${(squareMeters / 10_000).toFixed(2)} ha`;
  }

  return `${squareMeters.toFixed(0)} sq m`;
}

export function taxParcelDistanceLabel(meters: number | null | undefined) {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) {
    return "None";
  }

  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }

  return `${meters.toFixed(0)} m`;
}

function normalizeTaxParcelQueryResult(payload: unknown): TaxParcelQueryResult {
  const root = isPlainObject(payload) ? payload : {};
  const source = isPlainObject(root.data) ? root.data : root;
  const parcels = toTaxParcelArray(source.parcels);

  return {
    questionAreaCode: toStringValue(source.questionAreaCode),
    bufferValue: toNumber(source.bufferValue),
    bufferUnit: toStringValue(source.bufferUnit) ?? "feet",
    bufferGeometry: toGeometry(source.bufferGeometry),
    matchedParcelCount: toNumber(source.matchedParcelCount) ?? parcels.length,
    matchedBillCount: toNumber(source.matchedBillCount) ?? countMatchedBills(parcels),
    parcels,
    warnings: toTaxParcelWarningArray(source.warnings),
  };
}

function toTaxParcelArray(value: unknown): TaxParcel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => normalizeTaxParcel(entry));
}

function normalizeTaxParcel(value: unknown): TaxParcel {
  const source = isPlainObject(value) ? value : {};

  return {
    parcelId: toStringValue(source.parcelId),
    parcelCode: toStringValue(source.parcelCode),
    accountNumber: toStringValue(source.accountNumber),
    ownerName: toStringValue(source.ownerName),
    propertyName: toStringValue(source.propertyName),
    parcelStatus: toStringValue(source.parcelStatus),
    taxProgram: toStringValue(source.taxProgram),
    ownershipType: toStringValue(source.ownershipType),
    county: toStringValue(source.county),
    state: toStringValue(source.state),
    gisAcres: toNumber(source.gisAcres),
    description: toStringValue(source.description),
    landUseType: toStringValue(source.landUseType),
    tractName: toStringValue(source.tractName),
    notes: toStringValue(source.notes),
    overlapAreaSqMeters: toNumber(source.overlapAreaSqMeters),
    pointDistanceMeters: toNumber(source.pointDistanceMeters),
    primaryRank: toNumber(source.primaryRank) ?? Number.MAX_SAFE_INTEGER,
    isPrimaryMatch: toBoolean(source.isPrimaryMatch),
    geometry: toGeometry(source.geometry),
    bills: toTaxBillArray(source.bills),
  };
}

function toTaxBillArray(value: unknown): TaxBill[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => normalizeTaxBill(entry));
}

function normalizeTaxBill(value: unknown): TaxBill {
  const source = isPlainObject(value) ? value : {};

  return {
    billId: toStringValue(source.billId) ?? "tax-bill",
    parcelId: toStringValue(source.parcelId),
    year: toNumber(source.year),
    filename: toStringValue(source.filename),
    extension: toStringValue(source.extension),
    sizeBytes: toNumber(source.sizeBytes),
    hasFile: toBoolean(source.hasFile),
    isPreviewable: toBoolean(source.isPreviewable),
    contentUrl: toStringValue(source.contentUrl),
    downloadUrl: toStringValue(source.downloadUrl),
  };
}

function toTaxParcelWarningArray(value: unknown): TaxParcelWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => normalizeTaxParcelWarning(entry));
}

function normalizeTaxParcelWarning(value: unknown): TaxParcelWarning {
  const source = isPlainObject(value) ? value : {};

  return {
    code: toStringValue(source.code),
    message: toStringValue(source.message),
    severity: toStringValue(source.severity),
    billId: toStringValue(source.billId),
    parcelId: toStringValue(source.parcelId),
  };
}

function countMatchedBills(parcels: TaxParcel[]) {
  return parcels.reduce((total, parcel) => total + parcel.bills.length, 0);
}

function taxBillExtensionLabel(value: string | null) {
  const normalized = normalizeExtension(value);
  return normalized ? normalized.toUpperCase() : null;
}

function normalizeExtension(value: string | null) {
  return value?.trim().replace(/^\./, "").toLowerCase() ?? "";
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

function formatTaxParcelBytes(bytes: number) {
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
