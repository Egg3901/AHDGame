"use client";

import { useEffect, useState } from "react";
import { SectionLabel } from "@/components/ui/SectionLabel";
import type { IntakeSummary } from "@/lib/admin/intake/intakeSummary";
import type { OnboardingCohorts } from "@/lib/admin/intake/onboardingCohorts";

type IntakePayload = IntakeSummary & { onboarding?: OnboardingCohorts };

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
  const [data, setData] = useState<IntakePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/intake/summary?days=${days}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as IntakePayload;
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
          {data.onboarding && <OnboardingCohortTable cohorts={data.onboarding} />}
        </div>
      )}
    </section>
  );
}

const STEP_LABELS: Record<string, string> = {
  "scout-state": "Scouted home",
  "join-party": "Joined party",
  "campaign-action": "Campaigned",
  "file-for-race": "Filed for race",
  invest: "Invested",
  "found-company": "Ran company",
  "back-union": "Backed union",
  "read-wire": "Read news",
  "first-vote": "Voted",
};

/**
 * Characters created in the window, founding-race joiners vs joiners of a
 * running world. The onboarding target: mid-world zero influence after 72h
 * at 25% or lower, and Campaign within 24h at 70% or higher.
 */
function OnboardingCohortTable({ cohorts }: { cohorts: OnboardingCohorts }) {
  const rows = [
    ["Joined during founding", cohorts.founding],
    ["Joined a running world", cohorts.midWorld],
  ] as const;
  return (
    <div className="overflow-x-auto rounded-xl border border-card-border bg-card p-4 shadow-sm">
      <p className="mb-1 text-body-sm font-medium text-muted">First days of new characters</p>
      <p className="mb-3 text-xs text-muted">
        Target for joiners of a running world: Campaign within 24h at 70% or more, no influence
        growth after 72h at 25% or less (45% before 1.16). From 1.16 new characters start at 10
        influence, so growth is measured against each character&apos;s own start; &quot;started at
        10&quot; counts them. Step counts exist from the stamp rollout onward.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1 pr-3 font-medium">Cohort</th>
            <th className="py-1 pr-3 font-medium tabular-nums">Characters</th>
            <th className="py-1 pr-3 font-medium">Campaigned in 24h</th>
            <th className="py-1 pr-3 font-medium">No influence growth after 72h</th>
            <th className="py-1 pr-3 font-medium tabular-nums">Started at 10</th>
            {Object.keys(STEP_LABELS).map((id) => (
              <th key={id} className="py-1 pr-3 font-medium">
                {STEP_LABELS[id]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, c]) => (
            <tr key={label} className="border-t border-card-border/60">
              <td className="py-1.5 pr-3">{label}</td>
              <td className="py-1.5 pr-3 tabular-nums">{c.characters}</td>
              <td className="py-1.5 pr-3 tabular-nums">
                {c.campaignedWithin24h} ({pct(c.campaignedWithin24h, c.characters)})
              </td>
              <td className="py-1.5 pr-3 tabular-nums">
                {c.noInfluenceGrowthAfter72h} of {c.atLeast72h} (
                {pct(c.noInfluenceGrowthAfter72h, c.atLeast72h)})
              </td>
              <td className="py-1.5 pr-3 tabular-nums">{c.startedWithInfluence}</td>
              {Object.keys(STEP_LABELS).map((id) => (
                <td key={id} className="py-1.5 pr-3 tabular-nums">
                  {c.steps[id] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
