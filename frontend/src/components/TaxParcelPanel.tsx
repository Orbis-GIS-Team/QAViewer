import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { apiDownload } from "../lib/api";
import {
  TAX_PARCEL_BUFFER_OPTIONS,
  isTaxBillPreviewable,
  taxBillMeta,
  taxBillTitle,
  taxParcelAreaLabel,
  taxParcelBufferLabel,
  taxParcelDistanceLabel,
  taxParcelKey,
  taxParcelSubtitle,
  taxParcelTitle,
  type TaxBill,
  type TaxParcel,
  type TaxParcelBufferFeet,
  type TaxParcelQueryResult,
  type TaxParcelTarget,
} from "../lib/taxParcels";

type TaxParcelPanelProps = {
  token: string;
  selectedCode: string | null;
  selectedDetail: TaxParcelTarget | null;
  isDetailLoading: boolean;
  taxParcelQuery: TaxParcelQueryResult | null;
  taxParcelLoading: boolean;
  taxParcelError: string | null;
  bufferFeet: TaxParcelBufferFeet;
  onBufferChange: (bufferFeet: TaxParcelBufferFeet) => void;
};

type PreviewState = {
  bill: TaxBill;
  url: string;
  kind: "image" | "pdf" | "other";
};

export function TaxParcelPanel({
  token,
  selectedCode,
  selectedDetail,
  isDetailLoading,
  taxParcelQuery,
  taxParcelLoading,
  taxParcelError,
  bufferFeet,
  onBufferChange,
}: TaxParcelPanelProps) {
  const [previewBill, setPreviewBill] = useState<TaxBill | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [collapsedParcels, setCollapsedParcels] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setPreviewBill(null);
    setPreviewState(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setPanelError(null);
    setCollapsedParcels({});
  }, [selectedCode]);

  useEffect(() => {
    if (!previewBill) {
      setPreviewState(null);
      setPreviewLoading(false);
      return;
    }

    const sourceUrl = previewBill.contentUrl ?? previewBill.downloadUrl;
    if (!sourceUrl) {
      setPreviewState(null);
      setPreviewLoading(false);
      setPreviewError("Preview unavailable for this tax bill.");
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
        const kind = resolvePreviewKind(previewBill, blob.type);
        setPreviewState({
          bill: previewBill,
          kind,
          url: objectUrl,
        });
      })
      .catch((error) => {
        if (alive) {
          setPreviewError(error instanceof Error ? error.message : "Failed to load tax bill preview.");
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
  }, [previewBill, token]);

  const hasSelection = Boolean(selectedCode);
  const parcels = taxParcelQuery?.parcels ?? [];
  const warningCount = taxParcelQuery?.warnings.length ?? 0;

  const previewLabel = useMemo(() => {
    if (!previewState) {
      return null;
    }

    return [taxBillTitle(previewState.bill), previewState.kind.toUpperCase(), taxBillMeta(previewState.bill)]
      .filter(Boolean)
      .join(" | ");
  }, [previewState]);

  async function handleOpenBill(bill: TaxBill) {
    try {
      setPanelError(null);
      if (!bill.hasFile) {
        throw new Error("Tax bill file is missing from the configured bill folder.");
      }

      const sourceUrl = bill.contentUrl ?? bill.downloadUrl;
      if (!sourceUrl) {
        throw new Error("Tax bill cannot be opened.");
      }

      const blob = await apiDownload(sourceUrl, token);
      const objectUrl = window.URL.createObjectURL(blob);
      const openedWindow = window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 60_000);

      if (!openedWindow) {
        setPanelError("The browser blocked the tax bill tab.");
      }
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Failed to open tax bill.");
    }
  }

  async function handleDownloadBill(bill: TaxBill) {
    try {
      setPanelError(null);
      if (!bill.hasFile) {
        throw new Error("Tax bill file is missing from the configured bill folder.");
      }
      if (!bill.downloadUrl) {
        throw new Error("Tax bill cannot be downloaded.");
      }

      const blob = await apiDownload(bill.downloadUrl, token);
      const objectUrl = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = objectUrl;
      link.download = bill.filename ?? `tax-bill-${bill.billId}`;
      link.click();
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Failed to download tax bill.");
    }
  }

  function renderPreview() {
    if (previewLoading) {
      return <p className="tax-parcel-preview-placeholder panel-note">Loading preview...</p>;
    }

    if (previewError) {
      return <p className="tax-parcel-error-banner tax-parcel-preview-error">{previewError}</p>;
    }

    if (!previewState) {
      return <p className="tax-parcel-preview-placeholder panel-note">Choose a previewable tax bill PDF or image to inspect it inline.</p>;
    }

    if (previewState.kind === "image") {
      return <img alt={taxBillTitle(previewState.bill)} className="tax-parcel-preview-media" src={previewState.url} />;
    }

    return (
      <iframe
        className="tax-parcel-preview-media tax-parcel-preview-frame"
        src={previewState.url}
        title={previewLabel ?? "Tax bill preview"}
      />
    );
  }

  if (!hasSelection) {
    return (
      <section className="panel-section tax-parcel-empty-shell">
        <div className="section-heading">
          <h2>Tax Parcel Workspace</h2>
          <span>Supporting context</span>
        </div>
        <div className="tax-parcel-empty-state">
          <strong>Select a question area</strong>
          <p>Matched parcels and linked tax bills appear here after a question area is selected on the left.</p>
        </div>
      </section>
    );
  }

  if (selectedCode && isDetailLoading) {
    return (
      <section className="panel-section tax-parcel-loading-shell">
        <div className="section-heading">
          <h2>Tax Parcel Workspace</h2>
          <span>{selectedCode}</span>
        </div>
        <p className="panel-note">Loading the selected question area before tax parcel context can be fetched.</p>
        <div className="tax-parcel-loading-card">
          <div className="skeleton skeleton-heading" />
          <div className="skeleton" style={{ height: "0.8rem", width: "68%" }} />
          <div className="skeleton" style={{ height: "0.8rem", width: "46%" }} />
        </div>
      </section>
    );
  }

  if (selectedCode && !selectedDetail) {
    return (
      <section className="panel-section tax-parcel-loading-shell">
        <div className="section-heading">
          <h2>Tax Parcel Workspace</h2>
          <span>{selectedCode}</span>
        </div>
        <p className="tax-parcel-error-banner">The selected question area could not be loaded.</p>
      </section>
    );
  }

  return (
    <>
      <section className="panel-section tax-parcel-header">
        <div className="section-heading primary-heading">
          <h2>Tax Parcels</h2>
          <span>{selectedDetail?.parcelCode ?? selectedCode}</span>
        </div>
        <p className="tax-parcel-intro">
          Ranked parcel matches are derived from the active question-area point buffer and linked to tax bills by Parcel ID.
        </p>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <h2>Buffer</h2>
          <span>Feet</span>
        </div>
        <div className="tax-parcel-buffer-switch" role="tablist" aria-label="Tax parcel buffer distance">
          {TAX_PARCEL_BUFFER_OPTIONS.map((bufferOption) => (
            <button
              aria-pressed={bufferFeet === bufferOption}
              className={`tax-parcel-buffer-option ${bufferFeet === bufferOption ? "active" : ""}`}
              key={bufferOption}
              onClick={() => onBufferChange(bufferOption)}
              type="button"
            >
              {taxParcelBufferLabel(bufferOption)}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <h2>Match Summary</h2>
          <span>Current buffer</span>
        </div>
        <div className="tax-parcel-summary-grid">
          <SummaryCard label="Parcels" value={taxParcelQuery?.matchedParcelCount ?? 0} />
          <SummaryCard label="Bills" value={taxParcelQuery?.matchedBillCount ?? 0} />
          <SummaryCard label="Warnings" value={warningCount} />
        </div>
      </section>

      {taxParcelError ? <p className="tax-parcel-error-banner">{taxParcelError}</p> : null}
      {panelError ? <p className="tax-parcel-error-banner">{panelError}</p> : null}

      <section className="panel-section">
        <div className="section-heading">
          <h2>Bill Preview</h2>
          <span>{previewState ? taxBillTitle(previewState.bill) : "Inline viewer"}</span>
        </div>
        <div className="tax-parcel-preview-shell">
          {previewState ? (
            <div className="tax-parcel-preview-toolbar">
              <div className="tax-parcel-preview-title">
                <strong>{taxBillTitle(previewState.bill)}</strong>
                <small>{taxBillMeta(previewState.bill) || "Tax bill preview"}</small>
              </div>
              <button
                className="ghost-button"
                onClick={() => {
                  setPreviewBill(null);
                  setPreviewState(null);
                  setPreviewError(null);
                }}
                type="button"
              >
                Close
              </button>
            </div>
          ) : null}
          {renderPreview()}
        </div>
      </section>

      {taxParcelLoading ? (
        <section className="panel-section">
          <div className="tax-parcel-loading-card">
            <div className="skeleton skeleton-heading" />
            <div className="skeleton" style={{ height: "0.8rem", width: "62%" }} />
            <div className="skeleton" style={{ height: "0.8rem", width: "40%" }} />
          </div>
        </section>
      ) : null}

      {!taxParcelLoading && taxParcelQuery?.warnings.length ? (
        <section className="panel-section">
          <div className="section-heading">
            <h2>Warnings</h2>
            <span>{taxParcelQuery.warnings.length}</span>
          </div>
          <div className="tax-parcel-warning-list">
            {taxParcelQuery.warnings.map((warning, index) => (
              <article className="tax-parcel-warning-card" key={`${warning.code ?? "warning"}-${warning.billId ?? index}`}>
                <div className="tax-parcel-warning-copy">
                  <strong>{humanize(warning.code ?? "warning")}</strong>
                  <p>{warning.message ?? "Tax parcel warning."}</p>
                </div>
                <small>{[warning.parcelId, warning.billId].filter(Boolean).join(" | ") || "Tax parcel workspace"}</small>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {!taxParcelLoading && parcels.length === 0 ? (
        <section className="panel-section">
          <p className="empty-state">No tax parcels matched this question area at the current buffer.</p>
        </section>
      ) : null}

      {parcels.map((parcel, index) => {
        const parcelKey = taxParcelKey(parcel, index);
        const isCollapsed = collapsedParcels[parcelKey] ?? false;

        return (
          <section className="panel-section tax-parcel-card" key={parcelKey}>
            <div className="tax-parcel-card-header">
              <div className="section-heading tax-parcel-card-heading">
                <div className="tax-parcel-card-title-group">
                  <h2>{taxParcelTitle(parcel)}</h2>
                  <span>{taxParcelSubtitle(parcel) || "Matched tax parcel"}</span>
                </div>
                <button
                  aria-expanded={!isCollapsed}
                  className="ghost-button tax-parcel-collapse-button"
                  onClick={() =>
                    setCollapsedParcels((current) => ({
                      ...current,
                      [parcelKey]: !isCollapsed,
                    }))
                  }
                  type="button"
                >
                  {isCollapsed ? "Expand" : "Collapse"}
                </button>
              </div>
              <div className="badge-row">
                {parcel.isPrimaryMatch ? <span className="badge tax-parcel-primary-badge">Primary match</span> : null}
                {parcel.parcelStatus ? <span className="badge neutral">{parcel.parcelStatus}</span> : null}
                {parcel.taxProgram ? <span className="badge neutral">{parcel.taxProgram}</span> : null}
              </div>
            </div>

            {!isCollapsed ? (
              <>
                <dl className="detail-grid tax-parcel-detail-grid">
                  <TaxParcelDetail label="Parcel ID" mono>{parcel.parcelId ?? "None"}</TaxParcelDetail>
                  <TaxParcelDetail label="Account" mono>{parcel.accountNumber ?? "None"}</TaxParcelDetail>
                  <TaxParcelDetail label="Owner">{parcel.ownerName ?? "None"}</TaxParcelDetail>
                  <TaxParcelDetail label="Property">{parcel.propertyName ?? "None"}</TaxParcelDetail>
                  <TaxParcelDetail label="County">{parcel.county ?? "None"}</TaxParcelDetail>
                  <TaxParcelDetail label="State">{parcel.state ?? "None"}</TaxParcelDetail>
                  <TaxParcelDetail label="GIS Acres" mono>{formatMetric(parcel.gisAcres)}</TaxParcelDetail>
                  <TaxParcelDetail label="Land Use">{parcel.landUseType ?? "None"}</TaxParcelDetail>
                  <TaxParcelDetail label="Ownership">{parcel.ownershipType ?? "None"}</TaxParcelDetail>
                  <TaxParcelDetail label="Tract">{parcel.tractName ?? "None"}</TaxParcelDetail>
                  <TaxParcelDetail label="Overlap">{taxParcelAreaLabel(parcel.overlapAreaSqMeters)}</TaxParcelDetail>
                  <TaxParcelDetail label="Point Distance">{taxParcelDistanceLabel(parcel.pointDistanceMeters)}</TaxParcelDetail>
                </dl>

                {parcel.description ? (
                  <p className="tax-parcel-note-card">
                    <strong>Description</strong>
                    <span>{parcel.description}</span>
                  </p>
                ) : null}

                {parcel.notes ? (
                  <p className="tax-parcel-note-card tax-parcel-note-card-secondary">
                    <strong>Notes</strong>
                    <span>{parcel.notes}</span>
                  </p>
                ) : null}

                <div className="section-heading tax-parcel-bills-heading">
                  <h3>Tax Bills</h3>
                  <span>{parcel.bills.length}</span>
                </div>

                {parcel.bills.length > 0 ? (
                  <div className="tax-parcel-bill-list">
                    {parcel.bills.map((bill) => (
                      <article className="tax-parcel-bill-card" key={bill.billId}>
                        <div className="tax-parcel-bill-copy">
                          <div className="tax-parcel-bill-badges">
                            {bill.year ? <span className="badge neutral">{bill.year}</span> : null}
                            {!bill.hasFile ? <span className="badge warning">Missing file</span> : null}
                            {bill.hasFile && !isTaxBillPreviewable(bill) ? (
                              <span className="badge warning">No inline preview</span>
                            ) : null}
                          </div>
                          <strong>{taxBillTitle(bill)}</strong>
                          <span>{taxBillMeta(bill) || "Tax bill file"}</span>
                        </div>
                        <div className="tax-parcel-bill-actions">
                          {bill.hasFile && isTaxBillPreviewable(bill) ? (
                            <button
                              className="ghost-button"
                              onClick={() => {
                                setPanelError(null);
                                setPreviewBill(bill);
                                setPreviewError(null);
                              }}
                              type="button"
                            >
                              Preview
                            </button>
                          ) : null}
                          <button
                            className="ghost-button"
                            disabled={!bill.hasFile}
                            onClick={() => void handleOpenBill(bill)}
                            type="button"
                          >
                            Open
                          </button>
                          <button
                            className="primary-button"
                            disabled={!bill.hasFile}
                            onClick={() => void handleDownloadBill(bill)}
                            type="button"
                          >
                            Download
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="panel-note">No linked tax bills were found for this parcel.</p>
                )}
              </>
            ) : null}
          </section>
        );
      })}
    </>
  );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="tax-parcel-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TaxParcelDetail({
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

function resolvePreviewKind(bill: TaxBill, mimeType: string | null) {
  const extension = bill.extension?.trim().replace(/^\./, "").toLowerCase() ?? "";
  const type = mimeType?.toLowerCase() ?? "";

  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"].includes(extension)) {
    return "image" as const;
  }

  if (type === "application/pdf" || extension === "pdf") {
    return "pdf" as const;
  }

  return "other" as const;
}

function humanize(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatMetric(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "None";
  }

  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}
