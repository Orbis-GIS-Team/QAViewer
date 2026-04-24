import type { Feature, FeatureCollection, Geometry } from "geojson";

import L from "leaflet";
import type { PathOptions } from "leaflet";
import { GeoJSON, Pane } from "react-leaflet";

import type { TaxParcelQueryResult } from "../lib/taxParcels";

const taxParcelBufferStyle: PathOptions = {
  color: "#0369a1",
  dashArray: "10 6",
  fillColor: "#38bdf8",
  fillOpacity: 0.08,
  weight: 2,
};

const taxParcelStyle: PathOptions = {
  color: "#1d4ed8",
  fillColor: "#60a5fa",
  fillOpacity: 0.18,
  weight: 2,
};

const primaryTaxParcelStyle: PathOptions = {
  color: "#0f172a",
  fillColor: "#2563eb",
  fillOpacity: 0.28,
  weight: 3,
};

export function TaxParcelMapOverlays({
  taxParcelQuery,
}: {
  taxParcelQuery: TaxParcelQueryResult | null;
}) {
  const bufferGeometry = taxParcelQuery?.bufferGeometry ?? null;
  const parcelFeatures = (taxParcelQuery?.parcels ?? [])
    .map((parcel, index) => {
      if (!parcel.geometry) {
        return null;
      }

      return {
        type: "Feature",
        geometry: parcel.geometry,
        properties: {
          index,
          parcelCode: parcel.parcelCode,
          parcelId: parcel.parcelId,
          ownerName: parcel.ownerName,
          isPrimaryMatch: parcel.isPrimaryMatch,
        },
      } as Feature<Geometry, Record<string, unknown>>;
    })
    .filter(Boolean) as Array<Feature<Geometry, Record<string, unknown>>>;

  const bufferFeature = bufferGeometry
    ? ({
        type: "Feature",
        geometry: bufferGeometry,
        properties: {
          kind: "tax-parcel-buffer",
        },
      } as Feature<Geometry, Record<string, unknown>>)
    : null;

  const bufferCollection: FeatureCollection<Geometry, Record<string, unknown>> | null = bufferFeature
    ? {
        type: "FeatureCollection",
        features: [bufferFeature],
      }
    : null;

  const parcelCollection: FeatureCollection<Geometry, Record<string, unknown>> = {
    type: "FeatureCollection",
    features: parcelFeatures,
  };

  return (
    <>
      {bufferCollection ? (
        <Pane name="tax-parcel-buffer" style={{ zIndex: 404 }}>
          <GeoJSON data={bufferCollection} style={taxParcelBufferStyle} />
        </Pane>
      ) : null}

      {parcelFeatures.length > 0 ? (
        <Pane name="tax-parcels" style={{ zIndex: 409 }}>
          <GeoJSON
            data={parcelCollection}
            onEachFeature={(feature, layer) => {
              const label = [feature.properties?.parcelCode, feature.properties?.ownerName, feature.properties?.parcelId]
                .filter(Boolean)
                .join(" | ");

              if (label) {
                layer.bindTooltip(label, { direction: "top", opacity: 0.95, sticky: true });
              }
            }}
            pointToLayer={(feature, latlng) =>
              L.circleMarker(latlng, {
                color: feature.properties?.isPrimaryMatch ? primaryTaxParcelStyle.color : taxParcelStyle.color,
                fillColor: feature.properties?.isPrimaryMatch
                  ? primaryTaxParcelStyle.fillColor
                  : taxParcelStyle.fillColor,
                fillOpacity: feature.properties?.isPrimaryMatch
                  ? primaryTaxParcelStyle.fillOpacity
                  : taxParcelStyle.fillOpacity,
                radius: feature.properties?.isPrimaryMatch ? 8 : 6,
                weight: feature.properties?.isPrimaryMatch ? primaryTaxParcelStyle.weight : taxParcelStyle.weight,
              })
            }
            style={(feature) => (feature?.properties?.isPrimaryMatch ? primaryTaxParcelStyle : taxParcelStyle)}
          />
        </Pane>
      ) : null}
    </>
  );
}
