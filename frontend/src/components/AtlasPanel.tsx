import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { apiDownload } from "../lib/api";
import {
  ATLAS_BUFFER_OPTIONS,
  atlasBufferLabel,
  atlasDocumentKey,
  atlasDocumentMeta,
  atlasDocumentSubtitle,
  atlasDocumentTitle,
  atlasPreviewKind,
  atlasRecordSummary,
  atlasRecordSubtitle,
  isAtlasPreviewableDocument,
  type AtlasBufferFeet,
  type AtlasDocument,
  type AtlasQueryResult,
  type AtlasTarget,
} from "../lib/atlas";

type AtlasPanelProps = {
  token: string;
  selectedCode: string | null;
  selectedDetail: AtlasTarget | null;
  isDetailLoading: boolean;
  atlasQuery: AtlasQueryResult | null;
  atlasLoading: boolean;
  atlasError: string | null;
  bufferFeet: AtlasBufferFeet;
  onBufferChange: (bufferFeet: AtlasBufferFeet) => void;
};

type PreviewState = {
  document: AtlasDocument;
  url: string;
  kind: "image" | "pdf" | "other";
};

export function AtlasPanel({
  token,
  selectedCode,
  selectedDetail,
  isDetailLoading,
  atlasQuery,
  atlasLoading,
  atlasError,
  bufferFeet,
  onBufferChange,
}: AtlasPanelProps) {
  const [previewDocument, setPreviewDocument] = useState<AtlasDocument | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);

  useEffect(() => {
    setPreviewDocument(null);
    setPreviewState(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setPanelError(null);
  }, [selectedCode]);

  useEffect(() => {
    if (!previewDocument) {
      setPreviewState(null);
      setPreviewLoading(false);
      return;
    }

    const sourceUrl = previewDocument.contentUrl ?? previewDocument.downloadUrl;
    if (!sourceUrl) {
      setPreviewState(null);
      setPreviewLoading(false);
      setPreviewError("Preview unavailable for this document.");
      return;
    }

    let alive = true;
    let objectUrl: string | null = null;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewState(null);

    apiDownload(sourceUrl, token)
      .then((blob) => {
        if (!alive) {
          return;
        }

        objectUrl = window.URL.createObjectURL(blob);
        setPreviewState({
          document: previewDocument,
          kind: atlasPreviewKind(previewDocument, blob.type),
          url: objectUrl,
        });
      })
      .catch((error) => {
        if (alive) {
          setPreviewError(error instanceof Error ? error.message : "Failed to load document preview.");
        }
      })
      .finally(() => {
        if (alive) {
          setPreviewLoading(false);
        }
      });

    return () => {
      alive = false;
      if (objectUrl) {
        window.URL.revokeObjectURL(objectUrl);
      }
    };
  }, [previewDocument, token]);

  const matchedRecordCount = atlasQuery?.matchedRecordCount ?? atlasQuery?.records.length ?? 0;
  const linkedDocumentCount =
    atlasQuery?.linkedDocumentCount ??
    atlasQuery?.records.reduce((total, record) => total + record.documents.length, 0) ??
    0;
  const warningCount = atlasQuery?.warnings.length ?? 0;
  const hasSelection = Boolean(selectedCode);
  const records = atlasQuery?.records ?? [];

  const previewLabel = useMemo(() => {
    if (!previewState) {
      return null;
    }

    return `${atlasDocumentTitle(previewState.document)} | ${previewState.kind.toUpperCase()}`;
  }, [previewState]);

  async function handleOpenDocument(document: AtlasDocument) {
    try {
      setPanelError(null);
      const sourceUrl = isAtlasPreviewableDocument(document)
        ? (document.contentUrl ?? document.downloadUrl)
        : (document.downloadUrl ?? document.contentUrl);
      if (!sourceUrl) {
        throw new Error("Document cannot be opened.");
      }

      const blob = await apiDownload(sourceUrl, token);
      const objectUrl = window.URL.createObjectURL(blob);
      const openedWindow = window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 60_000);

      if (!openedWindow) {
        setPanelError("The browser blocked the document tab.");
      }
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Failed to open document.");
    }
  }

  async function handleDownloadDocument(document: AtlasDocument) {
    try {
      setPanelError(null);
      const sourceUrl = document.downloadUrl ?? document.contentUrl;
      if (!sourceUrl) {
        throw new Error("Document cannot be downloaded.");
      }

      const blob = await apiDownload(sourceUrl, token);
      const objectUrl = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = objectUrl;
      link.download = document.fileName ?? document.docName ?? document.documentNumber ?? "atlas-document";
      link.click();
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Failed to download document.");
    }
  }

  function renderDocumentPreview() {
    if (previewLoading) {
      return <p className="atlas-preview-placeholder panel-note">Loading preview...</p>;
    }

    if (previewError) {
      return <p className="atlas-error-banner atlas-preview-error">{previewError}</p>;
    }

    if (!previewState) {
      return <p className="atlas-preview-placeholder panel-note">Choose a previewable PDF or image to inspect it inline.</p>;
    }

    if (previewState.kind === "image") {
      return <img alt={atlasDocumentTitle(previewState.document)} className="atlas-preview-media" src={previewState.url} />;
    }

    return (
      <iframe
        className="atlas-preview-media atlas-preview-frame"
        title={previewLabel ?? "Document preview"}
        src={previewState.url}
      />
    );
  }

  if (!hasSelection) {
    return (
      <section className="panel-section atlas-empty-shell">
        <div className="section-heading">
          <h2>Atlas Workspace</h2>
          <span>Supporting context</span>
        </div>
        <div className="atlas-empty-state">
          <strong>Select a question area</strong>
          <p>Atlas context appears here after a question area is selected on the left.</p>
        </div>
      </section>
    );
  }

  if (selectedCode && isDetailLoading) {
    return (
      <section className="panel-section atlas-loading-shell">
        <div className="section-heading">
          <h2>Atlas Workspace</h2>
          <span>{selectedCode}</span>
        </div>
        <p className="panel-note">Loading the selected question area before Atlas context can be fetched.</p>
        <div className="atlas-loading-card">
          <div className="skeleton skeleton-heading" />
          <div className="skeleton" style={{ height: "0.8rem", width: "70%" }} />
          <div className="skeleton" style={{ height: "0.8rem", width: "55%" }} />
        </div>
      </section>
    );
  }

  if (selectedCode && !selectedDetail) {
    return (
      <section className="panel-section atlas-loading-shell">
        <div className="section-heading">
          <h2>Atlas Workspace</h2>
          <span>{selectedCode}</span>
        </div>
        <p className="atlas-error-banner">The selected question area could not be loaded.</p>
      </section>
    );
  }

  return (
    <>
      <section className="panel-section atlas-header">
        <div className="section-heading primary-heading">
          <h2>{selectedDetail?.title ?? "Atlas Workspace"}</h2>
          <span>{selectedDetail?.code ?? selectedCode}</span>
        </div>
        <p className="summary-copy">
          {selectedDetail?.summary ?? "Atlas context linked to the currently selected question area."}
        </p>
        <div className="atlas-summary-grid">
          <div className="atlas-summary-card">
            <span>Matched records</span>
            <strong>{matchedRecordCount.toLocaleString()}</strong>
          </div>
          <div className="atlas-summary-card">
            <span>Linked documents</span>
            <strong>{linkedDocumentCount.toLocaleString()}</strong>
          </div>
          <div className="atlas-summary-card">
            <span>Buffer</span>
            <strong>{atlasBufferLabel(bufferFeet)}</strong>
          </div>
        </div>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <h2>Buffer</h2>
          <span>Feet</span>
        </div>
        <div className="atlas-buffer-switch" role="tablist" aria-label="Atlas buffer distance">
          {ATLAS_BUFFER_OPTIONS.map((bufferOption) => (
            <button
              aria-pressed={bufferFeet === bufferOption}
              className={`atlas-buffer-option ${bufferFeet === bufferOption ? "active" : ""}`}
              key={bufferOption}
              onClick={() => onBufferChange(bufferOption)}
              type="button"
            >
              {atlasBufferLabel(bufferOption)}
            </button>
          ))}
        </div>
      </section>

      {atlasError ? <p className="atlas-error-banner">{atlasError}</p> : null}
      {panelError ? <p className="atlas-error-banner">{panelError}</p> : null}

      <section className="panel-section">
        <div className="section-heading">
          <h2>Document Preview</h2>
          <span>{previewState ? atlasDocumentTitle(previewState.document) : "Inline viewer"}</span>
        </div>
        <div className="atlas-preview-shell">
          {previewState ? (
            <div className="atlas-preview-toolbar">
              <div className="atlas-preview-title">
                <strong>{atlasDocumentTitle(previewState.document)}</strong>
                <small>{atlasDocumentSubtitle(previewState.document) || atlasDocumentMeta(previewState.document)}</small>
              </div>
              <button
                className="ghost-button"
                onClick={() => {
                  setPreviewDocument(null);
                  setPreviewState(null);
                  setPreviewError(null);
                }}
                type="button"
              >
                Close
              </button>
            </div>
          ) : null}
          {renderDocumentPreview()}
        </div>
      </section>

      {atlasLoading ? (
        <section className="panel-section">
          <div className="atlas-loading-card">
            <div className="skeleton skeleton-heading" />
            <div className="skeleton" style={{ height: "0.8rem", width: "65%" }} />
            <div className="skeleton" style={{ height: "0.8rem", width: "45%" }} />
          </div>
        </section>
      ) : null}

      {!atlasLoading && records.length === 0 ? (
        <section className="panel-section">
          <p className="empty-state">No Atlas records matched this question area at the current buffer.</p>
        </section>
      ) : null}

      {records.map((record) => {
        const documents = record.documents ?? [];

        return (
          <section className="panel-section atlas-record-card" key={record.lrNumber ?? atlasRecordSummary(record)}>
            <div className="section-heading atlas-record-heading">
              <h2>{record.lrNumber ?? "Unnamed land record"}</h2>
              <span>{atlasRecordSummary(record) || "Atlas match"}</span>
            </div>
            <div className="badge-row">
              {record.lrStatus ? <span className="badge neutral">{record.lrStatus}</span> : null}
              {record.lrType ? <span className="badge neutral">{record.lrType}</span> : null}
              {record.primaryDocumentNumber ? <span className="badge neutral">{record.primaryDocumentNumber}</span> : null}
            </div>
            <p className="atlas-record-subtitle">{atlasRecordSubtitle(record) || "Matched Atlas land record"}</p>
            <dl className="detail-grid atlas-record-grid">
              <AtlasDetail label="Property">{record.propertyName ?? "None"}</AtlasDetail>
              <AtlasDetail label="Fund">{record.fundName ?? "None"}</AtlasDetail>
              <AtlasDetail label="Region">{record.regionName ?? "None"}</AtlasDetail>
              <AtlasDetail label="Acq Date">{record.acqDate ?? "None"}</AtlasDetail>
              <AtlasDetail label="Tax Parcel" mono>
                {record.taxParcelNumber ?? "None"}
              </AtlasDetail>
              <AtlasDetail label="GIS Acres" mono>
                {formatAtlasMetric(record.gisAcres)}
              </AtlasDetail>
              <AtlasDetail label="Deed Acres" mono>
                {formatAtlasMetric(record.deedAcres)}
              </AtlasDetail>
              <AtlasDetail label="Township">{record.township ?? "None"}</AtlasDetail>
              <AtlasDetail label="Range">{record.range ?? "None"}</AtlasDetail>
              <AtlasDetail label="Section">{record.section ?? "None"}</AtlasDetail>
              <AtlasDetail label="FIPS" mono>
                {record.fips ?? "None"}
              </AtlasDetail>
              <AtlasDetail label="Primary Doc" mono>
                {record.primaryDocumentNumber ?? "None"}
              </AtlasDetail>
            </dl>
            {record.remark ? (
              <p className="atlas-record-remark">
                <strong>Remark</strong>
                <span>{record.remark}</span>
              </p>
            ) : null}

            <div className="section-heading atlas-doc-heading">
              <h3>Linked documents</h3>
              <span>{documents.length}</span>
            </div>
            <div className="atlas-document-list">
              {documents.length > 0 ? (
                documents.map((document, index) => (
                  <article className="atlas-document-card" key={atlasDocumentKey(document, index)}>
                    <div className="atlas-document-copy">
                      <strong>{atlasDocumentTitle(document)}</strong>
                      <span>{atlasDocumentSubtitle(document) || "Linked Atlas document"}</span>
                      <small>{atlasDocumentMeta(document)}</small>
                    </div>
                    <div className="atlas-document-actions">
                      {isAtlasPreviewableDocument(document) ? (
                        <button
                          className="ghost-button"
                          onClick={() => {
                            setPanelError(null);
                            setPreviewDocument(document);
                            setPreviewError(null);
                          }}
                          type="button"
                        >
                          Preview
                        </button>
                      ) : null}
                      <button className="ghost-button" onClick={() => void handleOpenDocument(document)} type="button">
                        Open
                      </button>
                      <button className="primary-button" onClick={() => void handleDownloadDocument(document)} type="button">
                        Download
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <p className="panel-note">No documents are linked to this Atlas record.</p>
              )}
            </div>
          </section>
        );
      })}

      {warningCount > 0 ? (
        <section className="panel-section">
          <div className="section-heading">
            <h2>Warnings</h2>
            <span>{warningCount}</span>
          </div>
          <div className="atlas-warning-list">
            {atlasQuery?.warnings.map((warning, index) => (
              <article className="atlas-warning-card" key={`${warning.code ?? "warning"}-${index}`}>
                <div>
                  <strong>{warning.code ?? "Warning"}</strong>
                  <small>{warning.severity ?? "info"}</small>
                </div>
                <p>{warning.message ?? "Atlas returned a warning for this selection."}</p>
                {warning.lrNumber || warning.documentNumber ? (
                  <span>{[warning.lrNumber, warning.documentNumber].filter(Boolean).join(" | ")}</span>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function AtlasDetail({
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

function formatAtlasMetric(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "None";
  }

  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}
