import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import L from "leaflet";
import {
  CircleMarker,
  Pane,
  Polygon,
  Polyline,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";

type MeasureMode = "distance" | "area";
type MeasureUnit = "metric" | "imperial" | "survey";
type ControlPosition = "topleft" | "topright" | "bottomleft" | "bottomright";

const POSITION_CLASSES: Record<ControlPosition, string> = {
  bottomleft: "leaflet-bottom leaflet-left",
  bottomright: "leaflet-bottom leaflet-right",
  topleft: "leaflet-top leaflet-left",
  topright: "leaflet-top leaflet-right",
};

export function MeasurementControl({
  onMeasureActiveChange,
}: {
  onMeasureActiveChange: (active: boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [mode, setMode] = useState<MeasureMode | null>(null);
  const [unit, setUnit] = useState<MeasureUnit>("survey");
  const [isCapturing, setIsCapturing] = useState(false);
  const [points, setPoints] = useState<L.LatLngLiteral[]>([]);

  const distanceMeters = totalDistanceMeters(points);
  const areaSquareMeters = mode === "area" ? polygonAreaSquareMeters(points) : 0;
  const perimeterMeters =
    mode === "area" && points.length > 2 ? totalDistanceMeters([...points, points[0]]) : 0;
  const lastPoint = points[points.length - 1] ?? null;
  const lastSegmentMeters =
    points.length >= 2 ? L.latLng(points[points.length - 2]).distanceTo(points[points.length - 1]) : 0;

  useEffect(() => {
    onMeasureActiveChange(isCapturing);
  }, [isCapturing, onMeasureActiveChange]);

  function startMeasurement(nextMode: MeasureMode) {
    setMode(nextMode);
    setPoints([]);
    setIsCapturing(true);
    setCollapsed(false);
  }

  function stopMeasurement() {
    setIsCapturing(false);
  }

  function clearMeasurement() {
    setMode(null);
    setPoints([]);
    setIsCapturing(false);
  }

  function undoPoint() {
    setPoints((current) => current.slice(0, -1));
  }

  function addPoint(point: L.LatLngLiteral) {
    setPoints((current) => [...current, point]);
  }

  const summaryLabel =
    mode === "area"
      ? points.length >= 3
        ? `${formatArea(areaSquareMeters, unit)} area`
        : "Add at least three points"
      : points.length >= 2
        ? `${formatDistance(distanceMeters, unit)} total`
        : "Add at least two points";
  const canFinishArea = mode === "area" && points.length >= 3 && isCapturing;
  const unitOptions: Array<{ label: string; value: MeasureUnit }> = [
    { label: "ft/ac", value: "survey" },
    { label: "m/ha", value: "metric" },
    { label: "mi", value: "imperial" },
  ];

  return (
    <>
      <MeasureInteraction active={isCapturing} onAddPoint={addPoint} onFinish={stopMeasurement} />

      {mode && points.length > 0 ? (
        <Pane name="measurement-overlay" style={{ zIndex: 470 }}>
          {mode === "area" && points.length >= 3 ? (
            <Polygon
              pathOptions={{
                color: "#ea580c",
                fillColor: "#fb923c",
                fillOpacity: 0.16,
                weight: 2,
              }}
              positions={points.map((point) => [point.lat, point.lng] as [number, number])}
            />
          ) : null}

          <Polyline
            pathOptions={{ color: "#ea580c", dashArray: "8 6", weight: 3 }}
            positions={points.map((point) => [point.lat, point.lng] as [number, number])}
          />

          {points.map((point, index) => (
            <CircleMarker
              center={[point.lat, point.lng]}
              key={`${point.lat}-${point.lng}-${index}`}
              pathOptions={{ color: "#9a3412", fillColor: "#fdba74", fillOpacity: 1, weight: 2 }}
              radius={5}
            >
              {lastPoint === point ? (
                <Tooltip direction="top" offset={[0, -6]} permanent>
                  {mode === "area" && points.length >= 3
                    ? `${formatArea(areaSquareMeters, unit)} | ${formatDistance(perimeterMeters, unit)} perimeter`
                    : formatDistance(distanceMeters, unit)}
                </Tooltip>
              ) : null}
            </CircleMarker>
          ))}
        </Pane>
      ) : null}

      <MapControl className="map-control-shell measurement-control" position="bottomleft">
        <button
          aria-expanded={!collapsed}
          className="map-control-toggle"
          onClick={() => setCollapsed((current) => !current)}
          title={collapsed ? "Expand measure tool" : "Collapse measure tool"}
          type="button"
        >
          <span className="map-control-toggle-label">
            <span className="map-control-toggle-title">Measure</span>
          </span>
          <span aria-hidden="true" className="map-control-toggle-icon">
            {collapsed ? "+" : "-"}
          </span>
        </button>

        {!collapsed ? (
          <div className="map-control-panel">
            <div className="map-control-heading">
              <h3>Measure</h3>
              <span>{isCapturing ? "Click map to add points" : "Choose a mode"}</span>
            </div>

            <div className="measurement-mode-row" role="group" aria-label="Measurement mode">
              <button
                aria-pressed={mode === "distance"}
                className="measurement-action"
                onClick={() => startMeasurement("distance")}
                type="button"
              >
                Distance
              </button>
              <button
                aria-pressed={mode === "area"}
                className="measurement-action"
                onClick={() => startMeasurement("area")}
                type="button"
              >
                Area
              </button>
            </div>

            <div className="measurement-unit-row" role="group" aria-label="Measurement units">
              {unitOptions.map((option) => (
                <button
                  aria-pressed={unit === option.value}
                  className="measurement-unit-button"
                  key={option.value}
                  onClick={() => setUnit(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="measurement-actions">
              <button className="ghost-button" disabled={points.length === 0} onClick={undoPoint} type="button">
                Undo
              </button>
              {canFinishArea ? (
                <button className="ghost-button primary-button" onClick={stopMeasurement} type="button">
                  Finish
                </button>
              ) : null}
              <button
                className="ghost-button"
                disabled={!isCapturing}
                onClick={stopMeasurement}
                type="button"
              >
                Stop
              </button>
              <button className="ghost-button" disabled={!mode} onClick={clearMeasurement} type="button">
                Clear
              </button>
            </div>

            <div className="measurement-stack">
              <p className="measurement-status">
                <strong>{mode ? humanize(mode) : "Inactive"}.</strong>{" "}
                {mode ? summaryLabel : "Start a measurement to draw on the map."}
              </p>
              {points.length > 0 ? (
                <dl className="measurement-readout">
                  <div>
                    <dt>Points</dt>
                    <dd>{points.length}</dd>
                  </div>
                  {points.length >= 2 ? (
                    <div>
                      <dt>Last</dt>
                      <dd>{formatDistance(lastSegmentMeters, unit)}</dd>
                    </div>
                  ) : null}
                  {mode === "area" && points.length >= 3 ? (
                    <div>
                      <dt>Perimeter</dt>
                      <dd>{formatDistance(perimeterMeters, unit)}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              <p className="measurement-hint">
                {mode === "area" && points.length >= 3
                  ? isCapturing
                    ? "Click Finish or double-click the map to close the shape."
                    : "Area measurement is finished."
                  : isCapturing
                    ? "Click on the map to add points. Double-click to stop."
                    : "Choose Distance or Area to begin."}
              </p>
            </div>
          </div>
        ) : null}
      </MapControl>
    </>
  );
}

function MapControl({
  children,
  className,
  position,
}: {
  children: ReactNode;
  className?: string;
  position: ControlPosition;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    L.DomEvent.disableClickPropagation(containerRef.current);
    L.DomEvent.disableScrollPropagation(containerRef.current);
  }, []);

  return (
    <div className={POSITION_CLASSES[position]}>
      <div className={`leaflet-control ${className ?? ""}`.trim()} ref={containerRef}>
        {children}
      </div>
    </div>
  );
}

function MeasureInteraction({
  active,
  onAddPoint,
  onFinish,
}: {
  active: boolean;
  onAddPoint: (point: L.LatLngLiteral) => void;
  onFinish: () => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!active) {
      return;
    }

    const wasDoubleClickZoomEnabled = map.doubleClickZoom.enabled();
    map.doubleClickZoom.disable();

    return () => {
      if (wasDoubleClickZoomEnabled) {
        map.doubleClickZoom.enable();
      }
    };
  }, [active, map]);

  useMapEvents({
    click(event) {
      if (!active) {
        return;
      }

      onAddPoint(event.latlng);
    },
    dblclick() {
      if (!active) {
        return;
      }

      onFinish();
    },
  });

  return null;
}

function totalDistanceMeters(points: L.LatLngLiteral[]) {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += L.latLng(points[index - 1]).distanceTo(points[index]);
  }

  return total;
}

function polygonAreaSquareMeters(points: L.LatLngLiteral[]) {
  if (points.length < 3) {
    return 0;
  }

  const earthRadius = 6378137;
  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area +=
      degreesToRadians(next.lng - current.lng) *
      (2 + Math.sin(degreesToRadians(current.lat)) + Math.sin(degreesToRadians(next.lat)));
  }

  return Math.abs((area * earthRadius * earthRadius) / 2);
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function humanize(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatDistance(value: number, unit: MeasureUnit) {
  if (unit === "metric") {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(2)} km`;
    }

    return `${value.toFixed(0)} m`;
  }

  const feet = value * 3.28084;
  if (unit === "survey") {
    return `${feet.toFixed(feet >= 100 ? 0 : 1)} ft`;
  }

  const miles = feet / 5280;
  if (miles >= 0.1) {
    return `${miles.toFixed(2)} mi`;
  }

  return `${feet.toFixed(feet >= 100 ? 0 : 1)} ft`;
}

function formatArea(value: number, unit: MeasureUnit) {
  if (unit === "metric") {
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(2)} sq km`;
    }

    if (value >= 10_000) {
      return `${(value / 10_000).toFixed(2)} ha`;
    }

    return `${value.toFixed(0)} sq m`;
  }

  const squareFeet = value * 10.7639;
  const acres = squareFeet / 43560;
  if (unit === "survey" || acres >= 0.1) {
    return `${acres.toFixed(acres >= 10 ? 1 : 2)} ac`;
  }

  return `${squareFeet.toFixed(0)} sq ft`;
}
