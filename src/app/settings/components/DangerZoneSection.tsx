"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { MessageBanner, SpinnerIcon } from "./shared";

interface Props {
  onAccountDeleted: () => void;
}

interface ResignablePosition {
  id: string;
  label: string;
  category: string;
}

export function DangerZoneSection({ onAccountDeleted }: Props) {
  const t = useTranslations("settings");
  // ── Resign All ──────────────────────────────────────────────────────────────
  const [showResignConfirm, setShowResignConfirm] = useState(false);
  const [resigning, setResigning] = useState(false);
  const [resignResult, setResignResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [positions, setPositions] = useState<ResignablePosition[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(true);
  const [showSpecificPositions, setShowSpecificPositions] = useState(false);
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const [showSpecificConfirm, setShowSpecificConfirm] = useState(false);
  const [resigningSpecific, setResigningSpecific] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadPositions = async () => {
      try {
        const res = await fetch("/api/settings/resignable-positions");
        if (!res.ok) return;
        const data = (await res.json()) as { positions?: ResignablePosition[] };
        if (!cancelled) setPositions(data.positions ?? []);
      } catch {
        // The all-positions action remains available if this inventory read fails.
      } finally {
        if (!cancelled) setPositionsLoading(false);
      }
    };
    void loadPositions();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleResignAll = async () => {
    setResigning(true);
    setResignResult(null);
    try {
      const res = await fetch("/api/settings/resign-all", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setResignResult({ ok: true, text: data.message });
        setShowResignConfirm(false);
        setPositions([]);
        setSelectedPositionId("");
        setShowSpecificConfirm(false);
      } else {
        setResignResult({ ok: false, text: data.error || t("danger.resignFailed") });
      }
    } catch {
      setResignResult({ ok: false, text: t("common.networkErrorRetry") });
    } finally {
      setResigning(false);
    }
  };

  const selectedPosition = positions.find((position) => position.id === selectedPositionId);

  const handleResignSpecific = async () => {
    if (!selectedPosition) return;
    setResigningSpecific(true);
    setResignResult(null);
    try {
      const res = await fetch("/api/settings/resign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId: selectedPosition.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setResignResult({ ok: true, text: data.message });
        setPositions((current) =>
          current.filter((position) => position.id !== selectedPosition.id)
        );
        setSelectedPositionId("");
        setShowSpecificConfirm(false);
      } else {
        setResignResult({ ok: false, text: data.error || t("danger.resignFailed") });
      }
    } catch {
      setResignResult({ ok: false, text: t("common.networkErrorRetry") });
    } finally {
      setResigningSpecific(false);
    }
  };

  // ── Delete Account ──────────────────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteShake, setDeleteShake] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  // Set up portal container on mount
  useEffect(() => {
    setPortalContainer(document.body);
  }, []);

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== "DELETE") {
      setDeleteError(t("danger.typeDeleteError"));
      return;
    }
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch("/api/auth/delete-account", { method: "DELETE" });
      if (res.ok) {
        onAccountDeleted();
      } else {
        const data = await res.json();
        setDeleteError(data.error || t("danger.deleteFailed"));
      }
    } catch {
      setDeleteError(t("common.networkErrorRetry"));
    } finally {
      setDeleting(false);
    }
  };

  const closeDeleteDialog = () => {
    if (deleting) return;
    setShowDeleteConfirm(false);
    setDeleteConfirmText("");
    setDeleteError("");
  };

  return (
    <>
      {/* ── Resign Positions ─────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h4 className="text-sm font-semibold text-foreground mb-1">{t("danger.resignTitle")}</h4>
        <p className="text-sm text-muted mb-4">{t("danger.resignDesc")}</p>
        {resignResult && (
          <div className="mb-4">
            <MessageBanner
              ok={resignResult.ok}
              text={resignResult.text}
              onDismiss={() => setResignResult(null)}
            />
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          {!showResignConfirm && (
            <button
              onClick={() => setShowResignConfirm(true)}
              className="rounded-xl border border-warning/50 bg-warning/10 px-4 py-2.5 text-sm font-medium text-warning transition-colors hover:bg-warning/20"
            >
              {t("danger.resignTitle")}
            </button>
          )}
          {!showSpecificPositions && (
            <button
              onClick={() => setShowSpecificPositions(true)}
              className="rounded-xl border border-card-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-card-elevated"
            >
              {t("danger.resignSpecificTitle")}
            </button>
          )}
        </div>

        {showResignConfirm && (
          <div className="rounded-xl border border-warning/40 bg-warning/5 p-4">
            <p className="text-sm text-foreground mb-3">
              {t.rich("danger.resignPrompt", {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleResignAll}
                disabled={resigning}
                className="rounded-xl bg-warning px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-warning/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {resigning && <SpinnerIcon />}
                {resigning ? t("danger.resigning") : t("danger.confirmResign")}
              </button>
              <button
                onClick={() => setShowResignConfirm(false)}
                disabled={resigning}
                className="rounded-xl border border-card-border px-4 py-2.5 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        )}

        {showSpecificPositions && (
          <div className="mt-4 rounded-xl border border-card-border bg-background/40 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-sm font-medium text-foreground">
                {t("danger.resignSpecificTitle")}
              </p>
              <button
                type="button"
                onClick={() => {
                  setShowSpecificPositions(false);
                  setShowSpecificConfirm(false);
                }}
                className="text-xs text-muted transition-colors hover:text-foreground"
              >
                {t("common.cancel")}
              </button>
            </div>
            {positionsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted">
                <SpinnerIcon />
                {t("danger.loadingPositions")}
              </div>
            ) : positions.length === 0 ? (
              <p className="text-sm text-muted">{t("danger.noPositions")}</p>
            ) : (
              <>
                <select
                  value={selectedPositionId}
                  onChange={(event) => {
                    setSelectedPositionId(event.target.value);
                    setShowSpecificConfirm(false);
                  }}
                  className="w-full rounded-xl border border-card-border bg-background px-4 py-2.5 text-sm text-foreground focus:border-warning focus:outline-none focus:ring-1 focus:ring-warning/30"
                  aria-label={t("danger.resignSpecificTitle")}
                >
                  <option value="">{t("danger.selectPosition")}</option>
                  {positions.map((position) => (
                    <option key={position.id} value={position.id}>
                      {position.label}
                    </option>
                  ))}
                </select>
                {selectedPosition && !showSpecificConfirm && (
                  <button
                    type="button"
                    onClick={() => setShowSpecificConfirm(true)}
                    className="mt-3 rounded-xl border border-warning/50 bg-warning/10 px-4 py-2.5 text-sm font-medium text-warning transition-colors hover:bg-warning/20"
                  >
                    {t("danger.resignSelected")}
                  </button>
                )}
                {selectedPosition && showSpecificConfirm && (
                  <div className="mt-3 rounded-xl border border-warning/40 bg-warning/5 p-3">
                    <p className="text-sm text-foreground mb-3">
                      {t("danger.resignSpecificPrompt", { position: selectedPosition.label })}
                    </p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={handleResignSpecific}
                        disabled={resigningSpecific}
                        className="rounded-xl bg-warning px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-warning/90 disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-2"
                      >
                        {resigningSpecific && <SpinnerIcon />}
                        {resigningSpecific
                          ? t("danger.resigning")
                          : t("danger.confirmResignSpecific")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowSpecificConfirm(false)}
                        disabled={resigningSpecific}
                        className="rounded-xl border border-card-border px-4 py-2.5 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-50"
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Divider ──────────────────────────────────────────────────────────── */}
      <hr className="border-card-border mb-8" />

      {/* ── Delete Account ───────────────────────────────────────────────────── */}
      <h4 className="text-sm font-semibold text-foreground mb-1">{t("danger.deleteTitle")}</h4>
      <p className="text-sm text-muted mb-6">{t("danger.deleteDesc")}</p>
      <button
        onClick={() => setShowDeleteConfirm(true)}
        className="rounded-xl border border-error/50 bg-error/10 px-4 py-2.5 text-sm font-medium text-error transition-colors hover:bg-error/20"
      >
        {t("danger.deleteButton")}
      </button>

      {showDeleteConfirm &&
        portalContainer &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={closeDeleteDialog}
              aria-hidden="true"
            />
            <div className="relative w-full max-w-md rounded-2xl border-2 border-error/40 bg-card p-6 shadow-modal animate-[fadeIn_0.15s_ease_forwards]">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-error/15 shrink-0">
                  <svg
                    className="h-5 w-5 text-error"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <h3 id="delete-dialog-title" className="text-base font-bold text-error">
                  {t("danger.deleteTitle")}
                </h3>
              </div>
              <p className="text-sm text-muted mb-4">
                {t.rich("danger.modalWarning", {
                  strong: (chunks) => <strong className="text-foreground">{chunks}</strong>,
                })}
              </p>
              <p className="mb-3 text-sm text-foreground">
                {t.rich("danger.typeToConfirm", {
                  code: (chunks) => (
                    <span className="font-bold font-mono bg-error/10 px-1.5 py-0.5 rounded text-error">
                      {chunks}
                    </span>
                  ),
                })}
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => {
                  setDeleteConfirmText(e.target.value);
                  if (e.target.value.length === 6 && e.target.value !== "DELETE") {
                    setDeleteShake(true);
                    setTimeout(() => setDeleteShake(false), 400);
                  }
                }}
                placeholder={t("danger.deletePlaceholder")}
                className={`w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-all bg-background ${
                  deleteConfirmText === "DELETE"
                    ? "border-success/60 ring-2 ring-success/20 focus:ring-success/30"
                    : deleteShake
                      ? "border-error/60 animate-[shake_0.4s_ease]"
                      : "border-error/50 focus:border-error focus:ring-1 focus:ring-error/30"
                }`}
                disabled={deleting}
              />
              {deleteError && (
                <div className="mt-3">
                  <MessageBanner
                    ok={false}
                    text={deleteError}
                    onDismiss={() => setDeleteError("")}
                  />
                </div>
              )}
              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleting || deleteConfirmText !== "DELETE"}
                  className="rounded-xl bg-error px-4 py-2.5 font-medium text-white transition-colors hover:bg-error/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {deleting && <SpinnerIcon />}
                  {deleting ? t("danger.deleting") : t("danger.permanentlyDelete")}
                </button>
                <button
                  onClick={closeDeleteDialog}
                  disabled={deleting}
                  className="rounded-xl border border-card-border px-4 py-2.5 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-50"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          </div>,
          portalContainer
        )}
    </>
  );
}
