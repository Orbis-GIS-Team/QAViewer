from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]

DEFAULT_SOURCE_PATH = ROOT / "BTG_PTV_Implementation.gdb"
DEFAULT_OUTPUT_DIR = ROOT / "data" / "generated"

DEFAULT_PRIMARY_MISMATCH_LAYER = "BTG_Spatial_Fix_Primary_Erase"
DEFAULT_COMPARISON_MISMATCH_LAYER = "BTG_Spatial_Fix_Comparison_Erase"
DEFAULT_PRIMARY_PARCELS_LAYER = "BTG_Spatial_Fix_Primary_Layer"
DEFAULT_PARCEL_POINTS_LAYER = "BTG_Points_NoArches_12Feb26"
DEFAULT_MANAGEMENT_TRACTS_LAYER = "BTG_MGMT_NoArches"

PRIMARY_PARCEL_COLUMNS = [
    "parcelnumb",
    "County",
    "State",
    "RegridOwner",
    "PropertyName",
    "AnalysisName",
    "TractName",
    "QA_Status",
    "PTVParcel",
    "Exists_in_Mgt",
    "Exists_in_PTV",
    "GIS_Acres",
    "SpatialOverlayNotes",
    "geometry",
]

PARCEL_POINT_COLUMNS = [
    "ParcelID",
    "ParcelCode",
    "OwnerName",
    "County",
    "State",
    "Descriptio",
    "TractName",
    "Latitude",
    "Longitude",
    "LandUseTyp",
    "geometry",
]

MANAGEMENT_TRACT_COLUMNS = [
    "Fund",
    "PU_Number",
    "PU",
    "Tract_Numb",
    "Tract_Name",
    "Ownership",
    "Comment",
    "Book_Area",
    "geometry",
]


GENERATED_FILENAMES = {
    "question_areas.geojson",
    "primary_parcels.geojson",
    "parcel_points.geojson",
    "management_tracts.geojson",
    "manifest.json",
}


@dataclass(frozen=True)
class LayerSpec:
    layer_name: str
    columns: list[str]


@dataclass(frozen=True)
class ExportConfig:
    source_path: Path
    output_dir: Path
    question_area_layer_specs: list[tuple[str, str]]
    support_layer_specs: dict[str, LayerSpec]


def env_value(name: str, default: str) -> str:
    return os.environ.get(name, default)


def resolve_path(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        return (ROOT / path).resolve()
    return path


def parse_args() -> ExportConfig:
    parser = argparse.ArgumentParser(
        description=(
            "Export a dataset into QAViewer's normalized seed schema. "
            "The app consumes the generated files, not the source geodatabase directly."
        )
    )
    parser.add_argument(
        "--source",
        default=env_value("QAVIEWER_SOURCE_GDB", str(DEFAULT_SOURCE_PATH)),
        help="Source geodatabase or vector dataset path.",
    )
    parser.add_argument(
        "--output-dir",
        default=env_value("QAVIEWER_OUTPUT_DIR", str(DEFAULT_OUTPUT_DIR)),
        help="Directory where normalized seed files are written.",
    )
    parser.add_argument(
        "--primary-mismatch-layer",
        default=env_value("QAVIEWER_QA_PRIMARY_LAYER", DEFAULT_PRIMARY_MISMATCH_LAYER),
        help="Layer containing primary-side mismatch question areas.",
    )
    parser.add_argument(
        "--comparison-mismatch-layer",
        default=env_value("QAVIEWER_QA_COMPARISON_LAYER", DEFAULT_COMPARISON_MISMATCH_LAYER),
        help="Layer containing comparison-side mismatch question areas.",
    )
    parser.add_argument(
        "--primary-parcels-layer",
        default=env_value("QAVIEWER_PRIMARY_PARCELS_LAYER", DEFAULT_PRIMARY_PARCELS_LAYER),
        help="Supporting primary parcel context layer.",
    )
    parser.add_argument(
        "--parcel-points-layer",
        default=env_value("QAVIEWER_PARCEL_POINTS_LAYER", DEFAULT_PARCEL_POINTS_LAYER),
        help="Supporting parcel point context layer.",
    )
    parser.add_argument(
        "--management-tracts-layer",
        default=env_value("QAVIEWER_MANAGEMENT_TRACTS_LAYER", DEFAULT_MANAGEMENT_TRACTS_LAYER),
        help="Supporting management tract context layer.",
    )
    args = parser.parse_args()

    source_path = resolve_path(args.source)
    output_dir = resolve_path(args.output_dir)

    return ExportConfig(
        source_path=source_path,
        output_dir=output_dir,
        question_area_layer_specs=[
            (args.primary_mismatch_layer, "primary"),
            (args.comparison_mismatch_layer, "comparison"),
        ],
        support_layer_specs={
            "primary_parcels": LayerSpec(args.primary_parcels_layer, PRIMARY_PARCEL_COLUMNS),
            "parcel_points": LayerSpec(args.parcel_points_layer, PARCEL_POINT_COLUMNS),
            "management_tracts": LayerSpec(args.management_tracts_layer, MANAGEMENT_TRACT_COLUMNS),
        },
    )


def list_available_layers(source_path: Path) -> list[str]:
    try:
        layers = gpd.list_layers(source_path)
    except Exception as exc:
        print(f"  [preflight] unable to list geodatabase layers: {exc}")
        return []

    if "name" not in layers:
        return []
    return [str(name) for name in layers["name"].tolist()]


def validate_required_layers(config: ExportConfig) -> None:
    available_layers = list_available_layers(config.source_path)
    if not available_layers:
        return

    required_layers = [
        *(layer_name for layer_name, _source_group in config.question_area_layer_specs),
        *(spec.layer_name for spec in config.support_layer_specs.values()),
    ]
    missing_layers = sorted(set(required_layers) - set(available_layers))
    if missing_layers:
        raise ValueError(
            "Geodatabase is missing required source layer(s): "
            f"{', '.join(missing_layers)}. "
            f"Available layers: {', '.join(available_layers)}"
        )


def validate_required_columns(frame: gpd.GeoDataFrame, layer_name: str, columns: list[str] | None) -> None:
    if columns is None:
        return

    expected_columns = [column for column in columns if column != "geometry"]
    missing_columns = sorted(set(expected_columns) - set(frame.columns))
    if missing_columns:
        raise ValueError(
            f"Layer '{layer_name}' is missing required column(s): "
            f"{', '.join(missing_columns)}. Available columns: {', '.join(map(str, frame.columns))}"
        )


def read_layer(
    config: ExportConfig,
    layer_name: str,
    columns: list[str] | None = None,
) -> gpd.GeoDataFrame:
    frame = gpd.read_file(config.source_path, layer=layer_name, columns=columns)
    validate_required_columns(frame, layer_name, columns)

    if frame.crs is None:
        raise ValueError(
            f"Layer '{layer_name}' has no CRS defined. "
            "Cannot safely assume EPSG:4326. Fix the source data or set the CRS explicitly."
        )

    source_epsg = frame.crs.to_epsg()
    print(f"  [{layer_name}] source CRS: EPSG:{source_epsg}")

    if source_epsg != 4326:
        frame = frame.to_crs(4326)

    frame = frame.loc[frame.geometry.notna() & ~frame.geometry.is_empty].copy()

    invalid_mask = ~frame.geometry.is_valid
    invalid_count = invalid_mask.sum()
    if invalid_count > 0:
        print(f"  [{layer_name}] repairing {invalid_count} invalid geometries with make_valid")
        frame.loc[invalid_mask, "geometry"] = frame.loc[invalid_mask, "geometry"].make_valid()

    return frame


def clean_value(value: Any) -> Any:
    if pd.isna(value):
        return None
    if isinstance(value, (pd.Timestamp,)):
        return value.isoformat()
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            return value
    return value


def with_bounds(frame: gpd.GeoDataFrame) -> dict[str, float]:
    min_x, min_y, max_x, max_y = frame.total_bounds
    return {
        "minLng": round(float(min_x), 6),
        "minLat": round(float(min_y), 6),
        "maxLng": round(float(max_x), 6),
        "maxLat": round(float(max_y), 6),
    }


def write_geojson(path: Path, frame: gpd.GeoDataFrame) -> None:
    feature_collection = json.loads(frame.to_json(drop_id=True))
    path.write_text(json.dumps(feature_collection, separators=(",", ":")), encoding="utf-8")


def clear_stale_generated_files(output_dir: Path) -> None:
    for path in output_dir.glob("*.geojson"):
        if path.name not in GENERATED_FILENAMES:
            path.unlink()


def row_value(row: pd.Series, names: list[str]) -> Any:
    lower_lookup = {str(column).lower(): column for column in row.index}
    for name in names:
        column = lower_lookup.get(name.lower())
        if column is not None:
            return clean_value(row.get(column))
    return None


def collect_search_keywords(row: pd.Series, preferred_values: list[Any]) -> str:
    values = [str(value) for value in preferred_values if value not in (None, "")]
    for column, value in row.items():
        if column == "geometry":
            continue
        cleaned = clean_value(value)
        if cleaned not in (None, ""):
            values.append(str(cleaned))
    return " ".join(dict.fromkeys(values)).strip()


def build_question_areas(config: ExportConfig) -> tuple[gpd.GeoDataFrame, dict[str, Any]]:
    """Build question areas from the primary and comparison erase mismatch layers."""
    question_area_rows: list[dict[str, Any]] = []

    for layer_name, source_group in config.question_area_layer_specs:
        mismatch_layer = read_layer(config, layer_name)
        print(f"  [question_areas] {len(mismatch_layer)} features from {layer_name}")

        for _index, row in mismatch_layer.iterrows():
            seq = len(question_area_rows) + 1
            centroid = row.geometry.representative_point()
            parcel_number = row_value(row, ["parcelnumb", "parcel_number", "ParcelNumber", "ParcelID", "ParcelCode"])
            parcel_code = row_value(row, ["PTVParcel", "ptv_parcel", "ParcelCode", "parcel_code"])
            owner_name = row_value(row, ["RegridOwner", "OwnerName", "owner_name", "Ownership"])
            county = row_value(row, ["County", "county"])
            state = row_value(row, ["State", "state", "STATE"])
            property_name = row_value(row, ["PropertyName", "property_name", "Property"])
            analysis_name = row_value(row, ["AnalysisName", "analysis_name"])
            tract_name = row_value(row, ["TractName", "Tract_Name", "tract_name"])
            overlay_notes = row_value(
                row,
                ["SpatialOverlayNotes", "QA_Status", "Comment", "Descriptio", "Description"],
            )
            gis_acres = row_value(row, ["GIS_Acres", "gis_acres", "ACRES", "Book_Area"])
            title = property_name or parcel_number or parcel_code or f"{source_group.title()} mismatch {seq}"
            summary = overlay_notes or f"{source_group.title()} mismatch from {layer_name}"

            related_parcels = []
            if parcel_number or parcel_code:
                related_parcels.append(
                    {
                        "parcelNumber": str(parcel_number) if parcel_number else None,
                        "parcelCode": parcel_code or parcel_number,
                        "ownerName": owner_name,
                        "county": county,
                        "state": state,
                        "propertyName": property_name,
                        "analysisName": analysis_name,
                        "tractName": tract_name,
                        "source": source_group,
                    }
                )

            question_area_rows.append(
                {
                    "question_area_code": f"QA-{seq:04d}",
                    "source_layer": layer_name,
                    "source_group": source_group,
                    "status": "review",
                    "severity": "medium",
                    "title": title,
                    "summary": summary,
                    "description": overlay_notes,
                    "county": county,
                    "state": state,
                    "primary_parcel_number": parcel_number,
                    "primary_parcel_code": parcel_code or parcel_number,
                    "primary_owner_name": owner_name,
                    "property_name": property_name,
                    "analysis_name": analysis_name,
                    "tract_name": tract_name,
                    "assigned_reviewer": None,
                    "search_keywords": collect_search_keywords(
                        row,
                        [parcel_number, parcel_code, owner_name, county, state, property_name, summary],
                    ),
                    "source_layers": [layer_name],
                    "related_parcels": related_parcels,
                    "metrics": {
                        "gisAcres": gis_acres,
                    },
                    "centroid_lat": round(float(centroid.y), 6),
                    "centroid_lng": round(float(centroid.x), 6),
                    "geometry": row.geometry,
                }
            )

    if not question_area_rows:
        raise ValueError("No question areas were exported from the mismatch layers.")

    source_breakdown = {
        source_group: sum(
            1 for row in question_area_rows if row["source_group"] == source_group
        )
        for _layer_name, source_group in config.question_area_layer_specs
    }
    if not all(count > 0 for count in source_breakdown.values()):
        raise ValueError(
            "Question-area export must include features from both mismatch layers: "
            f"{source_breakdown}"
        )
    for row in question_area_rows:
        if row["source_layer"] == config.support_layer_specs["primary_parcels"].layer_name:
            raise ValueError(
                "Question areas must come from mismatch layers, not the primary parcel context layer."
            )

    question_areas = gpd.GeoDataFrame(question_area_rows, geometry="geometry", crs=4326)
    question_areas = question_areas.sort_values("question_area_code").reset_index(drop=True)

    manifest = {
        "questionAreas": len(question_areas),
        "sourceBreakdown": source_breakdown,
        "bounds": with_bounds(question_areas),
    }
    return question_areas, manifest


def export_support_layers(config: ExportConfig) -> dict[str, Any]:
    """Export the three source layers as GeoJSON for use by the frontend map.

    Layers:
      - primary_parcels: all parcels from BTG_Spatial_Fix_Primary_Layer
      - parcel_points: centroid points from BTG_Points_NoArches_12Feb26
      - management_tracts: authoritative management claims from BTG_MGMT_NoArches
    """
    manifest: dict[str, Any] = {}

    for output_name, spec in config.support_layer_specs.items():
        frame = read_layer(config, spec.layer_name, spec.columns)
        write_geojson(config.output_dir / f"{output_name}.geojson", frame)
        manifest[output_name] = {
            "sourceLayer": spec.layer_name,
            "featureCount": len(frame),
            "bounds": with_bounds(frame),
        }

    return manifest


def main() -> None:
    config = parse_args()
    config.output_dir.mkdir(parents=True, exist_ok=True)
    validate_required_layers(config)
    clear_stale_generated_files(config.output_dir)

    question_areas, question_manifest = build_question_areas(config)
    layer_manifest = export_support_layers(config)

    write_geojson(config.output_dir / "question_areas.geojson", question_areas)

    manifest = {
        "sourceDatabase": config.source_path.name,
        "questionAreas": question_manifest,
        "layers": layer_manifest,
    }
    (config.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
