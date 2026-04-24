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
  atlasPageLabel,
  atlasPreviewKind,
  atlasRecordSummary,
  atlasRecordSubtitle,
  atlasTargetPdfPage,
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
  pageReference: string | null;
  targetPage: number | null;
};

type AtlasDocumentRequest = {
  document: AtlasDocument;
  pageReference: string | null;
  relationship: "parent" | "child";
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
  const [previewDocument, setPreviewDocument] = useState<AtlasDocumentRequest | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [collapsedRecords, setCollapsedRecords] = useState<Record<string, boolean>>({});
  const [collapsedDocumentTrees, setCollapsedDocumentTrees] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setPreviewDocument(null);
    setPreviewState(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setPanelError(null);
    setCollapsedRecords({});
    setCollapsedDocumentTrees({});
  }, [selectedCode]);

  useEffect(() => {
    if (!previewDocument) {
      setPreviewState(null);
      setPreviewLoading(false);
      return;
    }

    const sourceUrl = previewDocument.document.contentUrl ?? previewDocument.document.downloadUrl;
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
        const kind = atlasPreviewKind(previewDocument.document, blob.type);
        const targetPage = kind === "pdf" ? resolveAtlasPageTarget(previewDocument) : null;
        setPreviewState({
          document: previewDocument.document,
          kind,
          pageReference: previewDocument.pageReference,
          targetPage,
          url: buildAtlasViewerUrl(objectUrl, kind, targetPage),
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

  const hasSelection = Boolean(selectedCode);
  const records = atlasQuery?.records ?? [];

  const previewLabel = useMemo(() => {
    if (!previewState) {
      return null;
    }

    const pageLabel = atlasPageLabel(previewState.pageReference);
    return [atlasDocumentTitle(previewState.document), previewState.kind.toUpperCase(), pageLabel]
      .filter(Boolean)
      .join(" | ");
  }, [previewState]);

  async function handleOpenDocument(request: AtlasDocumentRequest) {
    try {
      setPanelError(null);
      const { document, pageReference } = request;
      const sourceUrl = isAtlasPreviewableDocument(document)
        ? (document.contentUrl ?? document.downloadUrl)
        : (document.downloadUrl ?? document.contentUrl);
      if (!document.hasFile) {
        throw new Error("Document file is missing from Atlas package storage.");
      }
      if (!sourceUrl) {
        throw new Error("Document cannot be opened.");
      }

      const blob = await apiDownload(sourceUrl, token);
      const objectUrl = window.URL.createObjectURL(blob);
      const kind = atlasPreviewKind(document, blob.type);
      const targetPage = kind === "pdf" ? resolveAtlasPageTarget(request) : null;
      const openedWindow = window.open(
        buildAtlasViewerUrl(objectUrl, kind, targetPage),
        "_blank",
        "noopener,noreferrer",
      );
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
      if (!document.hasFile) {
        throw new Error("Document file is missing from Atlas package storage.");
      }
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
          <h2>Atlas Land Records</h2>
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
                <small>
                  {[
                    atlasDocumentSubtitle(previewState.document),
                    atlasPageLabel(previewState.pageReference),
                    atlasDocumentMeta(previewState.document),
                  ]
                    .filter(Boolean)
                    .join(" | ") || "Atlas document preview"}
                </small>
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
        const childDocuments = record.childDocuments ?? [];
        const recordKey = atlasRecordKey(record);
        const isRecordCollapsed = collapsedRecords[recordKey] ?? false;
        const isDocumentTreeCollapsed = collapsedDocumentTrees[recordKey] ?? false;
        const parentRequest = record.parentDocument
          ? {
              document: record.parentDocument,
              pageReference: record.parentPageNo,
              relationship: "parent" as const,
            }
          : null;

        return (
          <section className="panel-section atlas-record-card" key={record.lrNumber ?? atlasRecordSummary(record)}>
            <div className="atlas-record-header">
              <div className="section-heading atlas-record-heading">
                <div className="atlas-record-title-group">
                  <h2>{record.lrNumber ?? "Unnamed land record"}</h2>
                  <span>{atlasRecordSummary(record) || "Atlas match"}</span>
                </div>
                <button
                  aria-expanded={!isRecordCollapsed}
                  className="ghost-button atlas-collapse-button"
                  onClick={() =>
                    setCollapsedRecords((current) => ({
                      ...current,
                      [recordKey]: !isRecordCollapsed,
                    }))
                  }
                  type="button"
                >
                  {isRecordCollapsed ? "Expand" : "Collapse"}
                </button>
              </div>
              <div className="badge-row">
                {record.lrStatus ? <span className="badge neutral">{record.lrStatus}</span> : null}
                {record.lrType ? <span className="badge neutral">{record.lrType}</span> : null}
                {record.primaryDocumentNumber ? <span className="badge neutral">{record.primaryDocumentNumber}</span> : null}
              </div>
            </div>

            {!isRecordCollapsed ? (
              <>
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
                  <h3>Document tree</h3>
                  <div className="atlas-doc-heading-actions">
                    <span>{(record.parentDocument ? 1 : 0) + childDocuments.length}</span>
                    <button
                      aria-expanded={!isDocumentTreeCollapsed}
                      className="ghost-button atlas-collapse-button"
                      onClick={() =>
                        setCollapsedDocumentTrees((current) => ({
                          ...current,
                          [recordKey]: !isDocumentTreeCollapsed,
                        }))
                      }
                      type="button"
                    >
                      {isDocumentTreeCollapsed ? "Expand" : "Collapse"}
                    </button>
                  </div>
                </div>
                {!isDocumentTreeCollapsed ? (
                  <div className="atlas-document-tree">
                    {parentRequest ? (
                      <AtlasDocumentNode
                        actionTone="primary-button"
                        onDownload={handleDownloadDocument}
                        onOpen={handleOpenDocument}
                        onPreview={(request) => {
                          setPanelError(null);
                          setPreviewDocument(request);
                          setPreviewError(null);
                        }}
                        request={parentRequest}
                        title="Parent document"
                      />
                    ) : (
                      <p className="panel-note atlas-tree-note">No parent document is available for this Atlas land record.</p>
                    )}

                    {childDocuments.length > 0 ? (
                      <div className="atlas-child-branch" role="list" aria-label="Child Atlas documents">
                        {childDocuments.map((document, index) => (
                          <AtlasDocumentNode
                            key={atlasDocumentKey(document, index)}
                            onDownload={handleDownloadDocument}
                            onOpen={handleOpenDocument}
                            onPreview={(request) => {
                              setPanelError(null);
                              setPreviewDocument(request);
                              setPreviewError(null);
                            }}
                            request={{
                              document,
                              pageReference: document.pageNo,
                              relationship: "child",
                            }}
                            title="Child document"
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="panel-note atlas-tree-note">No child documents are linked to this Atlas land record.</p>
                    )}
                  </div>
                ) : null}
              </>
            ) : null}
          </section>
        );
      })}

    </>
  );
}

function atlasRecordKey(record: AtlasQueryResult["records"][number]) {
  return record.lrNumber ?? atlasRecordSummary(record) ?? record.primaryDocumentNumber ?? "atlas-record";
}

function AtlasDocumentNode({
  actionTone,
  onDownload,
  onOpen,
  onPreview,
  request,
  title,
}: {
  actionTone?: "ghost-button" | "primary-button";
  onDownload: (document: AtlasDocument) => Promise<void>;
  onOpen: (request: AtlasDocumentRequest) => Promise<void>;
  onPreview: (request: AtlasDocumentRequest) => void;
  request: AtlasDocumentRequest;
  title: string;
}) {
  const pageLabel = atlasPageLabel(request.pageReference);
  const hasFile = request.document.hasFile;

  return (
    <article
      className={`atlas-document-card atlas-document-card-${request.relationship}`}
      role={request.relationship === "child" ? "listitem" : undefined}
    >
      <div className="atlas-document-rail" aria-hidden="true">
        <span className="atlas-document-line" />
        <span className="atlas-document-dot" />
      </div>
      <div className="atlas-document-body">
        <div className="atlas-document-copy">
          <div className="atlas-document-badges">
            <span className="badge neutral">{title}</span>
            {pageLabel ? <span className="badge neutral">{pageLabel}</span> : null}
            {!hasFile ? <span className="badge warning">Missing file</span> : null}
          </div>
          <strong>{atlasDocumentTitle(request.document)}</strong>
          <span>{atlasDocumentSubtitle(request.document) || "Atlas document"}</span>
          <small>{atlasDocumentMeta(request.document) || "No additional document metadata available."}</small>
        </div>
        <div className="atlas-document-actions">
          {hasFile && isAtlasPreviewableDocument(request.document) ? (
            <button className="ghost-button" onClick={() => onPreview(request)} type="button">
              Preview
            </button>
          ) : null}
          <button className="ghost-button" disabled={!hasFile} onClick={() => void onOpen(request)} type="button">
            Open
          </button>
          <button
            className={actionTone ?? "ghost-button"}
            disabled={!hasFile}
            onClick={() => void onDownload(request.document)}
            type="button"
          >
            Download
          </button>
        </div>
      </div>
    </article>
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

function buildAtlasViewerUrl(url: string, kind: "image" | "pdf" | "other", targetPage: number | null) {
  if (kind !== "pdf" || !targetPage) {
    return url;
  }

  return `${url}#page=${targetPage}`;
}

function resolveAtlasPageTarget(request: AtlasDocumentRequest) {
  return request.document.pageTarget ?? atlasTargetPdfPage(request.pageReference);
}
