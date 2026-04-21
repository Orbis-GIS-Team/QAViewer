import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import L from "leaflet";
import type { PathOptions } from "leaflet";
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

type SearchResult = {
  type: "question_area";
  id: string;
  label: string;
  subtitle: string;
};

type SearchField = "all" | "parcel_code" | "county" | "qa_id";

type SummaryPayload = {
  questionAreas: number;
  comments: number;
  documents: number;
  statuses: Record<string, number>;
  severities: Record<string, number>;
};

type LayerKey = "land_records" | "management_areas";
type MeasureMode = "distance" | "area";
type ControlPosition = "topleft" | "topright" | "bottomleft" | "bottomright";

type QuestionAreaProperties = {
  code: string;
  status: string;
  severity: string;
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
};

type QuestionAreaFeature = Feature<Geometry, QuestionAreaProperties>;
type QuestionAreaCollection = FeatureCollection<Geometry, QuestionAreaProperties>;

type LayerFeatureProperties = {
  id: number;
  [key: string]: unknown;
};

type LayerCollection = FeatureCollection<Geometry, LayerFeatureProperties>;

type QuestionAreaDetail = {
  id: number;
  code: string;
  sourceLayer: string;
  status: string;
  severity: string;
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

const STATUS_OPTIONS = ["review", "active", "resolved", "hold"];
const SEARCH_FIELD_OPTIONS: Array<{ value: SearchField; label: string }> = [
  { value: "all", label: "All fields" },
  { value: "qa_id", label: "Question Area ID" },
  { value: "parcel_code", label: "Parcel / Owner" },
  { value: "county", label: "County / State" },
];

const initialLayers: Record<LayerKey, boolean> = {
  land_records: true,
  management_areas: true,
};

const LEGEND_ITEMS: LegendItem[] = [
  { key: "qa_markers", label: "Question Areas", swatch: "qa-marker", toggleable: false },
  { key: "land_records", label: "Land Records", swatch: "land-records", toggleable: true },
  { key: "management_areas", label: "Management Areas", swatch: "management", toggleable: true },
];

const landRecordStyle: PathOptions = {
  color: "#0f766e",
  weight: 2,
  fillColor: "#5eead4",
  fillOpacity: 0.08,
};

const managementAreaStyle: PathOptions = {
  color: "#39ff14",
  weight: 2,
  fillColor: "#39ff14",
  fillOpacity: 0.06,
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
  const [layerVisibility, setLayerVisibility] = useState(initialLayers);
  const [layerData, setLayerData] = useState<Partial<Record<LayerKey, LayerCollection>>>({});
  const [searchInput, setSearchInput] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchField, setSearchField] = useState<SearchField>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<QuestionAreaDetail | null>(null);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft>({
    status: "review",
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
  });

  const deferredSearch = useDeferredValue(searchInput);

  function showFeedback(message: string, type: FeedbackState["type"] = "error") {
    setFeedback({ message, type });
  }

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
    const query = deferredSearch.trim();
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    let alive = true;
    const params = new URLSearchParams({ q: query, field: searchField });

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
  }, [deferredSearch, searchField, session.token]);

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams({
      bbox: mapBbox,
      limit: "600",
    });

    if (searchFilter) {
      params.set("search", searchFilter);
      params.set("field", searchField);
    }

    if (statusFilter !== "all") {
      params.set("status", statusFilter);
    }

    apiRequest<QuestionAreaCollection>(`/question-areas?${params.toString()}`, {
      token: session.token,
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
        if (alive) {
          showFeedback(error instanceof Error ? error.message : "Failed to load question areas.");
        }
      });

    return () => {
      alive = false;
    };
  }, [mapBbox, searchField, searchFilter, session.token, statusFilter]);

  useEffect(() => {
    const visibleLayers = (Object.keys(layerVisibility) as LayerKey[]).filter(
      (layerKey) => layerVisibility[layerKey],
    );

    if (visibleLayers.length === 0) {
      setLayerData({});
      return;
    }

    let alive = true;

    Promise.all(
      visibleLayers.map(async (layerKey) => {
        const payload = await apiRequest<LayerCollection>(
          `/layers/${layerKey}?bbox=${encodeURIComponent(mapBbox)}`,
          { token: session.token },
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
        if (alive) {
          showFeedback(error instanceof Error ? error.message : "Failed to load map layers.");
        }
      });

    return () => {
      alive = false;
    };
  }, [layerVisibility, mapBbox, session.token]);

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
      summary: payload.summary,
      description: payload.description ?? "",
      assignedReviewer: payload.assignedReviewer ?? "",
    });
  }

  async function handleSaveDetail() {
    if (!selectedCode) {
      return;
    }
    if (!editDraft.summary.trim()) {
      showFeedback("Summary is required.");
      return;
    }

    setBusy((current) => ({ ...current, saving: true }));
    setFeedback(null);

    try {
      await apiRequest(`/question-areas/${selectedCode}`, {
        method: "PATCH",
        token: session.token,
        body: {
          status: editDraft.status,
          summary: editDraft.summary.trim(),
          description: editDraft.description.trim() || null,
          assignedReviewer: editDraft.assignedReviewer.trim() || null,
        },
      });
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
      const blob = await apiDownload(fileRecord.downloadUrl.replace("/api", ""), session.token);
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = fileRecord.originalName;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Download failed.");
    }
  }

  function selectQuestionArea(code: string | null) {
    setSelectedCode(code);
    setSearchResults([]);
  }

  function toggleLayer(layerKey: LayerKey) {
    setLayerVisibility((current) => ({
      ...current,
      [layerKey]: !current[layerKey],
    }));
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchFilter(searchInput.trim());
  }

  function clearSearch() {
    setSearchInput("");
    setSearchFilter("");
    setSearchResults([]);
  }

  const filteredAreaCount = questionAreas?.features.length ?? 0;
  const openQuestionAreas = (summary?.statuses.review ?? 0) + (summary?.statuses.active ?? 0);
  const selectedLocation = [selectedDetail?.county, selectedDetail?.state].filter(Boolean).join(", ");
  const selectedContext = [selectedDetail?.parcelCode, selectedLocation].filter(Boolean).join(" | ");

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
                <span className={`badge ${workflowBadgeClass(selectedDetail.status)}`}>
                  {workflowLabel(selectedDetail.status)}
                </span>
                <span className={`badge ${severityBadgeClass(selectedDetail.severity)}`}>
                  {humanize(selectedDetail.severity)}
                </span>
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
          leftPanelCollapsed ? "left-collapsed" : "",
          rightPanelCollapsed ? "right-collapsed" : "",
          leftPanelCollapsed && rightPanelCollapsed ? "both-collapsed" : "",
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
                    <span>{busy.detail ? "Loading..." : selectedDetail?.code ?? "Selected record"}</span>
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
                        placeholder="Search code, parcel, owner, county..."
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
                          value={searchField}
                          onChange={(event) => setSearchField(event.target.value as SearchField)}
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
                          value={statusFilter}
                          onChange={(event) => setStatusFilter(event.target.value)}
                        >
                          <option value="all">All statuses</option>
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>
                              {workflowLabel(status)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="search-input-row">
                      <button className="primary-button" type="submit">
                        Apply filter
                      </button>
                      <button className="ghost-button" onClick={clearSearch} type="button">
                        Clear
                      </button>
                    </div>
                  </form>
                </section>

                <section className="panel-section">
                  <div className="section-heading">
                    <h2>Visible Results</h2>
                    <span>{filteredAreaCount} in map extent</span>
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
                              <span className={`badge ${severityBadgeClass(properties.severity)}`}>
                                {humanize(properties.severity)}
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
          <ManagementPatternDefs />
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
            <MapLegendControl layerVisibility={layerVisibility} onToggleLayer={toggleLayer} />
            <MeasurementControl />
            <MapViewportWatcher onChange={setMapBbox} />
            <MapFocus geometry={selectedDetail?.geometry ?? null} targetKey={selectedDetail?.code ?? null} />

            <Pane name="land-records" style={{ zIndex: 380 }}>
              {layerVisibility.land_records && layerData.land_records ? (
                <GeoJSON data={layerData.land_records} style={landRecordStyle} />
              ) : null}
            </Pane>

            <Pane name="management-areas" style={{ zIndex: 390 }}>
              {layerVisibility.management_areas && layerData.management_areas ? (
                <GeoJSON data={layerData.management_areas} style={managementAreaStyle} />
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
        </section>

        <aside className={`workspace-panel right-panel ${rightPanelCollapsed ? "collapsed" : ""}`}>
          <button
            className="collapse-toggle"
            onClick={() => setRightPanelCollapsed((current) => !current)}
            title={rightPanelCollapsed ? "Expand panel" : "Collapse panel"}
            type="button"
          >
            {rightPanelCollapsed ? "<" : ">"}
          </button>

          <div className="panel-content">
            <section className="panel-section reserved-panel">
              <div className="section-heading">
                <h2>Reserved Workspace</h2>
                <span>Future tools</span>
              </div>
              <p className="panel-note">
                This panel is intentionally open for the next round of functionality. The active review
                workflow now lives in the left rail.
              </p>
              <div className="reserved-panel-card">
                <strong>{selectedDetail ? selectedDetail.code : "No active record"}</strong>
                <span>
                  {selectedDetail
                    ? "Keep this space available for supporting tools tied to the selected question area."
                    : "Select a question area to review it from the left side while this panel remains available."}
                </span>
              </div>
            </section>
          </div>
        </aside>
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

function ReviewRecordSections({
  busy,
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
  return (
    <>
      <section className="panel-section">
        <div className="section-heading primary-heading">
          <h2>{selectedDetail.title}</h2>
          <span>{selectedDetail.code}</span>
        </div>
        <div className="badge-row">
          <span className={`badge ${workflowBadgeClass(selectedDetail.status)}`}>
            {workflowLabel(selectedDetail.status)}
          </span>
          <span className={`badge ${severityBadgeClass(selectedDetail.severity)}`}>
            {humanize(selectedDetail.severity)}
          </span>
        </div>
        <p className="summary-copy">{selectedDetail.summary}</p>
        <dl className="detail-grid">
          <DetailItem label="Parcel Code" mono>{selectedDetail.parcelCode ?? "None"}</DetailItem>
          <DetailItem label="Owner">{selectedDetail.ownerName ?? "Unknown"}</DetailItem>
          <DetailItem label="County">{selectedDetail.county ?? "Unknown"}</DetailItem>
          <DetailItem label="State">{selectedDetail.state ?? "Unknown"}</DetailItem>
          <DetailItem label="Property">{selectedDetail.propertyName ?? "None"}</DetailItem>
          <DetailItem label="Tract">{selectedDetail.tractName ?? "None"}</DetailItem>
          <DetailItem label="Fund">{selectedDetail.fundName ?? "None"}</DetailItem>
          <DetailItem label="Source Layer">{selectedDetail.sourceLayer}</DetailItem>
        </dl>
        {selectedDetail.landServices ? (
          <div className="qa-reason">
            <dt>Land Services Note</dt>
            <dd>{selectedDetail.landServices}</dd>
          </div>
        ) : null}
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <h2>Data Signals</h2>
          <span>Read-only source context</span>
        </div>
        <dl className="detail-grid">
          <DetailItem label="Tax Bill Acres" mono>{formatMetric(selectedDetail.taxBillAcres)}</DetailItem>
          <DetailItem label="GIS Acres" mono>{formatMetric(selectedDetail.gisAcres)}</DetailItem>
          <DetailItem label="In Legal Layer">{formatBoolean(selectedDetail.existsInLegalLayer)}</DetailItem>
          <DetailItem label="In Management Layer">
            {formatBoolean(selectedDetail.existsInManagementLayer)}
          </DetailItem>
          <DetailItem label="In Client Bill Data">
            {formatBoolean(selectedDetail.existsInClientTabularBillData)}
          </DetailItem>
          <DetailItem label="Assigned Reviewer">{selectedDetail.assignedReviewer ?? "Unassigned"}</DetailItem>
        </dl>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <h2>Workflow Controls</h2>
          <span>Editable</span>
        </div>
        <div className="form-stack">
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
        <form className="form-stack" onSubmit={handleCommentSubmit}>
          <label>
            Add comment
            <textarea rows={3} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} />
          </label>
          <button className="primary-button" disabled={busy.commenting} type="submit">
            {busy.commenting ? "Posting..." : "Post comment"}
          </button>
        </form>
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
      </section>
    </>
  );
}

function MapViewportWatcher({ onChange }: { onChange: (bbox: string) => void }) {
  const map = useMap();

  useEffect(() => {
    onChange(map.getBounds().toBBoxString());
  }, [map, onChange]);

  useMapEvents({
    moveend(event) {
      onChange(event.target.getBounds().toBBoxString());
    },
  });

  return null;
}

function ManagementPatternDefs() {
  return (
    <svg aria-hidden="true" style={{ height: 0, position: "absolute", width: 0 }}>
      <defs>
        <pattern id="management-pattern" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" fill="#39ff14" r="1" />
        </pattern>
      </defs>
    </svg>
  );
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
            icon={createQAMarker(selectedCode, code)}
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
  layerVisibility,
  onToggleLayer,
}: {
  layerVisibility: Record<LayerKey, boolean>;
  onToggleLayer: (layerKey: LayerKey) => void;
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
                <div key={item.key} className="legend-item">
                  <span className={`legend-swatch legend-swatch-${item.swatch}`} />
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
              );
            })}
          </div>
        </div>
      ) : null}
    </MapControl>
  );
}

function MeasurementControl() {
  const [collapsed, setCollapsed] = useState(true);
  const [mode, setMode] = useState<MeasureMode | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [points, setPoints] = useState<L.LatLngLiteral[]>([]);

  const distanceMeters = totalDistanceMeters(points);
  const areaSquareMeters = mode === "area" ? polygonAreaSquareMeters(points) : 0;
  const perimeterMeters =
    mode === "area" && points.length > 2 ? totalDistanceMeters([...points, points[0]]) : 0;
  const lastPoint = points[points.length - 1] ?? null;

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

  function addPoint(point: L.LatLngLiteral) {
    setPoints((current) => [...current, point]);
  }

  const summaryLabel =
    mode === "area"
      ? points.length >= 3
        ? `${formatArea(areaSquareMeters)} area`
        : "Add at least three points"
      : points.length >= 2
        ? `${formatDistance(distanceMeters)} total`
        : "Add at least two points";

  return (
    <>
      <MeasureInteraction active={isCapturing} onAddPoint={addPoint} />

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
                    ? `${formatArea(areaSquareMeters)} | ${formatDistance(perimeterMeters)} perimeter`
                    : formatDistance(distanceMeters)}
                </Tooltip>
              ) : null}
            </CircleMarker>
          ))}
        </Pane>
      ) : null}

      <MapControl className="map-control-shell measurement-control" position="topleft">
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

            <div className="measurement-actions">
              <button className="ghost-button" onClick={() => startMeasurement("distance")} type="button">
                Distance
              </button>
              <button className="ghost-button" onClick={() => startMeasurement("area")} type="button">
                Area
              </button>
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
              <p className="measurement-hint">
                {mode === "area" && points.length >= 3
                  ? `${formatDistance(perimeterMeters)} perimeter`
                  : isCapturing
                    ? "Click on the map to add more points."
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
}: {
  active: boolean;
  onAddPoint: (point: L.LatLngLiteral) => void;
}) {
  useMapEvents({
    click(event) {
      if (!active) {
        return;
      }

      onAddPoint(event.latlng);
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

function createQAMarker(selectedCode: string | null, code: string) {
  const isSelected = selectedCode === code;

  return L.divIcon({
    className: "qa-marker-icon",
    html: `<div class="qa-marker-inner ${isSelected ? "selected pulse" : ""}">?</div>`,
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

function formatDistance(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} km`;
  }

  return `${value.toFixed(0)} m`;
}

function formatArea(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)} sq km`;
  }

  if (value >= 10_000) {
    return `${(value / 10_000).toFixed(2)} ha`;
  }

  return `${value.toFixed(0)} sq m`;
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

function isWorkflowOpen(value: string | null | undefined) {
  const status = value?.toLowerCase();
  return status === "review" || status === "active";
}
