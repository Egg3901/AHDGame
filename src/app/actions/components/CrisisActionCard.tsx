"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useToast } from "@/contexts/ToastContext";
import type { Crisis, CrisisInteraction, CrisisDecisionNode } from "@/lib/db/types/crisis";

interface ActiveCrisisData {
  crisis: Crisis;
  interaction: CrisisInteraction | null;
  currentNode: CrisisDecisionNode | null;
  canInteract: boolean;
  timeRemainingMinutes: number | null;
  hasContributed: boolean;
  /**
   * Per-option campaign eligibility for global-response crises, as the crisis
   * detail page receives it. Null for crises that carry no such requirements.
   */
  optionAvailability?: Record<string, { eligible: boolean; reasons: string[] }> | null;
}

function formatTimeRemaining(minutes: number): string {
  if (minutes <= 0) return "Expired";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function crisisSeverity(crisis: Crisis): "low" | "medium" | "high" {
  const tickMagnitude = crisis.effects
    .filter((e) => e.effectType === "tick")
    .reduce((sum, e) => sum + Math.abs(e.value), 0);
  if (tickMagnitude >= 1.0) return "high";
  if (tickMagnitude >= 0.2) return "medium";
  return "low";
}

const SEVERITY_STYLES: Record<string, { border: string; bg: string; badge: string }> = {
  high: {
    border: "border-rose-500/40",
    bg: "bg-rose-500/5",
    badge: "border-rose-500/30 bg-rose-500/10 text-rose-500",
  },
  medium: {
    border: "border-amber-500/40",
    bg: "bg-amber-500/5",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  },
  low: {
    border: "border-zinc-400/30",
    bg: "bg-zinc-400/5",
    badge: "border-zinc-400/30 bg-zinc-400/10 text-zinc-400",
  },
};

const DISMISSED_CRISIS_IDS_KEY = "ahd:dismissedCrisisIds";

function readDismissedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISSED_CRISIS_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.map((id) => String(id)));
  } catch {
    // Ignore corrupted storage
  }
  return new Set();
}

function writeDismissedIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISSED_CRISIS_IDS_KEY, JSON.stringify([...ids]));
  } catch {
    // Ignore storage errors
  }
}

export default function CrisisActionCard() {
  const [crises, setCrises] = useState<ActiveCrisisData[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  // Keyed by crisis: one refusal must not print under every open crisis.
  const [error, setError] = useState<{ crisisId: string; message: string } | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const { showToast } = useToast();

  // Load dismissed crisis IDs from localStorage on mount.
  useEffect(() => {
    setDismissedIds(readDismissedIds());
  }, []);

  // The /active-for-character API gates on the feature flag server-side and
  // returns an empty list when crisis interactions are disabled, so the card
  // simply renders nothing in that case (see the `crises.length === 0` guard).
  const fetchCrises = useCallback(async () => {
    try {
      const res = await fetch("/api/crises/active-for-character");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setCrises(data.crises ?? []);
    } catch {
      // Silent fail — crises are ambient, not critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCrises();
    const interval = setInterval(fetchCrises, 60_000); // Refresh every minute
    return () => clearInterval(interval);
  }, [fetchCrises]);

  const handleInteract = async (crisisId: string, optionId: string) => {
    setSubmitting(`${crisisId}:${optionId}`);
    setError(null);
    try {
      const res = await fetch(`/api/crises/${crisisId}/interact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError({ crisisId, message: data.error ?? "Failed to submit decision" });
        return;
      }

      // Show toast for applied effects
      if (data.appliedEffects && data.appliedEffects.length > 0) {
        const effectSummary = data.appliedEffects
          .map(
            (e: { value: number; label: string }) =>
              `${e.value > 0 ? "+" : ""}${e.value} ${e.label}`
          )
          .join(", ");
        showToast(`Effects applied: ${effectSummary}`, "success");
      } else if (data.nextNode) {
        showToast("Decision submitted", "success");
      } else {
        showToast("Crisis resolved", "success");
        handleDismiss(crisisId);
      }

      // Refresh to show next node or resolved state
      await fetchCrises();
    } catch {
      setError({ crisisId, message: "Network error" });
    } finally {
      setSubmitting(null);
    }
  };

  const handleDismiss = useCallback((crisisId: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(crisisId);
      writeDismissedIds(next);
      return next;
    });
  }, []);

  const visibleCrises = crises.filter((c) => !dismissedIds.has(c.crisis._id.toString()));

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-5 animate-pulse">
        <div className="h-4 w-32 bg-muted rounded mb-3" />
        <div className="h-3 w-full bg-muted rounded" />
      </div>
    );
  }

  if (visibleCrises.length === 0) return null;

  return (
    <div className="space-y-4">
      {visibleCrises.map((data) => {
        const {
          crisis,
          interaction,
          currentNode,
          canInteract,
          timeRemainingMinutes,
          hasContributed,
          optionAvailability,
        } = data;
        const severity = crisisSeverity(crisis);
        const styles = SEVERITY_STYLES[severity];

        return (
          <div
            key={crisis._id.toString()}
            className={`rounded-xl border ${styles.border} ${styles.bg} p-5`}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="font-semibold text-foreground">{crisis.name}</h3>
                <p className="text-xs text-muted mt-0.5">{crisis.description}</p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => handleDismiss(crisis._id.toString())}
                  className="shrink-0 text-xs text-muted hover:text-foreground transition-colors px-2 py-1 rounded-md border border-transparent hover:border-card-border hover:bg-card"
                  title="Dismiss from Actions"
                  aria-label="Dismiss crisis from Actions"
                >
                  Dismiss
                </button>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${styles.badge}`}>
                  {crisis.scope === "global"
                    ? "Global"
                    : crisis.scope === "country"
                      ? "National"
                      : "Regional"}
                </span>
                {/* The countdown belongs to the decision, not to the crisis. On an
                    ambient card there is no prompt to run out, so a bare
                    "Expired" chip beside a crisis that is still very much
                    running would read as the crisis itself having lapsed. */}
                {canInteract && timeRemainingMinutes !== null && (
                  <span className="text-xs text-muted tabular-nums">
                    {formatTimeRemaining(timeRemainingMinutes)}
                  </span>
                )}
              </div>
            </div>

            {/* Effects */}
            {crisis.effects.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {crisis.effects.slice(0, 3).map((effect, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full border ${
                      effect.value < 0
                        ? "border-error/30 bg-error/5 text-error"
                        : "border-success/30 bg-success/5 text-success"
                    }`}
                  >
                    {effect.effectType === "tick" && (
                      <svg
                        className="h-2.5 w-2.5 shrink-0 opacity-70"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2.5}
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                      </svg>
                    )}
                    {effect.value > 0 ? "+" : ""}
                    {effect.value} {effect.label}
                  </span>
                ))}
              </div>
            )}

            {/* Interaction Section — only when this character can act */}
            {canInteract && currentNode && (
              <div className="mt-3 pt-3 border-t border-card-border">
                <h4 className="text-sm font-medium text-foreground mb-2">{currentNode.title}</h4>
                <p className="text-xs text-muted mb-3">{currentNode.description}</p>

                {/* Collective Progress */}
                {currentNode.type === "collective" && interaction && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted">Response Fund</span>
                      <span className="tabular-nums">
                        ${interaction.collectiveCurrent.toLocaleString("en-US")} / $
                        {interaction.collectiveTarget?.toLocaleString("en-US")}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{
                          width: `${Math.min(100, (interaction.collectiveCurrent / (interaction.collectiveTarget ?? 1)) * 100)}%`,
                        }}
                      />
                    </div>
                    {interaction.contributors.length > 0 && (
                      <p className="text-xs text-muted mt-1">
                        {interaction.contributors.length} contributor
                        {interaction.contributors.length === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                )}

                {/* Aid nodes need a share-of-GDP amount, which only the crisis
                    page's slider collects. Posting a bare optionId from here is
                    always refused, so send the player to the real flow. */}
                {currentNode.type === "aid" && (
                  <Link
                    href={`/world/crises/${crisis._id.toString()}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-card-border bg-card px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-card-elevated"
                  >
                    Open the crisis to send aid or decline
                  </Link>
                )}

                {/* Options */}
                {currentNode.type !== "aid" &&
                  currentNode.options &&
                  currentNode.options.length > 0 && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {currentNode.options.map((option) => {
                        const isSubmitting =
                          submitting === `${crisis._id.toString()}:${option.optionId}`;
                        // An option the nation cannot meet the campaign requirement
                        // for would be refused by the command path, so it is closed
                        // here with its reasons rather than offered and rejected.
                        const availability = optionAvailability?.[option.optionId];
                        const isDisabled =
                          isSubmitting ||
                          availability?.eligible === false ||
                          (currentNode.type === "collective" && hasContributed);

                        return (
                          <button
                            key={option.optionId}
                            onClick={() => handleInteract(crisis._id.toString(), option.optionId)}
                            disabled={isDisabled}
                            className={`rounded-lg border border-card-border bg-card p-3 text-left transition-colors hover:bg-card-elevated disabled:opacity-50 disabled:cursor-not-allowed ${
                              isSubmitting ? "animate-pulse" : ""
                            }`}
                          >
                            <div className="text-sm font-medium text-foreground">
                              {option.label}
                            </div>
                            <div className="text-xs text-muted mt-0.5">{option.description}</div>
                            {availability?.eligible === false && (
                              <ul className="mt-2 space-y-0.5 text-[10px] text-error">
                                {availability.reasons.map((reason) => (
                                  <li key={reason}>{reason}</li>
                                ))}
                              </ul>
                            )}
                            {option.collectiveContribution && (
                              <div className="text-xs text-primary mt-1">
                                Contribute ${option.collectiveContribution.toLocaleString("en-US")}
                              </div>
                            )}
                            {option.effects.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {option.effects.map((effect, i) => (
                                  <span
                                    key={i}
                                    className={`text-xs px-1.5 py-0.5 rounded border ${
                                      effect.value < 0
                                        ? "border-error/20 bg-error/5 text-error"
                                        : "border-success/20 bg-success/5 text-success"
                                    }`}
                                  >
                                    {effect.value > 0 ? "+" : ""}
                                    {effect.value} {effect.label}
                                  </span>
                                ))}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
              </div>
            )}

            {error?.crisisId === crisis._id.toString() && (
              <p className="text-xs text-rose-600 mt-2">{error.message}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
