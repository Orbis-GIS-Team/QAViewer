import type { Feature, FeatureCollection } from "geojson";

export function parseBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "yes" || normalized === "true") {
    return true;
  }
  if (normalized === "no" || normalized === "false") {
    return false;
  }
  return null;
}

export function parseBbox(value?: string): [number, number, number, number] | null {
  if (!value) {
    return null;
  }
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }
  const [west, south, east, north] = parts;
  return [west, south, east, north];
}

export function featureCollection(features: Feature[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features,
  };
}
