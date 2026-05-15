declare module "esri-leaflet" {
  import type { Feature, Geometry } from "geojson";
  import type * as L from "leaflet";

  export type FeatureLayerOptions = L.GeoJSONOptions & {
    cacheLayers?: boolean;
    fields?: string[];
    keepBuffer?: number;
    minZoom?: number;
    pane?: string;
    precision?: number;
    simplifyFactor?: number;
    updateInterval?: number;
    updateWhenIdle?: boolean;
    url: string;
    where?: string;
  };

  export type FeatureLayerEvent = L.LeafletEvent & {
    error?: Error;
    feature?: Feature<Geometry, Record<string, unknown>>;
    latlng?: L.LatLng;
    layer?: L.Layer & { feature?: Feature<Geometry, Record<string, unknown>> };
    message?: string;
    originalEvent?: Event;
  };

  export interface FeatureLayer extends L.Layer {
    off(type: string, fn?: (event: FeatureLayerEvent) => void, context?: unknown): this;
    on(type: string, fn: (event: FeatureLayerEvent) => void, context?: unknown): this;
  }

  export function featureLayer(options: FeatureLayerOptions): FeatureLayer;
}
