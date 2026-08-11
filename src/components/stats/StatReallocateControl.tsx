"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { StatPointAllocator, defaultStatBuild, pointsRemaining } from "./StatPointAllocator";
import type { CharacterStats } from "@/lib/stats/statsConstants";

/**
 * Own-profile control for spending the single free stat reallocation. Opens a
 * modal reusing the SPECIAL-style allocator; confirming does a full reset of the
 * stat block (rewrites the spread, clears earned growth). Render only when the
 * character is eligible (flag on, already allocated, free change unused).
 */
export function StatReallocateControl() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<CharacterStats>(defaultStatBuild());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const remaining = pointsRemaining(stats);

  const openModal = () => {
    setStats(defaultStatBuild());
    setError("");
    setOpen(true);
  };

  const submit = async () => {
    if (remaining !== 0 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/character/reallocate-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stats }),
        credentials: "same-origin",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to reallocate your stats. Please try again.");
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reallocate your stats.");
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-1.5 rounded-md border border-card-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary/40 hover:text-primary"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        Reallocate <span className="text-[10px] opacity-70">(1 free)</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto p-4 py-8"
          role="dialog"
          aria-modal
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => !submitting && setOpen(false)}
            className="absolute inset-0 backdrop-blur-[2px]"
            style={{ background: "var(--modal-backdrop)" }}
          />
          <div className="relative z-10 w-full max-w-lg rounded-xl border border-card-border bg-card shadow-2xl">
            <div className="relative px-5 pt-5 pb-4">
              <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary/50 via-secondary/30 to-transparent" />
              <h2 className="text-lg font-semibold text-foreground">Reallocate Your Stats</h2>
              <p className="mt-1 text-xs text-muted">
                This is your <span className="font-semibold text-foreground">one free change</span>.
                It rewrites your stat sheet from scratch and{" "}
                <span className="font-semibold text-foreground">resets any growth</span> you&apos;ve
                earned through play. This can&apos;t be undone.
              </p>
            </div>

            <div className="px-5 pb-5">
              <StatPointAllocator value={stats} onChange={setStats} />

              {error && (
                <p className="mt-3 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
                  {error}
                </p>
              )}

              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                  className="text-xs text-muted transition-colors hover:text-foreground disabled:opacity-50"
                >
                  Cancel
                </button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={submit}
                  disabled={remaining !== 0}
                  isLoading={submitting}
                  className="min-w-[160px]"
                >
                  {remaining === 0 ? "Confirm Reallocation" : `${remaining} points left`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
