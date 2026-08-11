"use client";

import {
  STATUS_COLORS,
  STATUS_OPTIONS,
  priorityColor,
  type FeedbackDetail as FeedbackDetailType,
} from "./types";

interface FeedbackDetailProps {
  detail: FeedbackDetailType | null;
  detailLoading: boolean;
  selectedId: string | null;
  newStatus: string;
  adminNotes: string;
  updating: boolean;
  updateMessage: string;
  screenshotExpanded: boolean;
  onClose: () => void;
  onStatusChange: (status: string) => void;
  onAdminNotesChange: (notes: string) => void;
  onUpdateStatus: () => void;
  onToggleScreenshot: () => void;
}

/** Inner content shared between desktop panel and mobile drawer. */
function DetailContent({
  detail,
  detailLoading,
  newStatus,
  adminNotes,
  updating,
  updateMessage,
  screenshotExpanded,
  onStatusChange,
  onAdminNotesChange,
  onUpdateStatus,
  onToggleScreenshot,
  isMobile = false,
}: Omit<FeedbackDetailProps, "selectedId" | "onClose"> & { isMobile?: boolean }) {
  if (detailLoading) {
    return <div className="py-12 text-center text-muted">Loading…</div>;
  }

  if (!detail) {
    return isMobile ? null : (
      <div className="py-12 text-center text-muted">Select an issue to view details</div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted">#{detail.issueNumber}</p>
          <h3 className="mt-0.5 font-semibold text-base leading-snug">{detail.title}</h3>
          <p className="mt-1 text-xs text-muted capitalize">
            <span className={detail.type === "bug" ? "text-amber-400" : "text-primary"}>
              {detail.type}
            </span>
            {" · "}
            {detail.category.replace(/_/g, " ")}
            {" · "}
            {detail.reporterUsername ?? "Anonymous"}
          </p>
          {/* Priority/Severity badge */}
          {(detail.severity != null || detail.priority != null) && (
            <p
              className={`mt-1 text-xs font-medium ${priorityColor(detail.severity ?? detail.priority)}`}
            >
              {detail.type === "bug"
                ? `Severity ${detail.severity}/5`
                : `Priority ${detail.priority}/5`}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={`rounded px-2 py-1 text-xs ${STATUS_COLORS[detail.status] ?? ""}`}>
            {detail.status.replace(/_/g, " ")}
          </span>
          {detail.githubIssueUrl && (
            <a
              href={detail.githubIssueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              GitHub
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="text-sm">
        <p className="font-medium text-muted mb-1">Description</p>
        <p className="whitespace-pre-wrap">{detail.description}</p>
      </div>

      {detail.stepsToReproduce && (
        <div className="text-sm">
          <p className="font-medium text-muted mb-1">Steps to reproduce</p>
          <p className="whitespace-pre-wrap">{detail.stepsToReproduce}</p>
        </div>
      )}

      {detail.impact && (
        <div className="text-sm">
          <p className="font-medium text-muted mb-1">Impact</p>
          <p className="whitespace-pre-wrap">{detail.impact}</p>
        </div>
      )}

      {/* Screenshot */}
      {detail.screenshotUrl &&
        (isMobile ? (
          <div className="rounded-lg border border-card-border bg-background/50 overflow-hidden">
            <a
              href={detail.screenshotUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block p-2 text-xs text-primary hover:underline"
            >
              View screenshot
            </a>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={detail.screenshotUrl}
              alt="Issue screenshot"
              className="w-full rounded object-contain max-h-48"
            />
          </div>
        ) : (
          <div className="rounded-lg border border-card-border bg-background/50 overflow-hidden">
            <button
              type="button"
              onClick={onToggleScreenshot}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm"
            >
              <span className="font-medium text-muted flex items-center gap-1.5">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                Screenshot
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={detail.screenshotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs text-primary hover:underline"
                >
                  Open
                </a>
                <svg
                  className={`h-4 w-4 text-muted transition-transform ${screenshotExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </button>
            {screenshotExpanded && (
              <div className="border-t border-card-border p-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- external blob URL */}
                <img
                  src={detail.screenshotUrl}
                  alt="Issue screenshot"
                  className="w-full rounded object-contain max-h-64"
                />
              </div>
            )}
          </div>
        ))}

      {/* Context */}
      <div className="rounded-lg border border-card-border bg-background/50 p-3 text-xs text-muted space-y-1">
        <p>
          <span className="font-medium text-foreground/80">Page:</span>{" "}
          {detail.context?.pathname ?? "—"}
        </p>
        {!isMobile && (
          <p>
            <span className="font-medium text-foreground/80">URL:</span>{" "}
            {detail.context?.url ?? "—"}
          </p>
        )}
        <p>
          <span className="font-medium text-foreground/80">Viewport:</span>{" "}
          {detail.context?.viewport?.width ?? 0} × {detail.context?.viewport?.height ?? 0}
        </p>
        {!isMobile && detail.context?.lastAction && (
          <p>
            <span className="font-medium text-foreground/80">Last action:</span>{" "}
            {detail.context.lastAction.label}
          </p>
        )}
      </div>

      {/* Admin actions */}
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Status</label>
        <select
          value={newStatus}
          onChange={(e) => onStatusChange(e.target.value)}
          className={`w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm${isMobile ? " min-h-[44px]" : ""}`}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-muted mb-1">
          Admin notes{isMobile ? "" : " (internal)"}
        </label>
        <textarea
          value={adminNotes}
          onChange={(e) => onAdminNotesChange(e.target.value)}
          placeholder="Internal notes…"
          rows={3}
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm resize-none"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onUpdateStatus}
          disabled={updating}
          className={`rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50${isMobile ? " min-h-[44px]" : ""}`}
        >
          {updating ? "Updating…" : "Update"}
        </button>
        {updateMessage && (
          <span
            className={`text-sm ${updateMessage.startsWith("✓") ? "text-green-500" : "text-red-400"}`}
          >
            {updateMessage}
          </span>
        )}
      </div>

      <p className="text-xs text-muted">
        Created {new Date(detail.createdAt).toLocaleString("en-US")}
        {!isMobile &&
          detail.statusChangedAt &&
          ` · Status changed ${new Date(detail.statusChangedAt).toLocaleString("en-US")}`}
      </p>
    </>
  );
}

export function FeedbackDetail({
  detail,
  detailLoading,
  selectedId,
  newStatus,
  adminNotes,
  updating,
  updateMessage,
  screenshotExpanded,
  onClose,
  onStatusChange,
  onAdminNotesChange,
  onUpdateStatus,
  onToggleScreenshot,
}: FeedbackDetailProps) {
  const contentProps = {
    detail,
    detailLoading,
    newStatus,
    adminNotes,
    updating,
    updateMessage,
    screenshotExpanded,
    onStatusChange,
    onAdminNotesChange,
    onUpdateStatus,
    onToggleScreenshot,
  };

  return (
    <>
      {/* Desktop: side panel in grid */}
      <div className="hidden xl:block rounded-xl border border-card-border bg-card p-5 space-y-4 overflow-y-auto max-h-[700px] shadow-sm">
        <DetailContent {...contentProps} />
      </div>

      {/* Mobile: slide-over drawer when issue selected */}
      {selectedId && (
        <div className="xl:hidden fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute inset-0 bg-black/50 transition-opacity"
          />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-[min(100%,28rem)] bg-card border-l border-card-border shadow-modal overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-card-border bg-card px-4 py-3">
              <span className="font-medium">Issue #{selectedId}</span>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-background/50"
                aria-label="Close"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <DetailContent {...contentProps} isMobile />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
