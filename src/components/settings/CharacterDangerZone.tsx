"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { SpinnerIcon, MessageBanner } from "@/app/settings/components/shared";

interface Props {
  characterName: string;
}

export function CharacterDangerZone({ characterName }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState("");
  const [retiring, setRetiring] = useState(false);
  const [shake, setShake] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalContainer(document.body);
  }, []);

  const handleRetire = async () => {
    if (confirmText !== characterName) {
      setError("Please type your character name exactly to confirm");
      return;
    }
    setRetiring(true);
    setError("");
    try {
      const res = await fetch("/api/auth/retire-character", { method: "POST" });
      if (res.ok) {
        // Redirect to settings and force a full page refresh so user state updates
        window.location.href = "/settings";
      } else {
        const data = await res.json();
        setError(data.error || "Failed to retire character");
      }
    } catch {
      setError("Network error - please try again");
    } finally {
      setRetiring(false);
    }
  };

  const closeDialog = () => {
    if (retiring) return;
    setShowConfirm(false);
    setConfirmText("");
    setError("");
  };

  return (
    <>
      <h4 className="text-sm font-semibold text-foreground mb-1">Retire Character</h4>
      <p className="text-sm text-muted mb-2">
        Retiring your character preserves their record in your account history. You will be able to
        create a new character afterward. This action cannot be undone.
      </p>
      <p className="text-sm text-muted mb-6">
        Your character&apos;s achievements, career history, and stats will be saved as a snapshot in
        your retired characters archive.
      </p>
      <button
        onClick={() => setShowConfirm(true)}
        className="rounded-xl border border-error/50 bg-error/10 px-4 py-2.5 text-sm font-medium text-error transition-colors hover:bg-error/20"
      >
        Retire Character
      </button>

      {showConfirm &&
        portalContainer &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="retire-dialog-title"
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={closeDialog}
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
                <h3 id="retire-dialog-title" className="text-base font-bold text-error">
                  Retire Character
                </h3>
              </div>
              <p className="text-sm text-muted mb-4">
                This will <strong className="text-foreground">permanently retire</strong> your
                character. Their record will be preserved in your account, but you will no longer be
                able to play as them.
              </p>
              <p className="mb-3 text-sm text-foreground">
                Type{" "}
                <span className="font-bold font-mono bg-error/10 px-1.5 py-0.5 rounded text-error">
                  {characterName}
                </span>{" "}
                to confirm:
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => {
                  setConfirmText(e.target.value);
                  if (
                    e.target.value.length === characterName.length &&
                    e.target.value !== characterName
                  ) {
                    setShake(true);
                    setTimeout(() => setShake(false), 400);
                  }
                }}
                placeholder={`Type ${characterName} to confirm`}
                className={`w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-all bg-background ${
                  confirmText === characterName
                    ? "border-success/60 ring-2 ring-success/20 focus:ring-success/30"
                    : shake
                      ? "border-error/60 animate-[shake_0.4s_ease]"
                      : "border-error/50 focus:border-error focus:ring-1 focus:ring-error/30"
                }`}
                disabled={retiring}
              />
              {error && (
                <div className="mt-3">
                  <MessageBanner ok={false} text={error} onDismiss={() => setError("")} />
                </div>
              )}
              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleRetire}
                  disabled={retiring || confirmText !== characterName}
                  className="rounded-xl bg-error px-4 py-2.5 font-medium text-white transition-colors hover:bg-error/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {retiring && <SpinnerIcon />}
                  {retiring ? "Retiring..." : "Confirm Retirement"}
                </button>
                <button
                  onClick={closeDialog}
                  disabled={retiring}
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
