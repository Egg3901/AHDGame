"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/observability/fetchJson";
import { trackAction } from "@/lib/observability/actionBreadcrumb";
import { useToast } from "@/contexts/ToastContext";

interface PromptCandidate {
  id: string;
  name: string;
  partyAbbr: string;
  partyColor: string;
  isNPP: boolean;
  support: number | null;
}

interface Prompt {
  electionId: string;
  year: number | null;
  countryId: string;
  inPrimary: boolean;
  candidates: PromptCandidate[];
}

/**
 * Presidential-endorsement nudge on the Actions page.
 *
 * Renders nothing unless the player has a live presidential race in their own
 * country AND no active endorsement in it: the server decides that, so this
 * component never has to reason about phase, party or country rules. It follows
 * the DebateCard / PlayerEventCard convention of self-fetching and collapsing to
 * null, which is what lets the Actions page mount it unconditionally.
 *
 * The endorsement is issued from here rather than linking out to the race page,
 * because a prompt the player has to navigate away to satisfy is a prompt most
 * players will not satisfy.
 */
export default function EndorsePresidentCard() {
  const { showToast } = useToast();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [endorsedName, setEndorsedName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ prompt: Prompt | null } | null>("/api/elections/endorsement-prompt", {
      feature: "endorsement-prompt",
    })
      .then((data) => {
        if (cancelled) return;
        setPrompt(data?.prompt ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const endorse = useCallback(
    async (candidate: PromptCandidate) => {
      if (!prompt || pendingId) return;
      setPendingId(candidate.id);
      try {
        trackAction("election.endorse", {
          electionId: prompt.electionId,
          candidateId: candidate.id,
          action: "POST",
        });
        const res = await fetch(`/api/elections/${prompt.electionId}/endorse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId: candidate.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showToast(data.error ?? "Failed to endorse candidate", "error");
          return;
        }
        setEndorsedName(candidate.name);
        showToast(`You endorsed ${candidate.name}`, "success");
      } catch {
        showToast("Network error, please try again", "error");
      } finally {
        setPendingId(null);
      }
    },
    [prompt, pendingId, showToast]
  );

  if (endorsedName) {
    return (
      <div className="rounded-xl border border-success/30 bg-card/50 p-5 shadow-card backdrop-blur-sm">
        <h3 className="text-base font-semibold text-foreground">Endorsement recorded</h3>
        <p className="mt-1 text-sm text-muted">
          You have endorsed <span className="font-semibold text-foreground">{endorsedName}</span>{" "}
          for president. You can switch or withdraw it from the race page at any time.
        </p>
      </div>
    );
  }

  if (!prompt || dismissed) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-primary/30 bg-card/50 shadow-card backdrop-blur-sm">
      <div className="relative px-5 pt-5 pb-1">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary/60 via-secondary/30 to-transparent" />
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-foreground">
            Endorse a candidate for president
            {prompt.year != null ? ` (${prompt.year})` : ""}
          </h3>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          {prompt.inPrimary
            ? "You have not backed anyone in this cycle. During the primary you can only endorse candidates from your own party. An endorsement raises your pick's support and feeds their campaign each turn."
            : "You have not backed anyone in this cycle. An endorsement raises your pick's support and feeds their campaign each turn. You can switch or withdraw it later."}
        </p>
      </div>

      <div className="space-y-2 p-5 pt-3">
        {prompt.candidates.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-background px-3 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: c.partyColor }}
                aria-hidden
              />
              <span className="truncate text-sm font-semibold text-foreground">{c.name}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted">
                {c.partyAbbr}
                {c.isNPP ? " · NPP" : ""}
              </span>
            </div>
            <button
              type="button"
              onClick={() => endorse(c)}
              disabled={pendingId !== null}
              className="shrink-0 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingId === c.id ? "Endorsing…" : "Endorse"}
            </button>
          </div>
        ))}

        <Link
          href={`/elections/${prompt.electionId}`}
          className="block pt-1 text-xs font-medium text-primary hover:underline"
        >
          View the full race →
        </Link>
      </div>
    </div>
  );
}
