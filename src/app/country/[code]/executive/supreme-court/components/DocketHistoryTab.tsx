"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui";

interface DocketCaseRow {
  caseKey: string;
  title: string;
  axis: "economic" | "social";
  decisionYear: number;
  outcome?: "affirmed" | "diverged";
  decidedAtTurn?: number;
  decisionSeatedFor?: number;
  decisionSeatedAgainst?: number;
}

/**
 * Docket history (#3581 stories 14/17/19/30) — past cases and how the sitting
 * Court ruled, most recent first (server already sorts by `decidedAtTurn`
 * descending; see `getScotusCaseHistory`). Lazy-loaded: only fetched once the
 * "Docket History" tab is actually opened, matching the Admin-tab lazy-fetch
 * convention on the cabinet page.
 */
export function DocketHistoryTab({ countryCode }: { countryCode: string }) {
  const [cases, setCases] = useState<DocketCaseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/country/${countryCode}/scotus/cases`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
      .then((json: { cases?: DocketCaseRow[] }) => {
        if (!cancelled) setCases(json.cases ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load docket history.");
      });
    return () => {
      cancelled = true;
    };
  }, [countryCode]);

  if (error) {
    return (
      <div className="rounded-xl border border-error/30 bg-error/10 p-4 text-sm text-error">
        {error}
      </div>
    );
  }

  if (cases === null) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (cases.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-center text-sm text-muted">
        No cases have been decided yet. Landmark cases fire near their real historical dates as the
        game clock advances.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {cases.map((c) => {
        const diverged = c.outcome === "diverged";
        return (
          <div
            key={c.caseKey}
            className="flex flex-col gap-2 rounded-xl border border-card-border bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{c.title}</p>
              <p className="mt-0.5 text-xs text-muted">
                {c.decisionYear} · {c.axis === "economic" ? "Economic" : "Social"} axis
                {c.decisionSeatedFor != null && c.decisionSeatedAgainst != null && (
                  <>
                    {" "}
                    · {c.decisionSeatedFor}-{c.decisionSeatedAgainst} majority
                  </>
                )}
              </p>
            </div>
            <span
              className={`shrink-0 self-start rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide sm:self-center ${
                diverged
                  ? "border-warning/40 bg-warning/10 text-warning"
                  : "border-card-border bg-card-elevated text-muted"
              }`}
            >
              {diverged ? "Diverged" : "Affirmed history"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
