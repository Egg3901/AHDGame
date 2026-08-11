"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { MessageBanner, SpinnerIcon } from "./shared";

interface Props {
  onAccountDeleted: () => void;
}

export function DangerZoneSection({ onAccountDeleted }: Props) {
  // ── Resign All ──────────────────────────────────────────────────────────────
  const [showResignConfirm, setShowResignConfirm] = useState(false);
  const [resigning, setResigning] = useState(false);
  const [resignResult, setResignResult] = useState<{ ok: boolean; text: string } | null>(null);

  const handleResignAll = async () => {
    setResigning(true);
    setResignResult(null);
    try {
      const res = await fetch("/api/settings/resign-all", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setResignResult({ ok: true, text: data.message });
        setShowResignConfirm(false);
      } else {
        setResignResult({ ok: false, text: data.error || "Failed to resign" });
      }
    } catch {
      setResignResult({ ok: false, text: "Network error - please try again" });
    } finally {
      setResigning(false);
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
      setDeleteError("Please type DELETE to confirm");
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
        setDeleteError(data.error || "Failed to delete account");
      }
    } catch {
      setDeleteError("Network error - please try again");
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
      {/* ── Resign All Positions ─────────────────────────────────────────────── */}
      <div className="mb-8">
        <h4 className="text-sm font-semibold text-foreground mb-1">Resign All Positions</h4>
        <p className="text-sm text-muted mb-4">
          Vacate your current office, all party leadership roles, congress leadership, and withdraw
          from any active elections.
        </p>
        {resignResult && (
          <div className="mb-4">
            <MessageBanner
              ok={resignResult.ok}
              text={resignResult.text}
              onDismiss={() => setResignResult(null)}
            />
          </div>
        )}
        {!showResignConfirm ? (
          <button
            onClick={() => setShowResignConfirm(true)}
            className="rounded-xl border border-warning/50 bg-warning/10 px-4 py-2.5 text-sm font-medium text-warning transition-colors hover:bg-warning/20"
          >
            Resign All Positions
          </button>
        ) : (
          <div className="rounded-xl border border-warning/40 bg-warning/5 p-4">
            <p className="text-sm text-foreground mb-3">
              Are you sure? This will immediately vacate <strong>all</strong> your held positions
              and withdraw you from all active elections.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleResignAll}
                disabled={resigning}
                className="rounded-xl bg-warning px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-warning/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {resigning && <SpinnerIcon />}
                {resigning ? "Resigning…" : "Confirm Resign All"}
              </button>
              <button
                onClick={() => setShowResignConfirm(false)}
                disabled={resigning}
                className="rounded-xl border border-card-border px-4 py-2.5 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Divider ──────────────────────────────────────────────────────────── */}
      <hr className="border-card-border mb-8" />

      {/* ── Delete Account ───────────────────────────────────────────────────── */}
      <h4 className="text-sm font-semibold text-foreground mb-1">Delete Account</h4>
      <p className="text-sm text-muted mb-6">
        This action is irreversible. Your account, character, and all data will be permanently
        deleted.
      </p>
      <button
        onClick={() => setShowDeleteConfirm(true)}
        className="rounded-xl border border-error/50 bg-error/10 px-4 py-2.5 text-sm font-medium text-error transition-colors hover:bg-error/20"
      >
        Delete My Account
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
                  Delete Account
                </h3>
              </div>
              <p className="text-sm text-muted mb-4">
                This action is{" "}
                <strong className="text-foreground">permanent and irreversible</strong>. Your
                account, character, and all data will be permanently deleted.
              </p>
              <p className="mb-3 text-sm text-foreground">
                Type{" "}
                <span className="font-bold font-mono bg-error/10 px-1.5 py-0.5 rounded text-error">
                  DELETE
                </span>{" "}
                to confirm:
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
                placeholder="Type DELETE to confirm"
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
                  {deleting ? "Deleting…" : "Permanently Delete"}
                </button>
                <button
                  onClick={closeDeleteDialog}
                  disabled={deleting}
                  className="rounded-xl border border-card-border px-4 py-2.5 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          portalContainer
        )}
    </>
  );
}
