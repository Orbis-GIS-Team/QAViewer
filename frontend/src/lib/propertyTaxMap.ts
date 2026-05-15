import { useEffect, useState } from "react";

import type { Feature, FeatureCollection, Geometry, Point } from "geojson";

import { apiRequest } from "./api";

export const PROPERTY_TAX_REGRID_MIN_ZOOM = 12;
export const PROPERTY_TAX_POINT_MIN_ZOOM = 12;
export const PROPERTY_TAX_CLUSTER_MAX_ZOOM = PROPERTY_TAX_POINT_MIN_ZOOM - 1;

export type PropertyTaxPointProperties = {
  id: number;
  parcelId?: string | null;
  parcelNumber?: string | null;
  parcelCode: string | null;
  accountNumber: string | null;
  gisAcres: number | null;
  state: string | null;
  county: string | null;
  propertyName: string | null;
  tractName: string | null;
  parcelStatus: string | null;
  taxProgram: string | null;
  exemptionEnrollmentDate: string | null;
  exemptionExpirationDate: string | null;
  exemptionEligibilityDate: string | null;
  ownershipType: string | null;
  purchaseDate: string | null;
  ownerName: string | null;
  description: string | null;
  fipParcelId: string | null;
  notes: string | null;
  landUseType: string | null;
  latitude: number | null;
  longitude: number | null;
  coordinateStatus: string | null;
  sourceWorkbookPath: string | null;
  sourceSheet: string | null;
  sourceRowNumber: number | null;
  [key: string]: unknown;
};

export type PropertyTaxParcelPointProperties = PropertyTaxPointProperties;

export type PropertyTaxParcelPointDetail = PropertyTaxPointProperties & {
  rawProperties?: Record<string, unknown>;
  geometry?: Point | null;
};

export type PropertyTaxPointFeature = Feature<Point, PropertyTaxPointProperties>;
export type PropertyTaxPointCollection = FeatureCollection<Point, PropertyTaxPointProperties>;

export type RegridParcelProperties = {
  id?: number | string | null;
  parcelId?: string | null;
  parcelCode?: string | null;
  parcelNumber?: string | null;
  parcelnumb?: string | null;
  account_number?: string | null;
  owner?: string | null;
  ownerName?: string | null;
  address?: string | null;
  county?: string | null;
  state2?: string | null;
  ll_uuid?: string | null;
  ll_gisacre?: number | string | null;
  matched?: boolean;
  isMatched?: boolean;
  matchedPointCount?: number;
  [key: string]: unknown;
};

export type RegridParcelFeature = Feature<Geometry, RegridParcelProperties>;
export type RegridParcelCollection = FeatureCollection<Geometry, RegridParcelProperties> & {
  metadata?: {
    minZoom?: number;
    enriched?: boolean;
  };
};

export type RegridIdentifyResult = {
  clicked: { latitude: number; longitude: number };
  regridParcel: RegridParcelFeature | null;
  matches: PropertyTaxParcelPointDetail[];
  matchCount: number;
  joinMethod?: "point-in-polygon";
  matched?: boolean;
  workbook?: Record<string, unknown> | null;
  parcel?: Record<string, unknown> | null;
  message?: string | null;
};

type QueryState<T> = {
  result: T | null;
  loading: boolean;
  error: string | null;
};

export function usePropertyTaxPointCollection({
  token,
  bbox,
  enabled,
}: {
  token: string;
  bbox: string;
  enabled: boolean;
}): QueryState<PropertyTaxPointCollection> {
  const [result, setResult] = useState<PropertyTaxPointCollection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setResult(null);
      setLoading(false);
      setError(null);
      return;
    }

    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    apiRequest<PropertyTaxPointCollection>(
      `/tax-parcels/points?bbox=${encodeURIComponent(bbox)}`,
      { token, signal: controller.signal },
    )
      .then((payload) => {
        if (alive) {
          setResult(payload);
        }
      })
      .catch((requestError) => {
        if (alive) {
          setError(requestError instanceof Error ? requestError.message : "Failed to load property tax points.");
        }
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
        }
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [bbox, enabled, token]);

  return { result, loading, error };
}

export async function fetchPropertyTaxPoints({
  bbox,
  token,
  signal,
}: {
  bbox: string;
  token: string;
  signal?: AbortSignal;
}): Promise<PropertyTaxPointCollection> {
  const collection = await apiRequest<PropertyTaxPointCollection>(
    `/tax-parcels/points?bbox=${encodeURIComponent(bbox)}`,
    { token, signal },
  );
  return normalizePropertyTaxPointCollection(collection);
}

export function useRegridParcelCollection({
  token,
  bbox,
  zoom,
  enabled,
}: {
  token: string;
  bbox: string;
  zoom: number;
  enabled: boolean;
}): QueryState<RegridParcelCollection> {
  const [result, setResult] = useState<RegridParcelCollection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || zoom < PROPERTY_TAX_REGRID_MIN_ZOOM) {
      setResult(null);
      setLoading(false);
      setError(null);
      return;
    }

    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ bbox, zoom: String(Math.floor(zoom)) });
    apiRequest<RegridParcelCollection>(`/tax-parcels/regrid-parcels?${params.toString()}`, {
      token,
      signal: controller.signal,
    })
      .then((payload) => {
        if (alive) {
          setResult(payload);
        }
      })
      .catch((requestError) => {
        if (alive) {
          setError(requestError instanceof Error ? requestError.message : "Failed to load Regrid parcels.");
        }
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
        }
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [bbox, enabled, token, zoom]);

  return { result, loading, error };
}

export async function fetchRegridParcels({
  bbox,
  matchedOnly = false,
  token,
  zoom = PROPERTY_TAX_REGRID_MIN_ZOOM - 1,
  signal,
}: {
  bbox: string;
  matchedOnly?: boolean;
  token: string;
  zoom?: number;
  signal?: AbortSignal;
}): Promise<RegridParcelCollection> {
  if (zoom < PROPERTY_TAX_REGRID_MIN_ZOOM) {
    return { type: "FeatureCollection", features: [] };
  }

  const params = new URLSearchParams({ bbox, zoom: String(Math.floor(zoom)) });
  if (matchedOnly) {
    params.set("matchedOnly", "true");
  }
  const collection = await apiRequest<RegridParcelCollection>(`/tax-parcels/regrid-parcels?${params.toString()}`, {
    token,
    signal,
  });
  return normalizeRegridParcelCollection(collection);
}

export async function fetchRegridParcelFabric({
  bbox,
  token,
  zoom = PROPERTY_TAX_REGRID_MIN_ZOOM - 1,
  signal,
}: {
  bbox: string;
  token: string;
  zoom?: number;
  signal?: AbortSignal;
}): Promise<RegridParcelCollection> {
  if (zoom < PROPERTY_TAX_REGRID_MIN_ZOOM) {
    return { type: "FeatureCollection", features: [] };
  }

  const params = new URLSearchParams({ bbox, zoom: String(Math.floor(zoom)) });
  const collection = await apiRequest<RegridParcelCollection>(
    `/tax-parcels/regrid-parcels/query?${params.toString()}`,
    { token, signal },
  );
  return normalizeRegridParcelCollection(collection);
}

export function identifyRegridParcel(
  tokenOrInput: string | { token: string; lat: number; lng: number; signal?: AbortSignal },
  latlng?: { lat: number; lng: number },
  options: { signal?: AbortSignal } = {},
): Promise<RegridIdentifyResult> {
  const token = typeof tokenOrInput === "string" ? tokenOrInput : tokenOrInput.token;
  const target = typeof tokenOrInput === "string" ? latlng : tokenOrInput;
  const signal = typeof tokenOrInput === "string" ? options.signal : tokenOrInput.signal;
  if (!target) {
    return Promise.reject(new Error("A target location is required."));
  }

  return apiRequest<RegridIdentifyResult>("/tax-parcels/regrid-identify", {
    method: "POST",
    token,
    body: {
      latitude: target.lat,
      longitude: target.lng,
    },
    signal,
  }).then(normalizeRegridIdentifyResult);
}

export function propertyTaxPointTitle(point: PropertyTaxPointProperties) {
  return point.parcelCode ?? point.fipParcelId ?? point.accountNumber ?? `Property tax record ${point.id}`;
}

export function propertyTaxPointSubtitle(point: PropertyTaxPointProperties) {
  return [point.ownerName, point.county, point.state].filter(Boolean).join(" | ");
}

function normalizePropertyTaxPointCollection(collection: PropertyTaxPointCollection): PropertyTaxPointCollection {
  return {
    ...collection,
    features: collection.features.map((feature) => ({
      ...feature,
      properties: normalizePropertyTaxPoint(feature.properties),
    })),
  };
}

function normalizePropertyTaxPoint(point: PropertyTaxPointProperties): PropertyTaxPointProperties {
  return {
    ...point,
    parcelId: point.parcelId ?? point.fipParcelId ?? null,
    parcelNumber: point.parcelNumber ?? point.parcelCode ?? null,
  };
}

function normalizeRegridParcelCollection(collection: RegridParcelCollection): RegridParcelCollection {
  return {
    ...collection,
    features: collection.features.map((feature) => ({
      ...feature,
      properties: normalizeRegridProperties(feature.properties ?? {}),
    })),
  };
}

function normalizeRegridIdentifyResult(result: RegridIdentifyResult): RegridIdentifyResult {
  const parcelProperties = result.regridParcel?.properties
    ? normalizeRegridProperties(result.regridParcel.properties)
    : null;
  const workbook = result.matches[0] ? normalizePropertyTaxPoint(result.matches[0]) : null;

  return {
    ...result,
    regridParcel: result.regridParcel
      ? {
          ...result.regridParcel,
          properties: parcelProperties ?? {},
        }
      : null,
    matched: result.matchCount > 0,
    workbook,
    parcel: parcelProperties,
    message: result.matchCount > 0 ? null : "No workbook match found for this Regrid parcel.",
  };
}

function normalizeRegridProperties(properties: RegridParcelProperties): RegridParcelProperties {
  return {
    ...properties,
    parcelId: toStringValue(properties.parcelId ?? properties.id),
    parcelNumber: toStringValue(properties.parcelNumber ?? properties.parcelnumb),
    parcelCode: toStringValue(properties.parcelCode ?? properties.parcelnumb),
    ownerName: toStringValue(properties.ownerName ?? properties.owner),
    matched: Boolean(properties.matched ?? properties.isMatched),
  };
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
