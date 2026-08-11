"use client";

import { useEffect, useState } from "react";
import { useAuthMe } from "@/contexts/AuthDataContext";
import { fetchJson } from "@/lib/observability/fetchJson";
import { Button } from "@/components/ui";
import { StatPointAllocator, defaultStatBuild, pointsRemaining } from "./StatPointAllocator";
import type { CharacterStats } from "@/lib/stats/statsConstants";

/**
 * Global blocking gate for grandfathered characters. When the active character
 * predates the stat system (`needsStatAllocation`), this overlays a one-time
 * allocation modal pre-filled with a career-derived suggested build. Players
 * may either confirm a legal 28-point spread or dismiss to allocate later —
 * dismissing surfaces a persistent "return to stats" banner on the profile.
 */
export function StatAllocationGate() {
  const { user, refetch } = useAuthMe();
  const needs = !!user?.character?.needsStatAllocation;

  const [stats, setStats] = useState<CharacterStats>(defaultStatBuild());
  const [loadingSuggestion, setLoadingSuggestion] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!needs) return;
    let active = true;
    setLoadingSuggestion(true);
    fetchJson<{ suggestion?: CharacterStats }>("/api/character/allocate-stats", {
      credentials: "same-origin",
      cache: "no-store",
      feature: "stat-allocation-suggestion",
    })
      .then((d) => {
        if (active && d?.suggestion) setStats(d.suggestion);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingSuggestion(false);
      });
    return () => {
      active = false;
    };
  }, [needs]);

  if (!needs || done) return null;

  const remaining = pointsRemaining(stats);

  const submit = async () => {
    if (remaining !== 0 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/character/allocate-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stats }),
        credentials: "same-origin",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to save your stats. Please try again.");
      }
      setDone(true);
      refetch(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save your stats.");
      setSubmitting(false);
    }
  };

  const dismiss = async () => {
    if (dismissing || submitting) return;
    setDismissing(true);
    setError("");
    try {
      const res = await fetch("/api/character/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statAllocationDismissed: true }),
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Failed to dismiss. Please try again.");
      setDone(true);
      refetch(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to dismiss.");
      setDismissing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto p-4 py-8"
      role="dialog"
      aria-modal
    >
      <div
        className="absolute inset-0 backdrop-blur-[2px]"
        style={{ background: "var(--modal-backdrop)" }}
      />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-card-border bg-card shadow-2xl">
        <div className="relative px-5 pt-5 pb-4">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary/50 via-secondary/30 to-transparent" />
          <h2 className="text-lg font-semibold text-foreground">Allocate Your Stats</h2>
          <p className="mt-1 text-xs text-muted">
            Your politician has earned a stat sheet. We&apos;ve suggested a build from your career —
            rearrange it however you like, then lock it in. This is a one-time choice.
          </p>
        </div>

        <div className="px-5 pb-5">
          {loadingSuggestion ? (
            <div className="flex items-center justify-center py-10">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <>
              <StatPointAllocator value={stats} onChange={setStats} />

              {error && (
                <p className="mt-3 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
                  {error}
                </p>
              )}

              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={dismiss}
                  disabled={dismissing || submitting}
                  className="text-xs text-muted transition-colors hover:text-foreground disabled:opacity-50"
                >
                  {dismissing ? "Dismissing…" : "Maybe later"}
                </button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={submit}
                  disabled={remaining !== 0}
                  isLoading={submitting}
                  className="min-w-[160px]"
                >
                  {remaining === 0 ? "Lock In Stats" : `${remaining} points left`}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
