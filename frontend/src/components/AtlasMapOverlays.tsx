import type { Feature, FeatureCollection, Geometry } from "geojson";

import L from "leaflet";
import type { PathOptions } from "leaflet";
import { GeoJSON, Pane } from "react-leaflet";

import type { AtlasQueryResult } from "../lib/atlas";

const atlasBufferStyle: PathOptions = {
  color: "#c2410c",
  dashArray: "8 6",
  fillColor: "#fb923c",
  fillOpacity: 0.1,
  weight: 2,
};

const atlasRecordStyle: PathOptions = {
  color: "#ea580c",
  fillColor: "#fdba74",
  fillOpacity: 0.28,
  weight: 3,
};

export function AtlasMapOverlays({ atlasQuery }: { atlasQuery: AtlasQueryResult | null }) {
  const bufferGeometry = atlasQuery?.bufferGeometry ?? null;
  const recordFeatures = (atlasQuery?.records ?? [])
    .map((record, index) => {
      if (!record.geometry) {
        return null;
      }

      return {
        type: "Feature",
        geometry: record.geometry,
        properties: {
          index,
          lrNumber: record.lrNumber,
          propertyName: record.propertyName,
          tractKey: record.tractKey,
        },
      } as Feature<Geometry, Record<string, unknown>>;
    })
    .filter(Boolean) as Array<Feature<Geometry, Record<string, unknown>>>;

  const bufferFeature = bufferGeometry
    ? ({
        type: "Feature",
        geometry: bufferGeometry,
        properties: {
          kind: "atlas-buffer",
        },
      } as Feature<Geometry, Record<string, unknown>>)
    : null;
  const bufferCollection: FeatureCollection<Geometry, Record<string, unknown>> | null = bufferFeature
    ? {
        type: "FeatureCollection",
        features: [bufferFeature],
      }
    : null;
  const recordCollection: FeatureCollection<Geometry, Record<string, unknown>> = {
    type: "FeatureCollection",
    features: recordFeatures,
  };

  return (
    <>
      {bufferCollection ? (
        <Pane name="atlas-buffer" style={{ zIndex: 405 }}>
          <GeoJSON data={bufferCollection} style={atlasBufferStyle} />
        </Pane>
      ) : null}

      {recordFeatures.length > 0 ? (
        <Pane name="atlas-records" style={{ zIndex: 410 }}>
          <GeoJSON
            data={recordCollection}
            onEachFeature={(feature, layer) => {
              const label = [feature.properties?.lrNumber, feature.properties?.propertyName]
                .filter(Boolean)
                .join(" | ");

              if (label) {
                layer.bindTooltip(label, { direction: "top", sticky: true, opacity: 0.95 });
              }
            }}
            pointToLayer={(feature, latlng) =>
              L.circleMarker(latlng, {
                color: atlasRecordStyle.color,
                fillColor: atlasRecordStyle.fillColor,
                fillOpacity: atlasRecordStyle.fillOpacity,
                radius: 7,
                weight: atlasRecordStyle.weight,
              })
            }
            style={atlasRecordStyle}
          />
        </Pane>
      ) : null}
    </>
  );
}
