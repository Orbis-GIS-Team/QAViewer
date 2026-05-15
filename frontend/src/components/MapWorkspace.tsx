import { Component, startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ErrorInfo, FormEvent, ReactNode } from "react";

import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import L from "leaflet";
import type { LatLngExpression, PathOptions } from "leaflet";
import * as esriLeaflet from "esri-leaflet";
import Supercluster from "supercluster";
import type { ClusterFeature, PointFeature } from "supercluster";
import {
  CircleMarker,
  GeoJSON,
  LayersControl,
  MapContainer,
  Marker,
  Pane,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";

import type { Session } from "../App";
import { apiDownload, apiRequest } from "../lib/api";
import {
  PROPERTY_TAX_CLUSTER_MAX_ZOOM,
  PROPERTY_TAX_POINT_MIN_ZOOM,
  PROPERTY_TAX_REGRID_MIN_ZOOM,
  fetchRegridParcels,
  fetchPropertyTaxPoints,
  identifyRegridParcel,
  type PropertyTaxParcelPointDetail,
  type PropertyTaxParcelPointProperties,
  type PropertyTaxPointCollection,
  type RegridIdentifyResult,
  type RegridParcelCollection,
  type RegridParcelFeature,
  type RegridParcelProperties,
} from "../lib/propertyTaxMap";
import { getVisibleSupportTabs, hasPermission, type SupportWorkspaceTab } from "../lib/rbac";
import { AtlasMapOverlays } from "./AtlasMapOverlays";
import { AtlasPanel } from "./AtlasPanel";
import { useAtlasQuery, type AtlasBufferFeet, type AtlasTarget } from "../lib/atlas";
import { TaxParcelMapOverlays } from "./TaxParcelMapOverlays";
import { TaxParcelPanel } from "./TaxParcelPanel";
import {
  useTaxParcelQuery,
  type TaxParcelBufferFeet,
  type TaxParcelTarget,
} from "../lib/taxParcels";

type SearchResult = {
  type: "question_area";
  id: string;
  label: string;
  subtitle: string;
};

type SearchField = "all" | "parcel_code" | "county" | "qa_id";
type DataAvailabilityFilter = "all" | "available" | "missing" | "unknown";
type ActionabilityFilter = "all" | "open" | "closed" | "assigned" | "unassigned" | "needs_data" | "ready";
type QuestionActionabilityState = "normal" | "high_pain" | "no_parcel_data" | "in_progress";

const MAP_VIEWPORT_DEBOUNCE_MS = 160;
const MAP_DATA_FETCH_DEBOUNCE_MS = 220;
const REGRID_FEATURE_SERVICE_URL = (import.meta.env.VITE_REGRID_FEATURE_SERVICE_URL ?? "").trim();
const REGRID_FEATURE_SERVICE_FIELDS = ["id", "parcelnumb", "account_number", "ll_uuid", "owner", "address"];

type QuestionAreaFilters = {
  search: string;
  field: SearchField;
  status: string;
  severity: string;
  state: string;
  county: string;
  propertyName: string;
  assignedReviewer: string;
  actionability: ActionabilityFilter;
  hasLegalData: DataAvailabilityFilter;
  hasManagementData: DataAvailabilityFilter;
  hasClientBillData: DataAvailabilityFilter;
};

type SummaryPayload = {
  questionAreas: number;
  comments: number;
  documents: number;
  statuses: Record<string, number>;
  severities: Record<string, number>;
};

type QuestionAreaFilterOptions = {
  states: string[];
  counties: string[];
  propertyNames: string[];
  assignedReviewers: string[];
};

type LayerKey = "land_records" | "management_areas";
type MeasureMode = "distance" | "area";
type MeasureUnit = "metric" | "imperial" | "survey";
type ControlPosition = "topleft" | "topright" | "bottomleft" | "bottomright";

type QuestionAreaProperties = {
  code: string;
  status: string;
  severity: string;
  actionabilityState: string | null;
  title: string;
  summary: string;
  county: string | null;
  state: string | null;
  parcelCode: string | null;
  ownerName: string | null;
  propertyName: string | null;
  tractName: string | null;
  fundName: string | null;
  assignedReviewer: string | null;
  existsInLegalLayer: boolean | null;
  existsInManagementLayer: boolean | null;
  existsInClientTabularBillData: boolean | null;
};

type QuestionAreaFeature = Feature<Geometry, QuestionAreaProperties>;
type QuestionAreaCollection = FeatureCollection<Geometry, QuestionAreaProperties>;

type LayerFeatureProperties = {
  id: number;
  [key: string]: unknown;
};

type LinearRingCoordinates = number[][];
type PolygonCoordinates = LinearRingCoordinates[];
type MultiPolygonCoordinates = PolygonCoordinates[];
type LayerFeature = Feature<Geometry, LayerFeatureProperties>;
type LayerCollection = FeatureCollection<Geometry, LayerFeatureProperties>;

type IdentifyFieldConfig = {
  key: string;
  label: string;
};

type IdentifyLayerConfig = {
  label: string;
  badgeClass: string;
  primaryFields: IdentifyFieldConfig[];
  attributeFields: IdentifyFieldConfig[];
  contextFields: IdentifyFieldConfig[];
};

type IdentifiedFeature = {
  layerKey: LayerKey;
  feature: LayerFeature;
  latlng: L.LatLngLiteral;
};

type IdentifySelection = {
  features: IdentifiedFeature[];
  index: number;
};

type IdentifyFieldRow = {
  key: string;
  label: string;
  value: string;
};

type QuestionAreaDetail = {
  id: number;
  code: string;
  sourceLayer: string;
  status: string;
  severity: string;
  actionabilityState: string | null;
  title: string;
  summary: string;
  description: string | null;
  county: string | null;
  state: string | null;
  parcelCode: string | null;
  ownerName: string | null;
  propertyName: string | null;
  tractName: string | null;
  fundName: string | null;
  landServices: string | null;
  taxBillAcres: number | null;
  gisAcres: number | null;
  existsInLegalLayer: boolean | null;
  existsInManagementLayer: boolean | null;
  existsInClientTabularBillData: boolean | null;
  assignedReviewer: string | null;
  rawProperties: Record<string, unknown> | null;
  geometry: Geometry;
  comments: Array<{
    id: number;
    body: string;
    createdAt: string;
    authorName: string;
    authorRole: string;
  }>;
  documents: Array<{
    id: number;
    originalName: string;
    mimeType: string | null;
    sizeBytes: number;
    createdAt: string;
    downloadUrl: string;
  }>;
};

type EditDraft = {
  status: string;
  severity: string;
  summary: string;
  description: string;
  assignedReviewer: string;
};

type FeedbackState = {
  message: string;
  type: "success" | "error";
};

type BusyState = {
  summary: boolean;
  detail: boolean;
  saving: boolean;
  commenting: boolean;
  uploading: boolean;
  exporting: boolean;
};

type MapWorkspaceProps = {
  session: Session;
  onLogout: () => void;
  onOpenAdmin?: () => void;
};

type LegendItem = {
  key: LayerKey | "qa_markers";
  label: string;
  swatch: string;
  toggleable: boolean;
};

type PropertyTaxMapLayerKey = "regridParcels" | "propertyTaxPoints";

type PropertyTaxMapLayerVisibility = Record<PropertyTaxMapLayerKey, boolean>;

type RegridIdentifyState = {
  status: "idle" | "loading" | "success" | "error";
  latlng: L.LatLngLiteral | null;
  result: RegridIdentifyResult | null;
  error: string | null;
};

type RegridFeatureLayerEvent = L.LeafletEvent & {
  error?: Error;
  feature?: RegridParcelFeature;
  latlng?: L.LatLng;
  layer?: (L.Layer & { bindTooltip?: L.Layer["bindTooltip"]; feature?: RegridParcelFeature }) | null;
  message?: string;
  originalEvent?: Event;
};

type SelectedRegridParcel = {
  parcelId: string | null;
  geometry: Geometry;
  properties: RegridParcelProperties;
  matches: PropertyTaxParcelPointDetail[];
  selectedFrom: "regrid-parcel" | "property-tax-point";
};

type LandRecordLegendItem = {
  key: string;
  label: string;
  swatch: string;
};

type ManagementLegendItem = {
  key: string;
  label: string;
  swatch: string;
};

const STATUS_OPTIONS = ["review", "active", "resolved", "hold"];
const SEVERITY_OPTIONS = ["high", "medium", "low"];
const QA_ACTIONABILITY_STATES: QuestionActionabilityState[] = [
  "normal",
  "high_pain",
  "no_parcel_data",
  "in_progress",
];
const QA_ACTIONABILITY_META: Record<QuestionActionabilityState, { label: string; symbol: string }> = {
  normal: { label: "Normal", symbol: "?" },
  high_pain: { label: "High Pain", symbol: "!" },
  no_parcel_data: { label: "No Parcel Data", symbol: "X" },
  in_progress: { label: "In Progress", symbol: "..." },
};
const SEARCH_FIELD_OPTIONS: Array<{ value: SearchField; label: string }> = [
  { value: "all", label: "All fields" },
  { value: "qa_id", label: "Question Area ID" },
  { value: "parcel_code", label: "Support Context" },
  { value: "county", label: "County / State" },
];
const ACTIONABILITY_OPTIONS: Array<{ value: ActionabilityFilter; label: string }> = [
  { value: "all", label: "All actionability" },
  { value: "open", label: "Open workflow" },
  { value: "closed", label: "Closed workflow" },
  { value: "assigned", label: "Assigned" },
  { value: "unassigned", label: "Unassigned" },
  { value: "needs_data", label: "Needs data" },
  { value: "ready", label: "All data present" },
];
const DATA_AVAILABILITY_OPTIONS: Array<{ value: DataAvailabilityFilter; label: string }> = [
  { value: "all", label: "Any" },
  { value: "available", label: "Available" },
  { value: "missing", label: "Missing" },
  { value: "unknown", label: "Unknown" },
];
const DEFAULT_QA_FILTERS: QuestionAreaFilters = {
  search: "",
  field: "all",
  status: "all",
  severity: "all",
  state: "",
  county: "",
  propertyName: "",
  assignedReviewer: "",
  actionability: "all",
  hasLegalData: "all",
  hasManagementData: "all",
  hasClientBillData: "all",
};

const EMPTY_QA_FILTER_OPTIONS: QuestionAreaFilterOptions = {
  states: [],
  counties: [],
  propertyNames: [],
  assignedReviewers: [],
};

const initialLayers: Record<LayerKey, boolean> = {
  land_records: true,
  management_areas: true,
};

const initialPropertyTaxMapLayers: PropertyTaxMapLayerVisibility = {
  regridParcels: true,
  propertyTaxPoints: true,
};

const LEGEND_ITEMS: LegendItem[] = [
  { key: "qa_markers", label: "Question Areas", swatch: "qa-marker", toggleable: false },
  { key: "land_records", label: "Land Records", swatch: "land-records-summary", toggleable: true },
  { key: "management_areas", label: "Management Areas", swatch: "management-summary", toggleable: true },
];

const LAND_RECORD_STYLE_BY_TYPE: Record<string, PathOptions> = {
  "Access Restrictions": { color: "#a900e6", weight: 2, fillOpacity: 0 },
  Agreement: { color: "#a900e6", weight: 2, fillOpacity: 0 },
  Easement: { color: "#a900e6", weight: 2, fillOpacity: 0 },
  Encumbrance: { color: "#686868", dashArray: "5 3", weight: 2, fillColor: "url(#lr-encumbrance-hatch)", fillOpacity: 1 },
  Exception: { color: "#000000", dashArray: "8 3 2 3", weight: 2.5, fillColor: "url(#lr-exception-hatch)", fillOpacity: 1 },
  Legal: { color: "#0070ff", weight: 2, fillOpacity: 0 },
  "Out Sale": { color: "#ff7f00", dashArray: "8 3 2 3", weight: 2.5, fillColor: "url(#lr-out-sale-hatch)", fillOpacity: 1 },
  "Property Line": { color: "#a900e6", weight: 2, fillOpacity: 0 },
  Reservation: { color: "#a900e6", weight: 2, fillOpacity: 0 },
  "Reservation of Minerals": { color: "#a900e6", weight: 2, fillOpacity: 0 },
  "Right of Way": { color: "#a900e6", weight: 2, fillOpacity: 0 },
  "Title Examination": { color: "#e60000", weight: 2.5, fillOpacity: 0 },
};

const LAND_RECORD_DRAW_PRIORITY_BY_TYPE: Record<string, number> = {
  Legal: 10,
  Easement: 20,
  "Access Restrictions": 20,
  Agreement: 20,
  "Property Line": 20,
  Reservation: 20,
  "Reservation of Minerals": 20,
  "Right of Way": 20,
  Encumbrance: 30,
  "Out Sale": 40,
  Exception: 50,
  "Title Examination": 60,
};

const LAND_RECORD_LEGEND_ITEMS: LandRecordLegendItem[] = [
  { key: "legal", label: "Legal", swatch: "lr-legal" },
  { key: "exception", label: "Exception", swatch: "lr-exception" },
  { key: "out_sale", label: "Out Sale", swatch: "lr-out-sale" },
  { key: "easement", label: "Easement / related", swatch: "lr-easement" },
  { key: "encumbrance", label: "Encumbrance", swatch: "lr-encumbrance" },
  { key: "title_examination", label: "Title Examination", swatch: "lr-title-examination" },
];

const MANAGEMENT_AREA_STYLE_BY_PROPERTY_NAME: Record<string, PathOptions> = {
  "Delta South": {
    color: "#55ff00",
    fillColor: "url(#management-delta-south-pattern)",
    fillOpacity: 1,
    weight: 2,
  },
  "L & C OR": {
    color: "#c500ff",
    fillColor: "url(#management-l-c-or-pattern)",
    fillOpacity: 1,
    weight: 2,
  },
  "Latrobe PA NY": {
    color: "#ffaa00",
    fillColor: "url(#management-latrobe-pa-ny-pattern)",
    fillOpacity: 1,
    weight: 2,
  },
  "Quercus WV": {
    color: "#734c00",
    fillColor: "url(#management-quercus-wv-pattern)",
    fillOpacity: 1,
    weight: 1.5,
  },
};

const MANAGEMENT_AREA_DRAW_PRIORITY_BY_PROPERTY_NAME: Record<string, number> = {
  "Delta South": 10,
  "L & C OR": 10,
  "Latrobe PA NY": 10,
  "Quercus WV": 10,
};

const MANAGEMENT_AREA_LEGEND_ITEMS: ManagementLegendItem[] = [
  { key: "delta_south", label: "Delta South", swatch: "management-delta-south" },
  { key: "l_c_or", label: "L & C OR", swatch: "management-l-c-or" },
  { key: "latrobe_pa_ny", label: "Latrobe PA NY", swatch: "management-latrobe-pa-ny" },
  { key: "quercus_wv", label: "Quercus WV", swatch: "management-quercus-wv" },
  { key: "other", label: "Other Management Areas", swatch: "management-other" },
];
const IDENTIFY_LAYER_ORDER: LayerKey[] = ["management_areas", "land_records"];

const IDENTIFY_LAYER_CONFIG: Record<LayerKey, IdentifyLayerConfig> = {
  land_records: {
    label: "Land Record",
    badgeClass: "land-records",
    primaryFields: [
      { key: "taxparcelnum", label: "Tax Parcel Number" },
      { key: "lr_number", label: "LR Number" },
      { key: "docnumber", label: "Document Number" },
    ],
    attributeFields: [
      { key: "current_owner", label: "Current Owner" },
      { key: "previous_owner", label: "Previous Owner" },
      { key: "lr_type", label: "LR Type" },
      { key: "doctype", label: "Document Type" },
      { key: "lr_status", label: "LR Status" },
      { key: "tax_confirm", label: "Tax Confirmed" },
    ],
    contextFields: [
      { key: "propertyname", label: "Property" },
      { key: "tractkey", label: "Tract Key" },
      { key: "fundname", label: "Fund" },
      { key: "county", label: "County" },
      { key: "state", label: "State" },
      { key: "regionname", label: "Region" },
      { key: "deedacres", label: "Deed Acres" },
      { key: "gisacres", label: "GIS Acres" },
    ],
  },
  management_areas: {
    label: "Management Area",
    badgeClass: "management",
    primaryFields: [
      { key: "property_code", label: "Property Code" },
      { key: "property_name", label: "Property" },
      { key: "portfolio", label: "Portfolio" },
    ],
    attributeFields: [
      { key: "status", label: "Status" },
      { key: "fund_name", label: "Fund" },
      { key: "management_type", label: "Management Type" },
      { key: "investment_manager", label: "Investment Manager" },
      { key: "business_unit", label: "Business Unit" },
      { key: "crops", label: "Crops" },
    ],
    contextFields: [
      { key: "county", label: "County" },
      { key: "state", label: "State" },
      { key: "region", label: "Region" },
      { key: "country", label: "Country" },
      { key: "gross_acres", label: "Gross Acres" },
      { key: "tillable_acres", label: "Tillable Acres" },
      { key: "gis_acres", label: "GIS Acres" },
      { key: "effective_date", label: "Effective Date" },
    ],
  },
};

const landRecordStyle: PathOptions = {
  color: "#0070ff",
  weight: 2,
  fillOpacity: 0,
};

const managementAreaStyle: PathOptions = {
  color: "#39ff14",
  weight: 2,
  fillColor: "#39ff14",
  fillOpacity: 0.06,
};

const regridParcelStyle: PathOptions = {
  className: "regrid-parcel-path",
  color: "#6b7280",
  fillOpacity: 0,
  opacity: 0.92,
  weight: 1.6,
};

const matchedRegridParcelStyle: PathOptions = {
  className: "regrid-parcel-path",
  color: "#8a00c4",
  fillColor: "#d8b4fe",
  fillOpacity: 0.28,
  opacity: 0.98,
  weight: 3,
};

const activeRegridParcelStyle: PathOptions = {
  color: "#0f172a",
  fillColor: "#f59e0b",
  fillOpacity: 0.28,
  weight: 3,
};

const BASEMAPS = {
  osm: {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    label: "OpenStreetMap",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  },
  usgsImagery: {
    attribution:
      'USDA, USGS The National Map: Orthoimagery. Data refreshed June 2024. Map services and data available from U.S. Geological Survey, National Geospatial Program.',
    label: "USGS Orthoimagery",
    maxNativeZoom: 16,
    url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
  },
} as const;

const POSITION_CLASSES: Record<ControlPosition, string> = {
  bottomleft: "leaflet-bottom leaflet-left",
  bottomright: "leaflet-bottom leaflet-right",
  topleft: "leaflet-top leaflet-left",
  topright: "leaflet-top leaflet-right",
};

export function MapWorkspace({ session, onLogout, onOpenAdmin }: MapWorkspaceProps) {
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [questionAreas, setQuestionAreas] = useState<QuestionAreaCollection | null>(null);
  const [mapBbox, setMapBbox] = useState("-126,24,-66,49");
  const [mapZoom, setMapZoom] = useState(4);
  const [layerVisibility, setLayerVisibility] = useState(initialLayers);
  const [layerData, setLayerData] = useState<Partial<Record<LayerKey, LayerCollection>>>({});
  const [propertyTaxLayerVisibility, setPropertyTaxLayerVisibility] = useState(initialPropertyTaxMapLayers);
  const [propertyTaxPoints, setPropertyTaxPoints] = useState<PropertyTaxPointCollection | null>(null);
  const [matchedRegridParcels, setMatchedRegridParcels] = useState<RegridParcelCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const [propertyTaxMapError, setPropertyTaxMapError] = useState<string | null>(null);
  const [regridLayerNotice, setRegridLayerNotice] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState<QuestionAreaFilters>(DEFAULT_QA_FILTERS);
  const [filterOptions, setFilterOptions] = useState<QuestionAreaFilterOptions>(EMPTY_QA_FILTER_OPTIONS);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<QuestionAreaDetail | null>(null);
  const [identifySelection, setIdentifySelection] = useState<IdentifySelection | null>(null);
  const [regridIdentifyState, setRegridIdentifyState] = useState<RegridIdentifyState>({
    status: "idle",
    latlng: null,
    result: null,
    error: null,
  });
  const [selectedRegridParcel, setSelectedRegridParcel] = useState<SelectedRegridParcel | null>(null);
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [supportWorkspaceTab, setSupportWorkspaceTab] = useState<SupportWorkspaceTab | null>(() => {
    return getVisibleSupportTabs(session.user.role)[0]?.id ?? null;
  });
  const [atlasBufferFeet, setAtlasBufferFeet] = useState<AtlasBufferFeet>(500);
  const [taxParcelBufferFeet, setTaxParcelBufferFeet] = useState<TaxParcelBufferFeet>(500);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft>({
    status: "review",
    severity: "medium",
    summary: "",
    description: "",
    assignedReviewer: "",
  });
  const [commentDraft, setCommentDraft] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [busy, setBusy] = useState<BusyState>({
    summary: false,
    detail: false,
    saving: false,
    commenting: false,
    uploading: false,
    exporting: false,
  });

  const deferredSearch = useDeferredValue(searchInput);
  const visibleSupportTabs = useMemo(
    () => getVisibleSupportTabs(session.user.role),
    [session.user.role],
  );
  const hasSupportWorkspace = visibleSupportTabs.length > 0;
  const canReadQuestionAreas = hasPermission(session.user.role, "question_areas:read");
  const canReviewQuestionAreas = hasPermission(session.user.role, "question_areas:review");
  const canAssignQuestionAreas = hasPermission(session.user.role, "question_areas:assign");
  const canCommentOnQuestionAreas = hasPermission(session.user.role, "question_areas:comment");
  const canUploadQuestionAreaDocuments = hasPermission(session.user.role, "question_areas:upload_document");
  const canReadAtlas = hasPermission(session.user.role, "atlas_land_records:read");
  const canReadPropertyTaxMap = hasPermission(session.user.role, "property_tax_map:read");
  const canReadPropertyTax = hasPermission(session.user.role, "property_tax:read");
  const selectedPropertyTaxPointIds = useMemo(
    () => new Set((selectedRegridParcel?.matches ?? []).map((match) => match.id)),
    [selectedRegridParcel],
  );
  const handleViewportChange = useCallback((bbox: string, zoom: number) => {
    startTransition(() => {
      setMapBbox((current) => (areMapBboxesEqual(current, bbox) ? current : bbox));
      setMapZoom((current) => (current === zoom ? current : zoom));
    });
  }, []);
  const atlasState = useAtlasQuery({
    token: session.token,
    questionAreaCode: selectedCode,
    bufferFeet: atlasBufferFeet,
    enabled: supportWorkspaceTab === "atlas" && canReadAtlas,
  });
  const taxParcelState = useTaxParcelQuery({
    token: session.token,
    questionAreaCode: selectedCode,
    bufferFeet: taxParcelBufferFeet,
    enabled: supportWorkspaceTab === "tax-parcels" && canReadPropertyTax,
  });

  function showFeedback(message: string, type: FeedbackState["type"] = "error") {
    setFeedback({ message, type });
  }

  useEffect(() => {
    setSupportWorkspaceTab((current) => {
      if (current && visibleSupportTabs.some((tab) => tab.id === current)) {
        return current;
      }

      return visibleSupportTabs[0]?.id ?? null;
    });
  }, [visibleSupportTabs]);

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timer = window.setTimeout(() => setFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    let alive = true;
    setBusy((current) => ({ ...current, summary: true }));

    apiRequest<SummaryPayload>("/dashboard/summary", { token: session.token })
      .then((payload) => {
        if (alive) {
          setSummary(payload);
        }
      })
      .catch((error) => {
        if (alive) {
          showFeedback(error instanceof Error ? error.message : "Failed to load summary.");
        }
      })
      .finally(() => {
        if (alive) {
          setBusy((current) => ({ ...current, summary: false }));
        }
      });

    return () => {
      alive = false;
    };
  }, [session.token]);

  useEffect(() => {
    let alive = true;

    apiRequest<QuestionAreaFilterOptions>("/question-areas/filter-options", { token: session.token })
      .then((payload) => {
        if (alive) {
          setFilterOptions(payload);
        }
      })
      .catch((error) => {
        if (alive) {
          showFeedback(error instanceof Error ? error.message : "Failed to load filter options.");
        }
      });

    return () => {
      alive = false;
    };
  }, [session.token]);

  useEffect(() => {
    const query = deferredSearch.trim();
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    let alive = true;
    const params = new URLSearchParams({ q: query, field: filters.field });

    apiRequest<{ results: SearchResult[] }>(`/dashboard/search?${params.toString()}`, {
      token: session.token,
    })
      .then((payload) => {
        if (alive) {
          startTransition(() => setSearchResults(payload.results));
        }
      })
      .catch(() => {
        if (alive) {
          setSearchResults([]);
        }
      });

    return () => {
      alive = false;
    };
  }, [deferredSearch, filters.field, session.token]);

  useEffect(() => {
    let alive = true;
    const abortController = new AbortController();
    const params = buildQuestionAreaQueryParams(filters, mapBbox, "600");

    const timeoutId = window.setTimeout(() => {
      apiRequest<QuestionAreaCollection>(`/question-areas?${params.toString()}`, {
        token: session.token,
        signal: abortController.signal,
      })
        .then((payload) => {
          if (!alive) {
            return;
          }

          setQuestionAreas(payload);
          if (payload.features.length === 1) {
            setSelectedCode(payload.features[0]?.properties?.code ?? null);
          }
        })
        .catch((error) => {
          if (alive && !isAbortError(error)) {
            showFeedback(error instanceof Error ? error.message : "Failed to load question areas.");
          }
        });
    }, MAP_DATA_FETCH_DEBOUNCE_MS);

    return () => {
      alive = false;
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [filters, mapBbox, session.token]);

  useEffect(() => {
    const visibleLayers = (Object.keys(layerVisibility) as LayerKey[]).filter(
      (layerKey) => layerVisibility[layerKey],
    );

    if (visibleLayers.length === 0) {
      setLayerData({});
      return;
    }

    let alive = true;
    const abortController = new AbortController();

    const timeoutId = window.setTimeout(() => {
      Promise.all(
        visibleLayers.map(async (layerKey) => {
          const payload = await apiRequest<LayerCollection>(
            `/layers/${layerKey}?bbox=${encodeURIComponent(mapBbox)}`,
            { token: session.token, signal: abortController.signal },
          );
          return [layerKey, payload] as const;
        }),
      )
        .then((entries) => {
          if (!alive) {
            return;
          }

          const nextLayerData: Partial<Record<LayerKey, LayerCollection>> = {};
          entries.forEach(([layerKey, payload]) => {
            nextLayerData[layerKey] = payload;
          });
          setLayerData(nextLayerData);
        })
        .catch((error) => {
          if (alive && !isAbortError(error)) {
            showFeedback(error instanceof Error ? error.message : "Failed to load map layers.");
          }
        });
    }, MAP_DATA_FETCH_DEBOUNCE_MS);

    return () => {
      alive = false;
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [layerVisibility, mapBbox, session.token]);

  useEffect(() => {
    if (!canReadPropertyTaxMap) {
      setPropertyTaxPoints(null);
      setMatchedRegridParcels({ type: "FeatureCollection", features: [] });
      setPropertyTaxMapError(null);
      return;
    }

    const shouldFetchPropertyTaxPoints = propertyTaxLayerVisibility.propertyTaxPoints;
    if (!shouldFetchPropertyTaxPoints) {
      setPropertyTaxPoints(null);
      setPropertyTaxMapError(null);
      return;
    }

    let alive = true;
    const abortController = new AbortController();
    setPropertyTaxMapError(null);

    const timeoutId = window.setTimeout(() => {
      fetchPropertyTaxPoints({ bbox: mapBbox, token: session.token, signal: abortController.signal })
        .then((nextPropertyTaxPoints) => {
          if (!alive) {
            return;
          }

          setPropertyTaxPoints(nextPropertyTaxPoints);
        })
        .catch((error) => {
          if (alive && !isAbortError(error)) {
            setPropertyTaxMapError(error instanceof Error ? error.message : "Failed to load property tax points.");
          }
        });
    }, MAP_DATA_FETCH_DEBOUNCE_MS);

    return () => {
      alive = false;
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [canReadPropertyTaxMap, mapBbox, propertyTaxLayerVisibility.propertyTaxPoints, session.token]);

  useEffect(() => {
    if (!canReadPropertyTaxMap || !propertyTaxLayerVisibility.regridParcels || mapZoom < PROPERTY_TAX_REGRID_MIN_ZOOM) {
      setMatchedRegridParcels({ type: "FeatureCollection", features: [] });
      return;
    }

    let alive = true;
    const abortController = new AbortController();

    const timeoutId = window.setTimeout(() => {
      fetchRegridParcels({
        bbox: mapBbox,
        matchedOnly: true,
        token: session.token,
        zoom: mapZoom,
        signal: abortController.signal,
      })
        .then((collection) => {
          if (!alive) {
            return;
          }

          setMatchedRegridParcels(collectMatchedRegridParcels(collection));
        })
        .catch((error) => {
          if (alive && !isAbortError(error)) {
            setMatchedRegridParcels({ type: "FeatureCollection", features: [] });
          }
        });
    }, MAP_DATA_FETCH_DEBOUNCE_MS);

    return () => {
      alive = false;
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [canReadPropertyTaxMap, mapBbox, mapZoom, propertyTaxLayerVisibility.regridParcels, session.token]);

  useEffect(() => {
    if (!canReadPropertyTaxMap || !propertyTaxLayerVisibility.regridParcels) {
      setRegridLayerNotice(null);
    }
  }, [canReadPropertyTaxMap, propertyTaxLayerVisibility.regridParcels]);

  useEffect(() => {
    if (!identifySelection) {
      return;
    }

    const visibleFeatures = identifySelection.features.filter((identified) => layerVisibility[identified.layerKey]);
    if (visibleFeatures.length === 0) {
      setIdentifySelection(null);
      return;
    }

    if (visibleFeatures.length !== identifySelection.features.length) {
      setIdentifySelection({
        features: visibleFeatures,
        index: Math.min(identifySelection.index, visibleFeatures.length - 1),
      });
    }
  }, [identifySelection, layerVisibility]);

  useEffect(() => {
    if (!selectedCode) {
      setSelectedDetail(null);
      return;
    }

    let alive = true;
    setBusy((current) => ({ ...current, detail: true }));

    apiRequest<QuestionAreaDetail>(`/question-areas/${selectedCode}`, { token: session.token })
      .then((payload) => {
        if (!alive) {
          return;
        }

        setSelectedDetail(payload);
        setEditDraft({
          status: payload.status,
          severity: payload.severity,
          summary: payload.summary,
          description: payload.description ?? "",
          assignedReviewer: payload.assignedReviewer ?? "",
        });
      })
      .catch((error) => {
        if (alive) {
          showFeedback(error instanceof Error ? error.message : "Failed to load details.");
        }
      })
      .finally(() => {
        if (alive) {
          setBusy((current) => ({ ...current, detail: false }));
        }
      });

    return () => {
      alive = false;
    };
  }, [selectedCode, session.token]);

  useEffect(() => {
    setCommentDraft("");
    setSelectedFile(null);
    setUploadInputKey((current) => current + 1);
  }, [selectedCode]);

  async function refreshSummary() {
    const payload = await apiRequest<SummaryPayload>("/dashboard/summary", { token: session.token });
    setSummary(payload);
  }

  async function reloadDetail() {
    if (!selectedCode) {
      return;
    }

    const payload = await apiRequest<QuestionAreaDetail>(`/question-areas/${selectedCode}`, {
      token: session.token,
    });

    setSelectedDetail(payload);
    setEditDraft({
      status: payload.status,
      severity: payload.severity,
      summary: payload.summary,
      description: payload.description ?? "",
      assignedReviewer: payload.assignedReviewer ?? "",
    });
  }

  async function handleSaveDetail() {
    if (!selectedCode) {
      return;
    }
    if (!canReviewQuestionAreas && !canAssignQuestionAreas) {
      showFeedback("This review action is not available for your access level.");
      return;
    }
    if (canReviewQuestionAreas && !editDraft.summary.trim()) {
      showFeedback("Summary is required.");
      return;
    }

    setBusy((current) => ({ ...current, saving: true }));
    setFeedback(null);

    try {
      const body: {
        status?: string;
        severity?: string;
        summary?: string;
        description?: string | null;
        assignedReviewer?: string | null;
      } = {};
      if (canReviewQuestionAreas) {
        body.status = editDraft.status;
        body.severity = editDraft.severity;
        body.summary = editDraft.summary.trim();
        body.description = editDraft.description.trim() || null;
      }
      if (canAssignQuestionAreas) {
        body.assignedReviewer = editDraft.assignedReviewer.trim() || null;
      }

      await apiRequest(`/question-areas/${selectedCode}`, {
        method: "PATCH",
        token: session.token,
        body,
      });
      setQuestionAreas((current) =>
        current
          ? {
              ...current,
              features: current.features.map((feature) =>
                feature.properties.code === selectedCode
                  ? {
                      ...feature,
                      properties: {
                        ...feature.properties,
                        status: editDraft.status,
                        severity: editDraft.severity,
                      },
                    }
                  : feature,
              ),
            }
          : current,
      );
      await Promise.all([reloadDetail(), refreshSummary()]);
      showFeedback("Question area updated.", "success");
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Update failed.");
    } finally {
      setBusy((current) => ({ ...current, saving: false }));
    }
  }

  async function handleCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCode) {
      return;
    }
    if (!canCommentOnQuestionAreas) {
      showFeedback("Commenting is not available for your access level.");
      return;
    }
    if (!commentDraft.trim()) {
      showFeedback("Comment text is required.");
      return;
    }

    setBusy((current) => ({ ...current, commenting: true }));
    setFeedback(null);

    try {
      await apiRequest(`/question-areas/${selectedCode}/comments`, {
        method: "POST",
        token: session.token,
        body: { body: commentDraft.trim() },
      });
      setCommentDraft("");
      await Promise.all([reloadDetail(), refreshSummary()]);
      showFeedback("Comment posted.", "success");
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Comment failed.");
    } finally {
      setBusy((current) => ({ ...current, commenting: false }));
    }
  }

  async function handleUploadDocument() {
    if (!selectedCode || !selectedFile) {
      return;
    }
    if (!canUploadQuestionAreaDocuments) {
      showFeedback("Document uploads are not available for your access level.");
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);

    setBusy((current) => ({ ...current, uploading: true }));
    setFeedback(null);

    try {
      await apiRequest(`/question-areas/${selectedCode}/documents`, {
        method: "POST",
        token: session.token,
        formData,
      });
      setSelectedFile(null);
      setUploadInputKey((current) => current + 1);
      await Promise.all([reloadDetail(), refreshSummary()]);
      showFeedback("Document uploaded.", "success");
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy((current) => ({ ...current, uploading: false }));
    }
  }

  async function handleDownloadDocument(fileRecord: QuestionAreaDetail["documents"][number]) {
    try {
      const blob = await apiDownload(fileRecord.downloadUrl, session.token);
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = fileRecord.originalName;
      link.click();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Download failed.");
    }
  }

  function selectQuestionArea(code: string | null) {
    setSelectedCode(code);
    setSearchResults([]);
  }

  async function handleExportQuestionAreas() {
    setBusy((current) => ({ ...current, exporting: true }));
    try {
      const params = buildQuestionAreaQueryParams(filters, mapBbox);
      const queryString = params.toString();
      const path = `/api/question-areas/export.xlsx${queryString ? `?${queryString}` : ""}`;
      const blob = await apiDownload(path, session.token);
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = "question-area-report.xlsx";
      link.click();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
      showFeedback("Spreadsheet export started.", "success");
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setBusy((current) => ({ ...current, exporting: false }));
    }
  }

  function identifyFeaturesAtLocation(latlng: L.LatLngLiteral) {
    const features = findIdentifiedFeatures(layerData, layerVisibility, latlng);
    setIdentifySelection(features.length > 0 ? { features, index: 0 } : null);
  }

  async function handleRegridParcelIdentify(
    latlng: L.LatLngLiteral,
    selectedFrom: SelectedRegridParcel["selectedFrom"] = "regrid-parcel",
    clickedFeature?: RegridParcelFeature,
  ) {
    setIdentifySelection(null);
    setRegridIdentifyState({
      status: "loading",
      latlng,
      result: null,
      error: null,
    });
    setSelectedRegridParcel(null);

    if (!canReadPropertyTaxMap) {
      const result = createFeatureOnlyRegridIdentifyResult(latlng, clickedFeature);
      setSelectedRegridParcel(createSelectedRegridParcel(result, selectedFrom, clickedFeature));
      setRegridIdentifyState({
        status: "success",
        latlng,
        result,
        error: null,
      });
      return;
    }

    try {
      const result = await identifyRegridParcel(session.token, latlng);
      setSelectedRegridParcel(createSelectedRegridParcel(result, selectedFrom, clickedFeature));
      setRegridIdentifyState({
        status: "success",
        latlng,
        result,
        error: null,
      });
    } catch (error) {
      setRegridIdentifyState({
        status: "error",
        latlng,
        result: null,
        error: error instanceof Error ? error.message : "Failed to identify Regrid parcel.",
      });
      setSelectedRegridParcel(null);
    }
  }

  function handlePropertyTaxPointIdentify(point: PropertyTaxParcelPointProperties) {
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
      return;
    }

    void handleRegridParcelIdentify(
      { lat: Number(point.latitude), lng: Number(point.longitude) },
      "property-tax-point",
    );
  }

  function identifyLayerFeature(layerKey: LayerKey, feature: LayerFeature, latlng: L.LatLngLiteral) {
    const features = findIdentifiedFeatures(layerData, layerVisibility, latlng);
    const clickedIndex = features.findIndex(
      (identified) =>
        identified.layerKey === layerKey &&
        identified.feature.properties.id === feature.properties.id,
    );

    setIdentifySelection({
      features:
        features.length > 0
          ? features
          : [{ layerKey, feature, latlng }],
      index: clickedIndex >= 0 ? clickedIndex : 0,
    });
  }

  function cycleIdentifiedFeature(direction: -1 | 1) {
    setIdentifySelection((current) => {
      if (!current || current.features.length < 2) {
        return current;
      }

      return {
        ...current,
        index: (current.index + direction + current.features.length) % current.features.length,
      };
    });
  }

  function toggleLayer(layerKey: LayerKey) {
    setLayerVisibility((current) => ({
      ...current,
      [layerKey]: !current[layerKey],
    }));
  }

  function togglePropertyTaxLayer(layerKey: PropertyTaxMapLayerKey) {
    setPropertyTaxLayerVisibility((current) => ({
      ...current,
      [layerKey]: !current[layerKey],
    }));
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateFilters({ search: searchInput.trim() });
  }

  function updateFilters(nextFilters: Partial<QuestionAreaFilters>) {
    setFilters((current) => ({ ...current, ...nextFilters }));
  }

  function clearFilters() {
    setSearchInput("");
    setFilters(DEFAULT_QA_FILTERS);
    setSearchResults([]);
  }

  const filteredAreaCount = questionAreas?.features.length ?? 0;
  const openQuestionAreas = (summary?.statuses.review ?? 0) + (summary?.statuses.active ?? 0);
  const selectedLocation = [selectedDetail?.county, selectedDetail?.state].filter(Boolean).join(", ");
  const selectedContext = selectedLocation;
  const selectedSupportTarget: AtlasTarget & TaxParcelTarget | null = selectedDetail
    ? {
        code: selectedDetail.code,
        county: selectedDetail.county,
        parcelCode: selectedDetail.parcelCode,
        state: selectedDetail.state,
        summary: selectedDetail.summary,
        title: selectedDetail.title,
      }
    : null;
  const identifiedFeature = identifySelection?.features[identifySelection.index] ?? null;

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div className="header-main">
          <div className="header-brand">
            <p className="eyebrow">QAViewer</p>
            <h1>NNC Review Workspace</h1>
          </div>
          <div className="header-summary-strip" aria-label="Workspace summary">
            <HeaderSummaryChip label="Question Areas" value={summary?.questionAreas ?? "-"} />
            <HeaderSummaryChip label="Open Review" value={summary ? openQuestionAreas : "-"} />
            <HeaderSummaryChip label="Comments" value={summary?.comments ?? "-"} />
            <HeaderSummaryChip label="Documents" value={summary?.documents ?? "-"} />
          </div>
          {selectedDetail ? (
            <div className="header-active-record">
              <div className="header-active-record-label">
                <span className="eyebrow">Active Review</span>
                <strong>{selectedDetail.code}</strong>
              </div>
              <div className="header-active-record-copy">
                <span>{selectedDetail.title}</span>
                <small>{selectedContext || "Question area selected"}</small>
              </div>
              <div className="header-active-record-badges">
                <BadgeDescriptor
                  label="Workflow status"
                  value={workflowLabel(selectedDetail.status)}
                  badgeClass={workflowBadgeClass(selectedDetail.status)}
                />
                <BadgeDescriptor
                  label="Severity level"
                  value={humanize(selectedDetail.severity)}
                  badgeClass={severityBadgeClass(selectedDetail.severity)}
                />
                <BadgeDescriptor
                  label="Action needed"
                  value={actionabilityLabel(selectedDetail.actionabilityState)}
                  badgeClass={actionabilityBadgeClass(selectedDetail.actionabilityState)}
                />
              </div>
            </div>
          ) : null}
        </div>
        <div className="header-actions">
          <div className="header-actions-layout">
            <div className="header-button-row">
              {onOpenAdmin ? (
                <button className="ghost-button" onClick={onOpenAdmin} type="button">
                  Admin
                </button>
              ) : null}
              <button className="ghost-button" onClick={onLogout} type="button">
                Sign out
              </button>
            </div>
            <span className="user-name-sub">{session.user.name}</span>
          </div>
        </div>
      </header>

      {feedback ? <div className={`toast toast-${feedback.type}`}>{feedback.message}</div> : null}

      <section
        className={[
          "workspace-grid",
          selectedCode ? "review-active" : "browse-active",
          hasSupportWorkspace ? "" : "support-hidden",
          leftPanelCollapsed ? "left-collapsed" : "",
          hasSupportWorkspace && rightPanelCollapsed ? "right-collapsed" : "",
          hasSupportWorkspace && leftPanelCollapsed && rightPanelCollapsed ? "both-collapsed" : "",
        ].join(" ")}
      >
        <aside
          className={`workspace-panel left-panel ${leftPanelCollapsed ? "collapsed" : ""} ${
            selectedCode ? "review-mode" : "browse-mode"
          }`}
        >
          <button
            className="collapse-toggle"
            onClick={() => setLeftPanelCollapsed((current) => !current)}
            title={leftPanelCollapsed ? "Expand panel" : "Collapse panel"}
            type="button"
          >
            {leftPanelCollapsed ? ">" : "<"}
          </button>

          <div className="panel-content">
            {selectedCode ? (
              <>
                <section className="panel-section review-shell-intro">
                  <div className="section-heading">
                    <h2>Review</h2>
                  </div>
                  <div className="review-shell-actions">
                    <button className="ghost-button" onClick={() => selectQuestionArea(null)} type="button">
                      Back to Results
                    </button>
                  </div>
                </section>

                {busy.detail ? <SkeletonDetail /> : null}
                {!busy.detail && !selectedDetail ? (
                  <section className="panel-section">
                    <p className="empty-state">
                      The selected review record could not be loaded. Return to the results list and try again.
                    </p>
                  </section>
                ) : null}
                {selectedDetail ? (
                  <ReviewRecordSections
                    busy={busy}
                    canAssignQuestionAreas={canAssignQuestionAreas}
                    canCommentOnQuestionAreas={canCommentOnQuestionAreas}
                    canReadQuestionAreas={canReadQuestionAreas}
                    canReviewQuestionAreas={canReviewQuestionAreas}
                    canUploadQuestionAreaDocuments={canUploadQuestionAreaDocuments}
                    commentDraft={commentDraft}
                    editDraft={editDraft}
                    handleCommentSubmit={handleCommentSubmit}
                    handleDownloadDocument={handleDownloadDocument}
                    handleSaveDetail={handleSaveDetail}
                    handleUploadDocument={handleUploadDocument}
                    selectedDetail={selectedDetail}
                    selectedFile={selectedFile}
                    setCommentDraft={setCommentDraft}
                    setEditDraft={setEditDraft}
                    setSelectedFile={setSelectedFile}
                    uploadInputKey={uploadInputKey}
                  />
                ) : null}
              </>
            ) : (
              <>
                <section className="panel-section browse-panel-intro">
                  <div className="section-heading">
                    <h2>Browse Question Areas</h2>
                    <span>{busy.summary ? "Refreshing..." : "Select a record to review"}</span>
                  </div>
                  <p className="panel-note">
                    Search and filter the current map extent, then pick a question area to open its review workflow.
                  </p>
                </section>

                <section className="panel-section">
                  <div className="section-heading">
                    <h2>Search</h2>
                    <span>Question areas only</span>
                  </div>
                  <form className="search-stack" onSubmit={handleSearchSubmit}>
                    <div className="search-box">
                      <input
                        className="search-input"
                        onChange={(event) => setSearchInput(event.target.value)}
                        placeholder="Search question area, tax parcel, owner, county..."
                        type="text"
                        value={searchInput}
                      />
                      {searchResults.length > 0 ? (
                        <div className="search-results">
                          {searchResults.map((result) => (
                            <button
                              key={`${result.type}-${result.id}`}
                              className="search-result"
                              onClick={() => selectQuestionArea(result.id)}
                              type="button"
                            >
                              <strong>{result.id}</strong>
                              <span>{result.label}</span>
                              <span>{result.subtitle || "Question area"}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="filter-grid">
                      <label>
                        Search field
                        <select
                          value={filters.field}
                          onChange={(event) => updateFilters({ field: event.target.value as SearchField })}
                        >
                          {SEARCH_FIELD_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Status
                        <select
                          value={filters.status}
                          onChange={(event) => updateFilters({ status: event.target.value })}
                        >
                          <option value="all">All statuses</option>
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>
                              {workflowLabel(status)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Priority
                        <select
                          value={filters.severity}
                          onChange={(event) => updateFilters({ severity: event.target.value })}
                        >
                          <option value="all">All priorities</option>
                          {SEVERITY_OPTIONS.map((severity) => (
                            <option key={severity} value={severity}>
                              {humanize(severity)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Actionability
                        <select
                          value={filters.actionability}
                          onChange={(event) =>
                            updateFilters({ actionability: event.target.value as ActionabilityFilter })
                          }
                        >
                          {ACTIONABILITY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        State
                        <select
                          onChange={(event) => updateFilters({ state: event.target.value })}
                          value={filters.state}
                        >
                          <option value="">All states</option>
                          {withCurrentOption(filterOptions.states, filters.state).map((state) => (
                            <option key={state} value={state}>
                              {state}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        County
                        <select
                          onChange={(event) => updateFilters({ county: event.target.value })}
                          value={filters.county}
                        >
                          <option value="">All counties</option>
                          {withCurrentOption(filterOptions.counties, filters.county).map((county) => (
                            <option key={county} value={county}>
                              {county}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Property
                        <select
                          onChange={(event) => updateFilters({ propertyName: event.target.value })}
                          value={filters.propertyName}
                        >
                          <option value="">All properties</option>
                          {withCurrentOption(filterOptions.propertyNames, filters.propertyName).map((propertyName) => (
                            <option key={propertyName} value={propertyName}>
                              {propertyName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Reviewer
                        <select
                          onChange={(event) => updateFilters({ assignedReviewer: event.target.value })}
                          value={filters.assignedReviewer}
                        >
                          <option value="">All reviewers</option>
                          {withCurrentOption(filterOptions.assignedReviewers, filters.assignedReviewer).map((reviewer) => (
                            <option key={reviewer} value={reviewer}>
                              {reviewer}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="filter-grid data-filter-grid">
                      <label>
                        Legal data
                        <select
                          value={filters.hasLegalData}
                          onChange={(event) =>
                            updateFilters({ hasLegalData: event.target.value as DataAvailabilityFilter })
                          }
                        >
                          {DATA_AVAILABILITY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Management data
                        <select
                          value={filters.hasManagementData}
                          onChange={(event) =>
                            updateFilters({ hasManagementData: event.target.value as DataAvailabilityFilter })
                          }
                        >
                          {DATA_AVAILABILITY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Client bill data
                        <select
                          value={filters.hasClientBillData}
                          onChange={(event) =>
                            updateFilters({ hasClientBillData: event.target.value as DataAvailabilityFilter })
                          }
                        >
                          {DATA_AVAILABILITY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="search-input-row">
                      <button className="primary-button" type="submit">
                        Apply filter
                      </button>
                      <button className="ghost-button" onClick={clearFilters} type="button">
                        Clear
                      </button>
                    </div>
                  </form>
                </section>

                <section className="panel-section">
                  <div className="section-heading">
                    <h2>Visible Results</h2>
                    <div className="section-heading-actions">
                      <span>{filteredAreaCount} in map extent</span>
                      <button
                        className="ghost-button compact-button"
                        disabled={busy.exporting || filteredAreaCount === 0}
                        onClick={() => void handleExportQuestionAreas()}
                        type="button"
                      >
                        {busy.exporting ? "Exporting..." : "Export XLSX"}
                      </button>
                    </div>
                  </div>
                  <div className="result-list">
                    {questionAreas?.features.map((feature) => {
                      const properties = feature.properties;
                      const subtitle = [properties.parcelCode, properties.county, properties.state]
                        .filter(Boolean)
                        .join(" | ");

                      return (
                        <button
                          key={properties.code}
                          className={`list-card ${selectedCode === properties.code ? "selected" : ""}`}
                          onClick={() => selectQuestionArea(properties.code)}
                          type="button"
                        >
                          <div className="list-card-body">
                            <div className="user-card-head">
                              <strong>{properties.code}</strong>
                              <span className="list-card-badges">
                                <span className={`badge ${workflowBadgeClass(properties.status)}`}>
                                  {workflowLabel(properties.status)}
                                </span>
                                <span className={`badge ${severityBadgeClass(properties.severity)}`}>
                                  {humanize(properties.severity)}
                                </span>
                                <span className={`badge ${actionabilityBadgeClass(properties.actionabilityState)}`}>
                                  {actionabilityLabel(properties.actionabilityState)}
                                </span>
                              </span>
                            </div>
                            <span className="list-card-title">{properties.title}</span>
                            <span className="list-card-subtitle">{subtitle || properties.summary}</span>
                          </div>
                        </button>
                      );
                    })}
                    {!questionAreas || questionAreas.features.length === 0 ? (
                      <p className="empty-state">No question areas match the current map extent and filters.</p>
                    ) : null}
                  </div>
                </section>
              </>
            )}
          </div>
        </aside>

        <section className="map-panel">
          <MapContainer
            center={[39.5, -98.35]}
            className="leaflet-shell"
            scrollWheelZoom
            zoom={4}
          >
            <LayersControl collapsed position="topright">
              <LayersControl.BaseLayer checked name={BASEMAPS.osm.label}>
                <TileLayer attribution={BASEMAPS.osm.attribution} url={BASEMAPS.osm.url} />
              </LayersControl.BaseLayer>
              <LayersControl.BaseLayer name={BASEMAPS.usgsImagery.label}>
                <TileLayer
                  attribution={BASEMAPS.usgsImagery.attribution}
                  maxNativeZoom={BASEMAPS.usgsImagery.maxNativeZoom}
                  url={BASEMAPS.usgsImagery.url}
                />
              </LayersControl.BaseLayer>
            </LayersControl>
            <MapLegendControl
              canReadPropertyTaxMap={canReadPropertyTaxMap}
              layerVisibility={layerVisibility}
              onToggleLayer={toggleLayer}
              onTogglePropertyTaxLayer={togglePropertyTaxLayer}
              propertyTaxLayerVisibility={propertyTaxLayerVisibility}
            />
            <MeasurementControl onMeasureActiveChange={setIsMeasuring} />
            <MapViewportWatcher onChange={handleViewportChange} />
            <MapIdentifyClickHandler
              disabled={isMeasuring}
              layerData={layerData}
              layerVisibility={layerVisibility}
              onIdentify={identifyFeaturesAtLocation}
            />
            <MapFocus geometry={selectedDetail?.geometry ?? null} targetKey={selectedDetail?.code ?? null} />

            <Pane name="land-records" style={{ zIndex: 380 }}>
              {layerVisibility.land_records && layerData.land_records ? (
                <>
                  <IdentifyGeoJsonLayer
                    data={layerData.land_records}
                    identifiedFeature={identifiedFeature}
                    identifyDisabled={isMeasuring}
                    layerKey="land_records"
                    onIdentify={identifyLayerFeature}
                  />
                  <LandRecordSvgPatterns patternKey={layerData.land_records.features.length} />
                </>
              ) : null}
            </Pane>

            {supportWorkspaceTab === "atlas" && canReadAtlas ? (
              <AtlasMapOverlays atlasQuery={atlasState.result} />
            ) : null}
            {supportWorkspaceTab === "tax-parcels" && canReadPropertyTax ? (
              <TaxParcelMapOverlays taxParcelQuery={taxParcelState.result} />
            ) : null}

            {canReadPropertyTaxMap && propertyTaxLayerVisibility.regridParcels ? (
              <Pane name="regrid-parcels" style={{ zIndex: 360 }}>
                <MapLayerErrorBoundary
                  label="Regrid service layer"
                  resetKey={`regrid-feature-service-${REGRID_FEATURE_SERVICE_URL || "unconfigured"}`}
                >
                  <RegridFeatureServiceLayer
                    identifyDisabled={isMeasuring}
                    onError={setPropertyTaxMapError}
                    onIdentify={handleRegridParcelIdentify}
                    onNotice={setRegridLayerNotice}
                    zoom={mapZoom}
                  />
                </MapLayerErrorBoundary>
              </Pane>
            ) : null}

            {canReadPropertyTaxMap && propertyTaxLayerVisibility.regridParcels && matchedRegridParcels.features.length > 0 ? (
              <Pane name="matched-regrid-parcels" style={{ zIndex: 420 }}>
                <MapLayerErrorBoundary
                  label="Matched Regrid parcel layer"
                  resetKey={`matched-regrid-parcels-${matchedRegridParcels.features.length}-${mapBbox}`}
                >
                  <MatchedRegridParcelOverlay
                    data={matchedRegridParcels}
                  />
                </MapLayerErrorBoundary>
              </Pane>
            ) : null}

            {selectedRegridParcel ? (
              <Pane name="selected-regrid-parcel" style={{ zIndex: 425 }}>
                <SelectedRegridParcelOverlay selectedParcel={selectedRegridParcel} />
              </Pane>
            ) : null}

            {canReadPropertyTaxMap && propertyTaxLayerVisibility.propertyTaxPoints && propertyTaxPoints ? (
              <Pane name="property-tax-points" style={{ zIndex: 430 }}>
                <MapLayerErrorBoundary
                  label="Property tax point layer"
                  resetKey={`property-tax-points-${propertyTaxPoints.features.length}`}
                >
                  <PropertyTaxPointLayer
                    data={propertyTaxPoints}
                    mapBbox={mapBbox}
                    matchedPointIds={selectedPropertyTaxPointIds}
                    onIdentify={handlePropertyTaxPointIdentify}
                    zoom={mapZoom}
                  />
                </MapLayerErrorBoundary>
              </Pane>
            ) : null}

            <Pane name="management-areas" style={{ zIndex: 390 }}>
              {layerVisibility.management_areas && layerData.management_areas ? (
                <>
                  <IdentifyGeoJsonLayer
                    data={layerData.management_areas}
                    identifiedFeature={identifiedFeature}
                    identifyDisabled={isMeasuring}
                    layerKey="management_areas"
                    onIdentify={identifyLayerFeature}
                  />
                  <ManagementSvgPatterns patternKey={layerData.management_areas.features.length} />
                </>
              ) : null}
            </Pane>

            <Pane name="qa-markers" style={{ zIndex: 450 }}>
              {questionAreas ? (
                <QAMarkerLayer
                  questionAreas={questionAreas}
                  selectedCode={selectedCode}
                  onSelect={selectQuestionArea}
                />
              ) : null}
            </Pane>
          </MapContainer>
          {identifiedFeature ? (
            <IdentifyPanel
              currentIndex={identifySelection?.index ?? 0}
              identifiedFeature={identifiedFeature}
              identifyCount={identifySelection?.features.length ?? 1}
              onClose={() => setIdentifySelection(null)}
              onCycle={cycleIdentifiedFeature}
            />
          ) : null}
          {regridIdentifyState.status !== "idle" ? (
            <RegridIdentifyPanel
              identifyState={regridIdentifyState}
              onClose={() => {
                setSelectedRegridParcel(null);
                setRegridIdentifyState({
                  status: "idle",
                  latlng: null,
                  result: null,
                  error: null,
                });
              }}
            />
          ) : null}
          {propertyTaxMapError ? (
            <div className="map-layer-status map-layer-error" role="status">
              {propertyTaxMapError}
            </div>
          ) : null}
          {!propertyTaxMapError && regridLayerNotice ? (
            <div className="map-layer-status map-layer-notice" role="status">
              {regridLayerNotice}
            </div>
          ) : null}
        </section>

        {hasSupportWorkspace ? (
          <aside className={`workspace-panel right-panel ${rightPanelCollapsed ? "collapsed" : ""}`}>
            <button
              className="collapse-toggle"
              onClick={() => setRightPanelCollapsed((current) => !current)}
              title={rightPanelCollapsed ? "Expand panel" : "Collapse panel"}
              type="button"
            >
              {rightPanelCollapsed ? "<" : ">"}
            </button>

            <div className="tab-nav support-tab-nav" role="tablist" aria-label="Supporting workspace">
              {visibleSupportTabs.map((tab) => (
                <button
                  key={tab.id}
                  aria-selected={supportWorkspaceTab === tab.id}
                  className={`tab-link ${supportWorkspaceTab === tab.id ? "active" : ""}`}
                  onClick={() => setSupportWorkspaceTab(tab.id)}
                  role="tab"
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {supportWorkspaceTab ? (
              <div className="panel-content support-panel-content">
                {supportWorkspaceTab === "atlas" && canReadAtlas ? (
                  <AtlasPanel
                    atlasError={atlasState.error}
                    atlasLoading={atlasState.loading}
                    atlasQuery={atlasState.result}
                    bufferFeet={atlasBufferFeet}
                    isDetailLoading={busy.detail}
                    onBufferChange={setAtlasBufferFeet}
                    selectedCode={selectedCode}
                    selectedDetail={selectedSupportTarget}
                    token={session.token}
                  />
                ) : null}
                {supportWorkspaceTab === "tax-parcels" && canReadPropertyTax ? (
                  <TaxParcelPanel
                    bufferFeet={taxParcelBufferFeet}
                    isDetailLoading={busy.detail}
                    onBufferChange={setTaxParcelBufferFeet}
                    selectedCode={selectedCode}
                    selectedDetail={selectedSupportTarget}
                    taxParcelError={taxParcelState.error}
                    taxParcelLoading={taxParcelState.loading}
                    taxParcelQuery={taxParcelState.result}
                    token={session.token}
                  />
                ) : null}
              </div>
            ) : null}
          </aside>
        ) : null}
      </section>
    </main>
  );
}

function HeaderSummaryChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="header-summary-chip">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BadgeDescriptor({ label, value, badgeClass }: { label: string; value: string; badgeClass: string }) {
  return (
    <div className="header-badge-card">
      <span className="header-badge-label">{label}</span>
      <span className={`badge ${badgeClass}`}>{value}</span>
    </div>
  );
}

function buildQuestionAreaQueryParams(filters: QuestionAreaFilters, mapBbox: string, limit?: string) {
  const params = new URLSearchParams({ bbox: mapBbox });

  if (limit) {
    params.set("limit", limit);
  }

  if (filters.search) {
    params.set("search", filters.search);
    params.set("field", filters.field);
  }

  if (filters.status !== "all") {
    params.set("status", filters.status);
  }

  appendFilterParam(params, "severity", filters.severity, "all");
  appendFilterParam(params, "state", filters.state);
  appendFilterParam(params, "county", filters.county);
  appendFilterParam(params, "propertyName", filters.propertyName);
  appendFilterParam(params, "assignedReviewer", filters.assignedReviewer);
  appendFilterParam(params, "actionability", filters.actionability, "all");
  appendFilterParam(params, "hasLegalData", filters.hasLegalData, "all");
  appendFilterParam(params, "hasManagementData", filters.hasManagementData, "all");
  appendFilterParam(params, "hasClientBillData", filters.hasClientBillData, "all");

  return params;
}

function appendFilterParam(
  params: URLSearchParams,
  key: string,
  value: string,
  skipValue = "",
) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === skipValue) {
    return;
  }

  params.set(key, trimmed);
}

function withCurrentOption(options: string[], currentValue: string) {
  const trimmed = currentValue.trim();
  if (!trimmed || options.includes(trimmed)) {
    return options;
  }

  return [trimmed, ...options].sort((left, right) => left.localeCompare(right));
}

function ReviewRecordSections({
  busy,
  canAssignQuestionAreas,
  canCommentOnQuestionAreas,
  canReadQuestionAreas,
  canReviewQuestionAreas,
  canUploadQuestionAreaDocuments,
  commentDraft,
  editDraft,
  handleCommentSubmit,
  handleDownloadDocument,
  handleSaveDetail,
  handleUploadDocument,
  selectedDetail,
  selectedFile,
  setCommentDraft,
  setEditDraft,
  setSelectedFile,
  uploadInputKey,
}: {
  busy: BusyState;
  canAssignQuestionAreas: boolean;
  canCommentOnQuestionAreas: boolean;
  canReadQuestionAreas: boolean;
  canReviewQuestionAreas: boolean;
  canUploadQuestionAreaDocuments: boolean;
  commentDraft: string;
  editDraft: EditDraft;
  handleCommentSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleDownloadDocument: (fileRecord: QuestionAreaDetail["documents"][number]) => Promise<void>;
  handleSaveDetail: () => Promise<void>;
  handleUploadDocument: () => Promise<void>;
  selectedDetail: QuestionAreaDetail;
  selectedFile: File | null;
  setCommentDraft: (value: string) => void;
  setEditDraft: (value: EditDraft | ((current: EditDraft) => EditDraft)) => void;
  setSelectedFile: (file: File | null) => void;
  uploadInputKey: number;
}) {
  if (!canReadQuestionAreas) {
    return (
      <section className="panel-section">
        <p className="panel-note">Question-area details are not available for this account.</p>
      </section>
    );
  }

  return (
    <>
      <section className="panel-section">
        <div className="section-heading primary-heading">
          <h2>{selectedDetail.title}</h2>
        </div>
        <p className="summary-copy">{selectedDetail.summary}</p>
        <dl className="detail-grid">
          <DetailItem label="Tax Parcel Code" mono>{selectedDetail.parcelCode ?? "None"}</DetailItem>
          <DetailItem label="Record Owner">{selectedDetail.ownerName ?? "Unknown"}</DetailItem>
          <DetailItem label="County">{selectedDetail.county ?? "Unknown"}</DetailItem>
          <DetailItem label="State">{selectedDetail.state ?? "Unknown"}</DetailItem>
          <DetailItem label="Property">{selectedDetail.propertyName ?? "None"}</DetailItem>
          <DetailItem label="Tract">{selectedDetail.tractName ?? "None"}</DetailItem>
          <DetailItem label="Fund">{selectedDetail.fundName ?? "None"}</DetailItem>
        </dl>
        {selectedDetail.landServices ? (
          <div className="qa-reason">
            <dt>Land Services Note</dt>
            <dd>{selectedDetail.landServices}</dd>
          </div>
        ) : null}
      </section>

      <section className="panel-section">
        <dl className="detail-grid">
          <DetailItem label="Tax Bill Acres" mono>{formatMetric(selectedDetail.taxBillAcres)}</DetailItem>
          <DetailItem label="GIS Acres" mono>{formatMetric(selectedDetail.gisAcres)}</DetailItem>
          <DetailItem label="Legal/Deed Evidence">{formatBoolean(selectedDetail.existsInLegalLayer)}</DetailItem>
          <DetailItem label="Management Data">
            {formatBoolean(selectedDetail.existsInManagementLayer)}
          </DetailItem>
          <DetailItem label="In Client Bill Data">
            {formatBoolean(selectedDetail.existsInClientTabularBillData)}
          </DetailItem>
          <DetailItem label="Assigned Reviewer">{selectedDetail.assignedReviewer ?? "Unassigned"}</DetailItem>
        </dl>
      </section>

      {canReviewQuestionAreas || canAssignQuestionAreas ? (
        <section className="panel-section">
          <div className="form-stack">
            {canReviewQuestionAreas ? (
              <>
                <label>
                  Status
                  <select
                    value={editDraft.status}
                    onChange={(event) => setEditDraft((current) => ({ ...current, status: event.target.value }))}
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {workflowLabel(status)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    value={editDraft.severity}
                    onChange={(event) => setEditDraft((current) => ({ ...current, severity: event.target.value }))}
                  >
                    {SEVERITY_OPTIONS.map((severity) => (
                      <option key={severity} value={severity}>
                        {humanize(severity)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Summary
                  <textarea
                    rows={3}
                    value={editDraft.summary}
                    onChange={(event) => setEditDraft((current) => ({ ...current, summary: event.target.value }))}
                  />
                </label>
                <label>
                  Notes
                  <textarea
                    rows={5}
                    value={editDraft.description}
                    onChange={(event) => setEditDraft((current) => ({ ...current, description: event.target.value }))}
                  />
                </label>
              </>
            ) : null}
            {canAssignQuestionAreas ? (
              <label>
                Assigned reviewer
                <input
                  value={editDraft.assignedReviewer}
                  onChange={(event) =>
                    setEditDraft((current) => ({
                      ...current,
                      assignedReviewer: event.target.value,
                    }))
                  }
                />
              </label>
            ) : null}
            <button
              className="primary-button"
              disabled={busy.saving}
              onClick={handleSaveDetail}
              type="button"
            >
              {busy.saving ? "Saving..." : "Save review state"}
            </button>
          </div>
        </section>
      ) : null}

      <section className="panel-section">
        <div className="section-heading">
          <h2>Comments</h2>
          <span>{selectedDetail.comments.length} entries</span>
        </div>
        <div className="comment-list">
          {selectedDetail.comments.length > 0 ? (
            selectedDetail.comments.map((comment) => (
              <article key={comment.id} className="comment-card">
                <div>
                  <strong>{comment.authorName}</strong>
                  <small>{comment.authorRole}</small>
                </div>
                <p>{comment.body}</p>
                <span>{new Date(comment.createdAt).toLocaleString()}</span>
              </article>
            ))
          ) : (
            <p className="panel-note">No comments have been added yet.</p>
          )}
        </div>
        {canCommentOnQuestionAreas ? (
          <form className="form-stack" onSubmit={handleCommentSubmit}>
            <label>
              Add comment
              <textarea rows={3} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} />
            </label>
            <button className="primary-button" disabled={busy.commenting} type="submit">
              {busy.commenting ? "Posting..." : "Post comment"}
            </button>
          </form>
        ) : null}
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <h2>Documents</h2>
          <span>{selectedDetail.documents.length} attached</span>
        </div>
        <div className="document-list">
          {selectedDetail.documents.length > 0 ? (
            selectedDetail.documents.map((document) => (
              <article key={document.id} className="document-card">
                <div>
                  <strong>{document.originalName}</strong>
                  <small>{formatFileSize(document.sizeBytes)}</small>
                </div>
                <button className="ghost-button" onClick={() => void handleDownloadDocument(document)} type="button">
                  Download
                </button>
              </article>
            ))
          ) : (
            <p className="panel-note">No documents have been uploaded yet.</p>
          )}
        </div>
        {canUploadQuestionAreaDocuments ? (
          <div className="upload-row">
            <input
              key={`question-area-upload-${uploadInputKey}`}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSelectedFile(event.target.files?.[0] ?? null)}
              type="file"
            />
            <button
              className="primary-button"
              disabled={!selectedFile || busy.uploading}
              onClick={() => void handleUploadDocument()}
              type="button"
            >
              {busy.uploading ? "Uploading..." : "Upload"}
            </button>
          </div>
        ) : null}
      </section>
    </>
  );
}

function MapViewportWatcher({ onChange }: { onChange: (bbox: string, zoom: number) => void }) {
  const map = useMap();
  const lastViewportRef = useRef<{ bbox: string; zoom: number } | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    function emitViewport() {
      const nextViewport = {
        bbox: map.getBounds().toBBoxString(),
        zoom: map.getZoom(),
      };
      const previousViewport = lastViewportRef.current;

      if (
        previousViewport
        && previousViewport.zoom === nextViewport.zoom
        && areMapBboxesEqual(previousViewport.bbox, nextViewport.bbox)
      ) {
        return;
      }

      lastViewportRef.current = nextViewport;
      onChange(nextViewport.bbox, nextViewport.zoom);
    }

    function scheduleViewportEmit() {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        emitViewport();
      }, MAP_VIEWPORT_DEBOUNCE_MS);
    }

    emitViewport();
    map.on("moveend zoomend resize", scheduleViewportEmit);

    return () => {
      map.off("moveend zoomend resize", scheduleViewportEmit);
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [map, onChange]);

  return null;
}

function MapIdentifyClickHandler({
  disabled,
  layerData,
  layerVisibility,
  onIdentify,
}: {
  disabled: boolean;
  layerData: Partial<Record<LayerKey, LayerCollection>>;
  layerVisibility: Record<LayerKey, boolean>;
  onIdentify: (latlng: L.LatLngLiteral) => void;
}) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();

    function handleMapClick(event: MouseEvent) {
      if (disabled) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".leaflet-control, .leaflet-marker-icon")) {
        return;
      }

      const latlng = map.mouseEventToLatLng(event);
      onIdentify(latlng);
    }

    container.addEventListener("click", handleMapClick, true);
    return () => container.removeEventListener("click", handleMapClick, true);
  }, [disabled, layerData, layerVisibility, map, onIdentify]);

  return null;
}

function IdentifyGeoJsonLayer({
  data,
  identifiedFeature,
  identifyDisabled,
  layerKey,
  onIdentify,
}: {
  data: LayerCollection;
  identifiedFeature: IdentifiedFeature | null;
  identifyDisabled: boolean;
  layerKey: LayerKey;
  onIdentify: (layerKey: LayerKey, feature: LayerFeature, latlng: L.LatLngLiteral) => void;
}) {
  const renderData =
    layerKey === "land_records"
      ? orderLandRecordFeatures(data)
      : layerKey === "management_areas"
        ? orderManagementAreaFeatures(data)
        : data;

  return (
    <GeoJSON
      key={`${layerKey}-${identifiedFeature?.layerKey ?? "none"}-${identifiedFeature?.feature.properties.id ?? "none"}`}
      data={renderData}
      onEachFeature={(feature, layer) => {
        if (!isPolygonGeometry(feature.geometry)) {
          return;
        }

        layer.on("click", (event: L.LeafletMouseEvent) => {
          if (identifyDisabled) {
            return;
          }

          L.DomEvent.stopPropagation(event.originalEvent);
          onIdentify(layerKey, feature as LayerFeature, event.latlng);
        });
      }}
      style={(feature) => identifyFeatureStyle(layerKey, feature as LayerFeature | undefined, identifiedFeature)}
    />
  );
}

function RegridFeatureServiceLayer({
  identifyDisabled,
  onError,
  onIdentify,
  onNotice,
  zoom,
}: {
  identifyDisabled: boolean;
  onError: (message: string | null) => void;
  onIdentify: (
    latlng: L.LatLngLiteral,
    selectedFrom?: SelectedRegridParcel["selectedFrom"],
    clickedFeature?: RegridParcelFeature,
  ) => void;
  onNotice: (message: string | null) => void;
  zoom: number;
}) {
  const map = useMap();
  const onIdentifyRef = useRef(onIdentify);
  const identifyDisabledRef = useRef(identifyDisabled);
  const onErrorRef = useRef(onError);
  const onNoticeRef = useRef(onNotice);

  useEffect(() => {
    onIdentifyRef.current = onIdentify;
  }, [onIdentify]);

  useEffect(() => {
    identifyDisabledRef.current = identifyDisabled;
  }, [identifyDisabled]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onNoticeRef.current = onNotice;
  }, [onNotice]);

  useEffect(() => {
    if (!REGRID_FEATURE_SERVICE_URL) {
      onErrorRef.current(null);
      onNoticeRef.current("Regrid FeatureServer layer is not configured. Set VITE_REGRID_FEATURE_SERVICE_URL to enable it.");
      return;
    }

    if (zoom < PROPERTY_TAX_REGRID_MIN_ZOOM) {
      onErrorRef.current(null);
      onNoticeRef.current(null);
      return;
    }

    const featureLayer = esriLeaflet.featureLayer({
      cacheLayers: false,
      fields: REGRID_FEATURE_SERVICE_FIELDS,
      keepBuffer: 1,
      minZoom: PROPERTY_TAX_REGRID_MIN_ZOOM,
      pane: "regrid-parcels",
      precision: 5,
      simplifyFactor: 0.65,
      style: () => regridParcelStyle,
      updateInterval: 250,
      updateWhenIdle: true,
      url: REGRID_FEATURE_SERVICE_URL,
    });

    const handleClick = (event: RegridFeatureLayerEvent) => {
      if (identifyDisabledRef.current || !event.latlng) {
        return;
      }

      if (event.originalEvent) {
        L.DomEvent.stopPropagation(event.originalEvent);
      }
      onIdentifyRef.current(event.latlng, "regrid-parcel", extractRegridFeature(event));
    };

    const handleLoading = () => {
      onErrorRef.current(null);
    };

    const handleLoad = () => {
      onErrorRef.current(null);
      onNoticeRef.current(null);
    };

    const handleError = (event: RegridFeatureLayerEvent) => {
      onNoticeRef.current(null);
      onErrorRef.current(event.error?.message ?? event.message ?? "Failed to load Regrid FeatureServer layer.");
    };

    const handleDrawLimitExceeded = () => {
      onErrorRef.current(null);
      onNoticeRef.current("Regrid returned more parcel features than the map can draw here. Zoom in to inspect parcel fabric.");
    };

    featureLayer.on("click", handleClick);
    featureLayer.on("loading", handleLoading);
    featureLayer.on("load", handleLoad);
    featureLayer.on("requesterror", handleError);
    featureLayer.on("drawlimitexceeded", handleDrawLimitExceeded);
    featureLayer.addTo(map);

    return () => {
      featureLayer.off("click", handleClick);
      featureLayer.off("loading", handleLoading);
      featureLayer.off("load", handleLoad);
      featureLayer.off("requesterror", handleError);
      featureLayer.off("drawlimitexceeded", handleDrawLimitExceeded);
      featureLayer.removeFrom(map);
    };
  }, [map, zoom]);

  return null;
}

function SelectedRegridParcelOverlay({ selectedParcel }: { selectedParcel: SelectedRegridParcel }) {
  const feature: RegridParcelFeature = {
    type: "Feature",
    geometry: selectedParcel.geometry,
    properties: selectedParcel.properties,
  };

  return (
    <GeoJSON
      key={`selected-regrid-parcel-${selectedParcel.parcelId ?? "unknown"}`}
      data={feature}
      onEachFeature={(selectedFeature, layer) => {
        const label = regridParcelLabel(selectedFeature as RegridParcelFeature);
        if (label) {
          layer.bindTooltip(label, { direction: "top", opacity: 0.95, sticky: true });
        }
      }}
      style={() => activeRegridParcelStyle}
    />
  );
}

function MatchedRegridParcelOverlay({ data }: { data: RegridParcelCollection }) {
  const polygons = useMemo(() => matchedRegridPolygons(data), [data]);

  return (
    <>
      {polygons.map((polygon) => (
        <Polygon
          key={polygon.key}
          interactive={false}
          pathOptions={matchedRegridParcelStyle}
          positions={polygon.positions}
        />
      ))}
    </>
  );
}

class MapLayerErrorBoundary extends Component<
  { children: ReactNode; label: string; resetKey: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(previousProps: { resetKey: string }) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`${this.props.label} failed to render.`, error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="map-layer-error" role="status">
          {this.props.label} failed to render. Toggle the layer off or move the map to retry.
        </div>
      );
    }

    return this.props.children;
  }
}

function PropertyTaxPointLayer({
  data,
  matchedPointIds,
  onIdentify,
  zoom,
}: {
  data: PropertyTaxPointCollection;
  mapBbox: string;
  matchedPointIds: Set<number>;
  onIdentify: (point: PropertyTaxParcelPointProperties) => void;
  zoom: number;
}) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitTargetsRef = useRef<
    Array<{
      clusterId: number | null;
      lat: number;
      lng: number;
      point: PropertyTaxParcelPointProperties | null;
      radius: number;
      x: number;
      y: number;
    }>
  >([]);
  const onIdentifyRef = useRef(onIdentify);
  const matchedPointIdsRef = useRef(matchedPointIds);

  const clusterIndex = useMemo(() => {
    const renderableFeatures = data.features.filter(isRenderablePropertyTaxPointFeature);
    const index = new Supercluster<PropertyTaxParcelPointProperties, PropertyTaxParcelPointProperties>({
      maxZoom: PROPERTY_TAX_CLUSTER_MAX_ZOOM,
      radius: 58,
    });
    index.load(renderableFeatures as Array<PointFeature<PropertyTaxParcelPointProperties>>);
    return index;
  }, [data]);

  useEffect(() => {
    onIdentifyRef.current = onIdentify;
  }, [onIdentify]);

  useEffect(() => {
    matchedPointIdsRef.current = matchedPointIds;
    hitTargetsRef.current = drawPropertyTaxCanvas(map, canvasRef.current, clusterIndex, matchedPointIdsRef.current);
  }, [clusterIndex, map, matchedPointIds]);

  useEffect(() => {
    hitTargetsRef.current = drawPropertyTaxCanvas(map, canvasRef.current, clusterIndex, matchedPointIdsRef.current);
  }, [clusterIndex, map, zoom]);

  useEffect(() => {
    const pane = map.getPane("property-tax-points") ?? map.getPanes().overlayPane;
    const canvas = L.DomUtil.create("canvas", "property-tax-canvas-layer", pane);
    canvasRef.current = canvas;

    let animationFrame: number | null = null;

    function redraw() {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        hitTargetsRef.current = drawPropertyTaxCanvas(
          map,
          canvas,
          clusterIndex,
          matchedPointIdsRef.current,
        );
      });
    }

    function handleClick(event: L.LeafletMouseEvent) {
      const point = map.latLngToContainerPoint(event.latlng);
      const x = point.x;
      const y = point.y;
      const target = findPropertyTaxHitTarget(hitTargetsRef.current, x, y);
      if (!target) {
        return;
      }

      L.DomEvent.stopPropagation(event.originalEvent);
      if (target.point) {
        onIdentifyRef.current(target.point);
        return;
      }

      if (target.clusterId !== null) {
        const expansionZoom = clusterIndex.getClusterExpansionZoom(target.clusterId);
        map.setView([target.lat, target.lng], Math.max(map.getZoom() + 1, expansionZoom));
      }
    }

    redraw();
    map.on("click", handleClick);
    map.on("move zoom zoomend moveend resize viewreset", redraw);

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      map.off("click", handleClick);
      map.off("move zoom zoomend moveend resize viewreset", redraw);
      canvas.remove();
      canvasRef.current = null;
      hitTargetsRef.current = [];
    };
  }, [clusterIndex, map]);

  return null;
}

function RegridIdentifyPanel({
  identifyState,
  onClose,
}: {
  identifyState: RegridIdentifyState;
  onClose: () => void;
}) {
  const result = identifyState.result;
  const primaryMatch = result?.matches[0] ?? null;
  const workbookRows = primaryMatch ? objectIdentifyRows(primaryMatch) : [];
  const parcelRows = result?.regridParcel ? objectIdentifyRows(result.regridParcel.properties) : [];
  const hasMatch = Boolean(result?.matchCount);
  const title = hasMatch
    ? firstKnownValue(workbookRows) ?? "Matched Workbook Parcel"
    : "Regrid Parcel";

  return (
    <aside className="map-identify-panel regrid-identify-panel" aria-label="Regrid parcel identify result">
      <div className="identify-panel-header">
        <div className="identify-title-group">
          <span className={`identify-layer-badge ${hasMatch ? "regrid-matched" : "regrid"}`}>
            {hasMatch ? "Workbook Match" : "Regrid Parcel"}
          </span>
          <h2>{identifyState.status === "loading" ? "Identifying parcel..." : title}</h2>
        </div>
        <div className="identify-header-actions">
          <button className="identify-close-button" onClick={onClose} title="Close identify panel" type="button">
            x
          </button>
        </div>
      </div>

      {identifyState.status === "loading" ? (
        <p className="panel-note">Checking the clicked Regrid parcel against workbook data.</p>
      ) : null}
      {identifyState.status === "error" ? (
        <p className="tax-parcel-error-banner">{identifyState.error ?? "Failed to identify Regrid parcel."}</p>
      ) : null}
      {identifyState.status === "success" && !hasMatch ? (
        <p className="regrid-no-match-state">
          {result?.message ?? "No workbook match found for this Regrid parcel."}
        </p>
      ) : null}

      {workbookRows.length > 0 ? <IdentifyFieldSection rows={workbookRows} title="Workbook Data" /> : null}
      {result && result.matches.length > 1 ? (
        <p className="panel-note">{result.matches.length.toLocaleString()} workbook matches found at this location.</p>
      ) : null}
      {parcelRows.length > 0 ? <IdentifyFieldSection rows={parcelRows} title="Regrid Attributes" /> : null}
      {identifyState.latlng ? (
        <IdentifyFieldSection
          rows={[
            {
              key: "clicked_location",
              label: "Clicked Location",
              value: `${identifyState.latlng.lat.toFixed(5)}, ${identifyState.latlng.lng.toFixed(5)}`,
            },
          ]}
          title="Identify"
        />
      ) : null}
    </aside>
  );
}

function LandRecordSvgPatterns({ patternKey }: { patternKey: number }) {
  const map = useMap();

  useEffect(() => {
    let frameId = 0;
    let attempts = 0;
    const namespace = "http://www.w3.org/2000/svg";

    const injectPatterns = () => {
      const pane = map.getPane("land-records");
      const svgs = Array.from(pane?.querySelectorAll("svg") ?? []);

      if (svgs.length === 0) {
        attempts += 1;
        if (attempts < 60) {
          frameId = window.requestAnimationFrame(injectPatterns);
        }
        return;
      }

      for (const svg of svgs) {
        svg.querySelector("#lr-pattern-defs")?.remove();

        const defs = document.createElementNS(namespace, "defs");
        defs.id = "lr-pattern-defs";

        defs.append(
          createDiagonalPattern(namespace, {
            id: "lr-exception-hatch",
            background: "rgba(255, 255, 0, 0.38)",
            hatch: "#000000",
            hatchWidth: 0.9,
            size: 10,
          }),
          createDiagonalPattern(namespace, {
            id: "lr-out-sale-hatch",
            background: "rgba(255, 127, 0, 0.3)",
            hatch: "#000000",
            hatchWidth: 0.9,
            size: 10,
          }),
          createCrossHatchPattern(namespace, {
            id: "lr-encumbrance-hatch",
            background: "rgba(104, 104, 104, 0.08)",
            hatch: "#686868",
            hatchWidth: 0.8,
            size: 12,
          }),
        );

        svg.prepend(defs);
      }
    };

    frameId = window.requestAnimationFrame(injectPatterns);
    return () => {
      window.cancelAnimationFrame(frameId);
      map.getPane("land-records")?.querySelectorAll("#lr-pattern-defs").forEach((defs) => defs.remove());
    };
  }, [map, patternKey]);

  return null;
}

function createDiagonalPattern(
  namespace: string,
  options: { id: string; background: string; hatch: string; hatchWidth: number; size: number },
) {
  const pattern = document.createElementNS(namespace, "pattern");
  pattern.id = options.id;
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  pattern.setAttribute("width", String(options.size));
  pattern.setAttribute("height", String(options.size));
  pattern.setAttribute("patternTransform", "rotate(45)");

  const background = document.createElementNS(namespace, "rect");
  background.setAttribute("width", String(options.size));
  background.setAttribute("height", String(options.size));
  background.setAttribute("fill", options.background);
  pattern.append(background);

  const line = document.createElementNS(namespace, "line");
  line.setAttribute("x1", "0");
  line.setAttribute("y1", "0");
  line.setAttribute("x2", "0");
  line.setAttribute("y2", String(options.size));
  line.setAttribute("stroke", options.hatch);
  line.setAttribute("stroke-width", String(options.hatchWidth));
  pattern.append(line);

  return pattern;
}

function createCrossHatchPattern(
  namespace: string,
  options: { id: string; background: string; hatch: string; hatchWidth: number; size: number },
) {
  const pattern = document.createElementNS(namespace, "pattern");
  pattern.id = options.id;
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  pattern.setAttribute("width", String(options.size));
  pattern.setAttribute("height", String(options.size));

  const background = document.createElementNS(namespace, "rect");
  background.setAttribute("width", String(options.size));
  background.setAttribute("height", String(options.size));
  background.setAttribute("fill", options.background);
  pattern.append(background);

  const forwardLine = document.createElementNS(namespace, "line");
  forwardLine.setAttribute("x1", "0");
  forwardLine.setAttribute("y1", "0");
  forwardLine.setAttribute("x2", String(options.size));
  forwardLine.setAttribute("y2", String(options.size));
  forwardLine.setAttribute("stroke", options.hatch);
  forwardLine.setAttribute("stroke-width", String(options.hatchWidth));
  pattern.append(forwardLine);

  const reverseLine = document.createElementNS(namespace, "line");
  reverseLine.setAttribute("x1", String(options.size));
  reverseLine.setAttribute("y1", "0");
  reverseLine.setAttribute("x2", "0");
  reverseLine.setAttribute("y2", String(options.size));
  reverseLine.setAttribute("stroke", options.hatch);
  reverseLine.setAttribute("stroke-width", String(options.hatchWidth));
  pattern.append(reverseLine);

  return pattern;
}

function createStipplePattern(
  namespace: string,
  options: { id: string; background: string; color: string; size: number },
) {
  const pattern = document.createElementNS(namespace, "pattern");
  pattern.id = options.id;
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  pattern.setAttribute("width", String(options.size));
  pattern.setAttribute("height", String(options.size));

  const background = document.createElementNS(namespace, "rect");
  background.setAttribute("width", String(options.size));
  background.setAttribute("height", String(options.size));
  background.setAttribute("fill", options.background);
  pattern.append(background);

  const dots = [
    [2, 3, 1],
    [8, 2, 0.8],
    [14, 5, 1],
    [5, 10, 0.9],
    [12, 12, 1],
    [16, 16, 0.8],
    [1, 15, 0.7],
  ];

  for (const [cx, cy, r] of dots) {
    const dot = document.createElementNS(namespace, "circle");
    dot.setAttribute("cx", String(cx));
    dot.setAttribute("cy", String(cy));
    dot.setAttribute("r", String(r));
    dot.setAttribute("fill", options.color);
    pattern.append(dot);
  }

  return pattern;
}

function createQuercusPattern(namespace: string) {
  const pattern = createStipplePattern(namespace, {
    id: "management-quercus-wv-pattern",
    background: "rgba(235, 199, 181, 0)",
    color: "#734c00",
    size: 20,
  });

  const line = document.createElementNS(namespace, "path");
  line.setAttribute("d", "M 1 5 C 6 1, 9 9, 14 5 S 21 7, 24 2");
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "#734c00");
  line.setAttribute("stroke-width", "0.9");
  pattern.append(line);

  return pattern;
}

function orderLandRecordFeatures(data: LayerCollection): LayerCollection {
  return {
    ...data,
    features: [...data.features].sort((left, right) => {
      return landRecordDrawPriority(left) - landRecordDrawPriority(right);
    }),
  };
}

function landRecordDrawPriority(feature: LayerFeature): number {
  const lrType = feature.properties.lr_type;
  return typeof lrType === "string" ? LAND_RECORD_DRAW_PRIORITY_BY_TYPE[lrType] ?? 0 : 0;
}

function ManagementSvgPatterns({ patternKey }: { patternKey: number }) {
  const map = useMap();

  useEffect(() => {
    let frameId = 0;
    let attempts = 0;
    const namespace = "http://www.w3.org/2000/svg";

    const injectPatterns = () => {
      const pane = map.getPane("management-areas");
      const svgs = Array.from(pane?.querySelectorAll("svg") ?? []);

      if (svgs.length === 0) {
        attempts += 1;
        if (attempts < 60) {
          frameId = window.requestAnimationFrame(injectPatterns);
        }
        return;
      }

      for (const svg of svgs) {
        svg.querySelector("#management-pattern-defs")?.remove();

        const defs = document.createElementNS(namespace, "defs");
        defs.id = "management-pattern-defs";

        defs.append(
          createStipplePattern(namespace, {
            id: "management-delta-south-pattern",
            background: "rgba(240, 240, 240, 0)",
            color: "#55ff00",
            size: 18,
          }),
          createStipplePattern(namespace, {
            id: "management-l-c-or-pattern",
            background: "rgba(240, 240, 240, 0)",
            color: "#c500ff",
            size: 18,
          }),
          createStipplePattern(namespace, {
            id: "management-latrobe-pa-ny-pattern",
            background: "rgba(240, 240, 240, 0)",
            color: "#ffaa00",
            size: 18,
          }),
          createQuercusPattern(namespace),
        );

        svg.prepend(defs);
      }
    };

    frameId = window.requestAnimationFrame(injectPatterns);
    return () => {
      window.cancelAnimationFrame(frameId);
      map.getPane("management-areas")?.querySelectorAll("#management-pattern-defs").forEach((defs) => defs.remove());
    };
  }, [map, patternKey]);

  return null;
}

function orderManagementAreaFeatures(data: LayerCollection): LayerCollection {
  return {
    ...data,
    features: [...data.features].sort((left, right) => {
      return managementAreaDrawPriority(left) - managementAreaDrawPriority(right);
    }),
  };
}

function managementAreaDrawPriority(feature: LayerFeature): number {
  const propertyName = feature.properties.property_name;
  return typeof propertyName === "string" ? MANAGEMENT_AREA_DRAW_PRIORITY_BY_PROPERTY_NAME[propertyName] ?? 0 : 0;
}

function IdentifyPanel({
  currentIndex,
  identifiedFeature,
  identifyCount,
  onClose,
  onCycle,
}: {
  currentIndex: number;
  identifiedFeature: IdentifiedFeature;
  identifyCount: number;
  onClose: () => void;
  onCycle: (direction: -1 | 1) => void;
}) {
  const config = IDENTIFY_LAYER_CONFIG[identifiedFeature.layerKey];
  const properties = identifiedFeature.feature.properties;
  const primaryRows = configuredIdentifyRows(properties, config.primaryFields);
  const attributeRows = configuredIdentifyRows(properties, config.attributeFields);
  const contextRows = configuredIdentifyRows(properties, config.contextFields);
  const metadataRows = geometryMetadataRows(identifiedFeature);
  const title = firstKnownValue(primaryRows) ?? `${config.label} ${properties.id}`;

  return (
    <aside className="map-identify-panel" aria-label={`${config.label} details`}>
      <div className="identify-panel-header">
        <div className="identify-title-group">
          <span className={`identify-layer-badge ${config.badgeClass}`}>{config.label}</span>
          <h2>{title}</h2>
        </div>
        <div className="identify-header-actions">
          <button className="identify-close-button" onClick={onClose} title="Close identify panel" type="button">
            x
          </button>
        </div>
      </div>

      {identifyCount > 1 ? (
        <div className="identify-cycle-controls" aria-label="Identify results">
          <button onClick={() => onCycle(-1)} title="Previous identified feature" type="button">
            Previous
          </button>
          <span>
            {currentIndex + 1} of {identifyCount}
          </span>
          <button onClick={() => onCycle(1)} title="Next identified feature" type="button">
            Next
          </button>
        </div>
      ) : null}

      <IdentifyFieldSection rows={primaryRows} title="Identifiers" />
      <IdentifyFieldSection rows={attributeRows} title="Attributes" />
      <IdentifyFieldSection rows={contextRows} title="Context" />
      <IdentifyFieldSection rows={metadataRows} title="Geometry" />
    </aside>
  );
}

function IdentifyFieldSection({ rows, title }: { rows: IdentifyFieldRow[]; title: string }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="identify-section">
      <h3>{title}</h3>
      <IdentifyFieldList rows={rows} />
    </section>
  );
}

function IdentifyFieldList({ rows }: { rows: IdentifyFieldRow[] }) {
  return (
    <dl className="identify-field-grid">
      {rows.map((row) => (
        <div key={row.key}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function identifyFeatureStyle(
  layerKey: LayerKey,
  feature: LayerFeature | undefined,
  identifiedFeature: IdentifiedFeature | null,
): PathOptions {
  const baseStyle =
    layerKey === "land_records"
      ? landRecordStyleForFeature(feature)
      : layerKey === "management_areas"
        ? managementAreaStyleForFeature(feature)
        : managementAreaStyle;
  const isSelected =
    Boolean(feature) &&
    identifiedFeature?.layerKey === layerKey &&
    identifiedFeature.feature.properties.id === feature?.properties.id;

  if (!isSelected) {
    return baseStyle;
  }

  return {
    ...baseStyle,
    color: "#0f172a",
    fillOpacity: Math.max(Number(baseStyle.fillOpacity ?? 0), 0.22),
    weight: 4,
  };
}

function landRecordStyleForFeature(feature: LayerFeature | undefined): PathOptions {
  const lrType = feature?.properties.lr_type;
  if (typeof lrType !== "string") {
    return landRecordStyle;
  }

  return LAND_RECORD_STYLE_BY_TYPE[lrType] ?? landRecordStyle;
}

function managementAreaStyleForFeature(feature: LayerFeature | undefined): PathOptions {
  const propertyName = feature?.properties.property_name;
  if (typeof propertyName !== "string") {
    return managementAreaStyle;
  }

  return MANAGEMENT_AREA_STYLE_BY_PROPERTY_NAME[propertyName] ?? managementAreaStyle;
}

function configuredIdentifyRows(
  properties: LayerFeatureProperties,
  fields: IdentifyFieldConfig[],
): IdentifyFieldRow[] {
  return fields.flatMap((field) => {
    const value = formatIdentifyValue(properties[field.key]);
    return value ? [{ key: field.key, label: field.label, value }] : [];
  });
}

function objectIdentifyRows(properties: Record<string, unknown>): IdentifyFieldRow[] {
  return Object.entries(properties)
    .flatMap(([key, value]) => {
      const formattedValue = formatIdentifyValue(value);
      return formattedValue ? [{ key, label: humanize(key), value: formattedValue }] : [];
    })
    .slice(0, 24);
}

function createSelectedRegridParcel(
  result: RegridIdentifyResult,
  selectedFrom: SelectedRegridParcel["selectedFrom"],
  fallbackFeature?: RegridParcelFeature,
): SelectedRegridParcel | null {
  const geometry = result.regridParcel?.geometry ?? fallbackFeature?.geometry;
  if (!geometry) {
    return null;
  }

  const properties = result.regridParcel?.properties ?? fallbackFeature?.properties ?? {};
  return {
    parcelId: regridParcelIdentity(properties),
    geometry,
    properties,
    matches: result.matches,
    selectedFrom,
  };
}

function createFeatureOnlyRegridIdentifyResult(
  latlng: L.LatLngLiteral,
  clickedFeature?: RegridParcelFeature,
): RegridIdentifyResult {
  return {
    clicked: { latitude: latlng.lat, longitude: latlng.lng },
    regridParcel: clickedFeature ?? null,
    matches: [],
    matchCount: 0,
    message: clickedFeature
      ? "Workbook matching is not available for this account."
      : "No Regrid parcel attributes were returned for this click.",
  };
}

function regridParcelLabel(feature: RegridParcelFeature) {
  const properties = feature.properties;
  return [
    properties.parcelnumb,
    properties.account_number,
    properties.ll_uuid,
    properties.owner,
    properties.address,
  ]
    .filter(Boolean)
    .join(" | ");
}

function regridParcelIdentity(properties: RegridParcelProperties) {
  const value = properties.parcelId ?? properties.id ?? properties.ll_uuid ?? properties.parcelnumb;
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function collectMatchedRegridParcels(collection: RegridParcelCollection): RegridParcelCollection {
  return {
    ...collection,
    features: collection.features.filter((feature) =>
      Boolean(feature.properties?.matched)
      && isPolygonGeometry(feature.geometry)
      && hasFiniteCoordinatePair(feature.geometry.coordinates)
    ),
  };
}

function matchedRegridPolygons(collection: RegridParcelCollection) {
  return collection.features.flatMap((feature, featureIndex) => {
    const featureKey = regridParcelIdentity(feature.properties ?? {}) ?? `matched-regrid-${featureIndex}`;
    const geometry = feature.geometry;

    if (geometry.type === "Polygon") {
      return [{
        key: featureKey,
        positions: polygonToLatLngPositions(geometry.coordinates as PolygonCoordinates),
      }];
    }

    if (geometry.type === "MultiPolygon") {
      return (geometry.coordinates as MultiPolygonCoordinates).map((polygon, polygonIndex) => ({
        key: `${featureKey}-${polygonIndex}`,
        positions: polygonToLatLngPositions(polygon),
      }));
    }

    return [];
  });
}

function polygonToLatLngPositions(polygon: PolygonCoordinates): LatLngExpression[][] {
  return polygon.map((ring) =>
    ring
      .filter((coordinate) => isFiniteCoordinatePair(coordinate[0], coordinate[1]))
      .map(([lng, lat]) => [lat, lng] as [number, number]),
  );
}

function extractRegridFeature(event: RegridFeatureLayerEvent): RegridParcelFeature | undefined {
  const feature = event.feature ?? event.layer?.feature;
  if (feature?.type === "Feature" && feature.geometry) {
    return feature;
  }
  return undefined;
}

function parseMapBbox(bbox: string): [number, number, number, number] | null {
  const parts = bbox.split(",").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const [west, south, east, north] = parts;
  if (west >= east || south >= north) {
    return null;
  }

  return [west, south, east, north];
}

function areMapBboxesEqual(leftBbox: string, rightBbox: string) {
  const left = parseMapBbox(leftBbox);
  const right = parseMapBbox(rightBbox);
  if (!left || !right) {
    return leftBbox === rightBbox;
  }

  return left.every((value, index) => Math.abs(value - right[index]) < 0.000001);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function isRenderablePropertyTaxPointFeature(
  feature: Feature<Point, PropertyTaxParcelPointProperties>,
): feature is PointFeature<PropertyTaxParcelPointProperties> {
  const coordinates = feature.geometry?.coordinates;
  return (
    feature.type === "Feature"
    && feature.geometry?.type === "Point"
    && Array.isArray(coordinates)
    && isFiniteCoordinatePair(coordinates[0], coordinates[1])
  );
}

function isFiniteCoordinatePair(lng: unknown, lat: unknown) {
  return (
    typeof lng === "number"
    && typeof lat === "number"
    && Number.isFinite(lng)
    && Number.isFinite(lat)
    && lng >= -180
    && lng <= 180
    && lat >= -90
    && lat <= 90
  );
}

function hasFiniteCoordinatePair(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }

  if (
    value.length >= 2
    && typeof value[0] === "number"
    && typeof value[1] === "number"
    && isFiniteCoordinatePair(value[0], value[1])
  ) {
    return true;
  }

  return value.some((child) => hasFiniteCoordinatePair(child));
}

function isClusterFeature(
  feature: ClusterFeature<PropertyTaxParcelPointProperties> | PointFeature<PropertyTaxParcelPointProperties>,
): feature is ClusterFeature<PropertyTaxParcelPointProperties> {
  return Boolean(feature.properties.cluster);
}

function clusterRadius(count: number) {
  if (count >= 1000) {
    return 22;
  }
  if (count >= 100) {
    return 18;
  }
  if (count >= 10) {
    return 14;
  }
  return 11;
}

function formatClusterCount(count: number) {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }

  return count.toLocaleString();
}

type PropertyTaxHitTarget = {
  clusterId: number | null;
  lat: number;
  lng: number;
  point: PropertyTaxParcelPointProperties | null;
  radius: number;
  x: number;
  y: number;
};

function drawPropertyTaxCanvas(
  map: L.Map,
  canvas: HTMLCanvasElement | null,
  clusterIndex: Supercluster<PropertyTaxParcelPointProperties, PropertyTaxParcelPointProperties>,
  matchedPointIds: Set<number>,
): PropertyTaxHitTarget[] {
  if (!canvas) {
    return [];
  }

  const size = map.getSize();
  const density = window.devicePixelRatio || 1;
  const width = Math.max(1, size.x);
  const height = Math.max(1, size.y);

  if (canvas.width !== Math.round(width * density) || canvas.height !== Math.round(height * density)) {
    canvas.width = Math.round(width * density);
    canvas.height = Math.round(height * density);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));

  const context = canvas.getContext("2d");
  if (!context) {
    return [];
  }

  context.setTransform(density, 0, 0, density, 0, 0);
  context.clearRect(0, 0, width, height);

  const bbox = parseMapBbox(map.getBounds().toBBoxString()) ?? [-180, -90, 180, 90];
  const zoom = Math.floor(map.getZoom());
  const features = clusterIndex.getClusters(bbox, zoom);
  const targets: PropertyTaxHitTarget[] = [];
  const pointFeatures: Array<PointFeature<PropertyTaxParcelPointProperties>> = [];

  for (const feature of features) {
    const [lng, lat] = feature.geometry.coordinates;
    if (!isFiniteCoordinatePair(lng, lat)) {
      continue;
    }

    const point = map.latLngToContainerPoint([lat, lng]);
    if (point.x < -32 || point.x > width + 32 || point.y < -32 || point.y > height + 32) {
      continue;
    }

    if (isClusterFeature(feature)) {
      const count = Number(feature.properties.point_count ?? 0);
      const radius = clusterRadius(count);
      drawPropertyTaxCluster(context, point.x, point.y, radius, count);
      targets.push({
        clusterId: Number(feature.properties.cluster_id),
        lat,
        lng,
        point: null,
        radius: radius + 4,
        x: point.x,
        y: point.y,
      });
      continue;
    }

    pointFeatures.push(feature);
  }

  for (const feature of pointFeatures) {
    const [lng, lat] = feature.geometry.coordinates;
    const point = map.latLngToContainerPoint([lat, lng]);
    const isMatchedPoint = matchedPointIds.has(feature.properties.id);
    const radius = isMatchedPoint ? 7 : 5;
    drawPropertyTaxPoint(context, point.x, point.y, radius, isMatchedPoint);
    targets.push({
      clusterId: null,
      lat,
      lng,
      point: feature.properties,
      radius: radius + 5,
      x: point.x,
      y: point.y,
    });
  }

  return targets;
}

function drawPropertyTaxCluster(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  count: number,
) {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = "rgba(245, 158, 11, 0.82)";
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = "#854d0e";
  context.stroke();

  context.fillStyle = "#ffffff";
  context.font = "700 12px Inter, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(formatClusterCount(count), x, y + 0.5);
}

function drawPropertyTaxPoint(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  matched: boolean,
) {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = matched ? "rgba(245, 158, 11, 0.96)" : "rgba(59, 130, 246, 0.82)";
  context.fill();
  context.lineWidth = matched ? 2.5 : 1.5;
  context.strokeStyle = matched ? "#0f172a" : "#1e40af";
  context.stroke();
}

function findPropertyTaxHitTarget(targets: PropertyTaxHitTarget[], x: number, y: number) {
  let closestTarget: PropertyTaxHitTarget | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const target of targets) {
    const distance = Math.hypot(target.x - x, target.y - y);
    if (distance <= target.radius && distance < closestDistance) {
      closestTarget = target;
      closestDistance = distance;
    }
  }

  return closestTarget;
}

function geometryMetadataRows(identifiedFeature: IdentifiedFeature): IdentifyFieldRow[] {
  const geometry = identifiedFeature.feature.geometry;
  const partCount = geometryPartCount(geometry);
  const vertexCount = geometryVertexCount(geometry);

  return [
    { key: "feature_id", label: "Feature ID", value: String(identifiedFeature.feature.properties.id) },
    { key: "geometry_type", label: "Geometry", value: humanize(geometry.type) },
    { key: "parts", label: "Parts", value: partCount.toLocaleString() },
    { key: "vertices", label: "Vertices", value: vertexCount.toLocaleString() },
    {
      key: "clicked_location",
      label: "Clicked Location",
      value: `${identifiedFeature.latlng.lat.toFixed(5)}, ${identifiedFeature.latlng.lng.toFixed(5)}`,
    },
  ];
}

function firstKnownValue(rows: IdentifyFieldRow[]) {
  return rows.find((row) => row.value)?.value ?? null;
}

function formatIdentifyValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "boolean") {
    return formatBoolean(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  const serialized = JSON.stringify(value);
  if (!serialized || serialized === "{}" || serialized === "[]") {
    return null;
  }

  return serialized.length > 180 ? `${serialized.slice(0, 177)}...` : serialized;
}

function geometryPartCount(geometry: Geometry) {
  if (geometry.type === "MultiPolygon" || geometry.type === "MultiLineString" || geometry.type === "MultiPoint") {
    return geometry.coordinates.length;
  }

  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.length;
  }

  return 1;
}

function geometryVertexCount(geometry: Geometry): number {
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.reduce((count, child) => count + geometryVertexCount(child), 0);
  }

  return countCoordinatePairs(geometry.coordinates);
}

function countCoordinatePairs(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0;
  }

  if (typeof value[0] === "number" && typeof value[1] === "number") {
    return 1;
  }

  return value.reduce((count: number, child: unknown) => count + countCoordinatePairs(child), 0);
}

function isPolygonGeometry(geometry: Geometry | null | undefined) {
  return geometry?.type === "Polygon" || geometry?.type === "MultiPolygon";
}

function findIdentifiedFeatures(
  layerData: Partial<Record<LayerKey, LayerCollection>>,
  layerVisibility: Record<LayerKey, boolean>,
  latlng: L.LatLngLiteral,
): IdentifiedFeature[] {
  const identifiedFeatures: IdentifiedFeature[] = [];

  for (const layerKey of IDENTIFY_LAYER_ORDER) {
    if (!layerVisibility[layerKey]) {
      continue;
    }

    const collection = layerData[layerKey];
    const features = collection ? identifyOrderedFeatures(layerKey, collection) : [];

    for (const feature of features) {
      if (isPolygonGeometry(feature.geometry) && featureContainsLatLng(feature, latlng)) {
        identifiedFeatures.push({ layerKey, feature, latlng });
      }
    }
  }

  return identifiedFeatures;
}

function identifyOrderedFeatures(layerKey: LayerKey, collection: LayerCollection): LayerFeature[] {
  const orderedCollection =
    layerKey === "land_records"
      ? orderLandRecordFeatures(collection)
      : layerKey === "management_areas"
        ? orderManagementAreaFeatures(collection)
        : collection;

  return [...orderedCollection.features].reverse() as LayerFeature[];
}

function featureContainsLatLng(feature: Feature<Geometry, Record<string, unknown>>, latlng: L.LatLngLiteral) {
  const point: [number, number] = [latlng.lng, latlng.lat];
  const geometry = feature.geometry;

  if (geometry.type === "Polygon") {
    return polygonContainsPoint(geometry.coordinates as PolygonCoordinates, point);
  }

  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as MultiPolygonCoordinates).some((polygon) =>
      polygonContainsPoint(polygon, point),
    );
  }

  return false;
}

function polygonContainsPoint(polygon: PolygonCoordinates, point: [number, number]) {
  const [outerRing, ...innerRings] = polygon;
  if (!outerRing || !ringContainsPoint(outerRing, point)) {
    return false;
  }

  return !innerRings.some((ring) => ringContainsPoint(ring, point));
}

function ringContainsPoint(ring: LinearRingCoordinates, point: [number, number]) {
  const [x, y] = point;
  let inside = false;

  for (let currentIndex = 0, previousIndex = ring.length - 1; currentIndex < ring.length; previousIndex = currentIndex++) {
    const current = ring[currentIndex];
    const previous = ring[previousIndex];
    if (!current || !previous) {
      continue;
    }

    const [currentX, currentY] = current;
    const [previousX, previousY] = previous;
    const intersects =
      currentY > y !== previousY > y &&
      x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function QAMarkerLayer({
  questionAreas,
  selectedCode,
  onSelect,
}: {
  questionAreas: QuestionAreaCollection;
  selectedCode: string | null;
  onSelect: (code: string | null) => void;
}) {
  return (
    <>
      {questionAreas.features.map((feature) => {
        if (feature.geometry.type !== "Point") {
          return null;
        }

        const point = feature.geometry as Point;
        const [lng, lat] = point.coordinates;
        const code = feature.properties.code;

        return (
          <Marker
            key={code}
            eventHandlers={{ click: () => onSelect(code) }}
            icon={createQAMarker(selectedCode, code, feature.properties.actionabilityState)}
            position={[lat, lng]}
          />
        );
      })}
    </>
  );
}

function MapFocus({
  geometry,
  targetKey,
}: {
  geometry: Geometry | null;
  targetKey: string | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!geometry) {
      return;
    }

    if (geometry.type === "Point") {
      const point = geometry as Point;
      map.setView([point.coordinates[1], point.coordinates[0]], Math.max(map.getZoom(), 13));
      return;
    }

    const bounds = L.geoJSON(geometry as never).getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.35));
    }
  }, [geometry, map, targetKey]);

  return null;
}

function MapLegendControl({
  canReadPropertyTaxMap,
  layerVisibility,
  onToggleLayer,
  onTogglePropertyTaxLayer,
  propertyTaxLayerVisibility,
}: {
  canReadPropertyTaxMap: boolean;
  layerVisibility: Record<LayerKey, boolean>;
  onToggleLayer: (layerKey: LayerKey) => void;
  onTogglePropertyTaxLayer: (layerKey: PropertyTaxMapLayerKey) => void;
  propertyTaxLayerVisibility: PropertyTaxMapLayerVisibility;
}) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <MapControl className="map-control-shell legend-control" position="bottomright">
      <button
        aria-expanded={!collapsed}
        className="map-control-toggle"
        onClick={() => setCollapsed((current) => !current)}
        title={collapsed ? "Expand map legend" : "Collapse map legend"}
        type="button"
      >
        <span className="map-control-toggle-label">
          <span className="map-control-toggle-title">Legend</span>
        </span>
        <span aria-hidden="true" className="map-control-toggle-icon">
          {collapsed ? "+" : "-"}
        </span>
      </button>

      {!collapsed ? (
        <div className="map-control-panel">
          <div className="map-control-heading">
            <h3>Map Layers</h3>
            <span>In-map legend</span>
          </div>
          <div className="legend-list map-legend-list">
            {LEGEND_ITEMS.map((item) => {
              const visible =
                item.key === "qa_markers" ? true : layerVisibility[item.key as LayerKey];

              return (
                <div key={item.key} className="legend-group">
                  <div className="legend-item">
                    <span className={`legend-swatch legend-swatch-${item.swatch}`}>
                      {item.key === "qa_markers" ? QA_ACTIONABILITY_META.normal.symbol : null}
                    </span>
                    <span className="legend-label">{item.label}</span>
                    {item.toggleable ? (
                      <button
                        className="ghost-button legend-toggle"
                        onClick={() => onToggleLayer(item.key as LayerKey)}
                        type="button"
                      >
                        {visible ? "Hide" : "Show"}
                      </button>
                    ) : (
                      <span className="legend-static">Always visible</span>
                    )}
                  </div>
                  {item.key === "qa_markers" ? (
                    <div className="legend-sublist">
                      {QA_ACTIONABILITY_STATES.map((state) => (
                        <div key={state} className="legend-item legend-item-indented">
                          <span className={`legend-swatch legend-swatch-qa-marker qa-marker-${state}`}>
                            {QA_ACTIONABILITY_META[state].symbol}
                          </span>
                          <span className="legend-label">{QA_ACTIONABILITY_META[state].label}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {item.key === "land_records" ? (
                    <div className="legend-sublist">
                      {LAND_RECORD_LEGEND_ITEMS.map((recordType) => (
                        <div key={recordType.key} className="legend-item legend-item-indented">
                          <span className={`legend-swatch legend-swatch-${recordType.swatch}`} />
                          <span className="legend-label">{recordType.label}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {item.key === "management_areas" ? (
                    <div className="legend-sublist">
                      {MANAGEMENT_AREA_LEGEND_ITEMS.map((managementArea) => (
                        <div key={managementArea.key} className="legend-item legend-item-indented">
                          <span className={`legend-swatch legend-swatch-${managementArea.swatch}`} />
                          <span className="legend-label">{managementArea.label}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {canReadPropertyTaxMap ? (
              <>
                <PropertyTaxLegendItem
                  label="Regrid Parcels"
                  swatch="regrid-parcels"
                  visible={propertyTaxLayerVisibility.regridParcels}
                  onToggle={() => onTogglePropertyTaxLayer("regridParcels")}
                />
                <PropertyTaxLegendItem
                  label="Property Tax Points"
                  swatch="property-tax-points"
                  visible={propertyTaxLayerVisibility.propertyTaxPoints}
                  onToggle={() => onTogglePropertyTaxLayer("propertyTaxPoints")}
                />
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </MapControl>
  );
}

function PropertyTaxLegendItem({
  label,
  onToggle,
  swatch,
  visible,
}: {
  label: string;
  onToggle: () => void;
  swatch: string;
  visible: boolean;
}) {
  return (
    <div className="legend-group">
      <div className="legend-item">
        <span className={`legend-swatch legend-swatch-${swatch}`} />
        <span className="legend-label">{label}</span>
        <button className="ghost-button legend-toggle" onClick={onToggle} type="button">
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

function MeasurementControl({
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
    dblclick(event) {
      if (!active) {
        return;
      }

      L.DomEvent.stopPropagation(event.originalEvent);
      onFinish();
    },
  });

  return null;
}

function DetailItem({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? "mono" : ""}>{children}</dd>
    </div>
  );
}

function SkeletonDetail() {
  return (
    <section className="panel-section">
      <div className="skeleton skeleton-heading" />
      <div className="detail-grid">
        {[...Array(6)].map((_, index) => (
          <div key={index}>
            <div className="skeleton" style={{ height: "0.75rem", marginBottom: "0.5rem", width: "40%" }} />
            <div className="skeleton" style={{ height: "1.25rem", width: "80%" }} />
          </div>
        ))}
      </div>
    </section>
  );
}

function createQAMarker(selectedCode: string | null, code: string, actionabilityState: string | null) {
  const isSelected = selectedCode === code;
  const state = normalizeActionabilityState(actionabilityState);
  const meta = QA_ACTIONABILITY_META[state];

  return L.divIcon({
    className: "qa-marker-icon",
    html: `<div class="qa-marker-inner qa-marker-${state} ${isSelected ? "selected pulse" : ""}">${meta.symbol}</div>`,
    iconAnchor: [12, 12],
    iconSize: [24, 24],
  });
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

function formatMetric(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "None";
  }

  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
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

function formatBoolean(value: boolean | null | undefined) {
  if (value === null || value === undefined) {
    return "Unknown";
  }

  return value ? "Yes" : "No";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function workflowLabel(value: string | null | undefined) {
  return humanize(value ?? "review");
}

function workflowBadgeClass(value: string | null | undefined) {
  return isWorkflowOpen(value) ? "severity-medium" : "neutral";
}

function severityBadgeClass(value: string | null | undefined) {
  switch (value?.toLowerCase()) {
    case "high":
      return "severity-high";
    case "low":
      return "severity-low";
    case "medium":
    default:
      return "severity-medium";
  }
}

function normalizeActionabilityState(value: string | null | undefined): QuestionActionabilityState {
  const normalized = value?.toLowerCase();
  return QA_ACTIONABILITY_STATES.includes(normalized as QuestionActionabilityState)
    ? (normalized as QuestionActionabilityState)
    : "normal";
}

function actionabilityLabel(value: string | null | undefined) {
  return QA_ACTIONABILITY_META[normalizeActionabilityState(value)].label;
}

function actionabilityBadgeClass(value: string | null | undefined) {
  return `actionability-${normalizeActionabilityState(value)}`;
}

function isWorkflowOpen(value: string | null | undefined) {
  const status = value?.toLowerCase();
  return status === "review" || status === "active";
}
