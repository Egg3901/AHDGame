"use client";

import { useEffect, useState } from "react";
import { SectionLabel } from "@/components/ui/SectionLabel";
import type { IntakeSummary } from "@/lib/admin/intake/intakeSummary";

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";
}

function topEntries(map: Record<string, number>, limit = 6): [string, number][] {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

/**
 * New-account funnel from the game database: every signup method, consent
 * independent. The number PostHog totals are reconciled against.
 */
export function AdminIntakePanel({ days }: { days: number }) {
  const [data, setData] = useState<IntakeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/intake/summary?days=${days}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as IntakeSummary;
      })
      .then((summary) => {
        if (!cancelled) {
          setData(summary);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const t = data?.totals;
  const steps: { label: string; value: number; sub: string }[] = t
    ? [
        { label: "New accounts", value: t.accounts, sub: "staff excluded" },
        {
          label: "Character within 1h",
          value: t.characterWithin1h,
          sub: pct(t.characterWithin1h, t.accounts),
        },
        {
          label: "Character within 24h",
          value: t.characterWithin24h,
          sub: pct(t.characterWithin24h, t.accounts),
        },
        { label: "Character ever", value: t.characterEver, sub: pct(t.characterEver, t.accounts) },
        {
          label: "Back after signup day",
          value: t.seenAfterSignupDay,
          sub: pct(t.seenAfterSignupDay, t.accounts),
        },
        {
          label: "Back after 7 days",
          value: t.seenAfter7Days,
          sub: pct(t.seenAfter7Days, t.accounts),
        },
      ]
    : [];

  return (
    <section>
      <SectionLabel>New-player intake</SectionLabel>
      <p className="mb-4 max-w-3xl text-sm text-muted">
        Every new account in the window, from the game database, whatever the sign-in method or
        analytics choice. Return rates use a daily last-seen stamp that only exists from its
        rollout, so older cohorts read low.
      </p>
      {error && <p className="text-sm text-error">Could not load intake: {error}</p>}
      {t && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {steps.map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-card-border bg-card p-4 shadow-sm"
              >
                <p className="text-body-sm font-medium text-muted">{s.label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{s.value}</p>
                <p className="mt-0.5 text-xs text-muted">{s.sub}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["Sign-in method", t.byProvider],
                ["Referring site", data.byReferrerDomain],
                ["Campaign source", data.byUtmSource],
              ] as const
            ).map(([label, map]) => (
              <div
                key={label}
                className="rounded-xl border border-card-border bg-card p-4 shadow-sm"
              >
                <p className="mb-2 text-body-sm font-medium text-muted">{label}</p>
                {Object.keys(map).length === 0 ? (
                  <p className="text-xs text-muted">None recorded yet</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {topEntries(map).map(([key, count]) => (
                      <li key={key} className="flex justify-between gap-2">
                        <span className="truncate">{key}</span>
                        <span className="tabular-nums text-muted">
                          {count} ({pct(count, t.accounts)})
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
