// src/components/wiki/widgets/CountryHistory.tsx
"use client";

import { useEffect, useState } from "react";
import { LocalTime } from "@/components/time/LocalTime";

interface LeaderTimelineEntry {
  title: string;
  officeType: string;
  characterName: string;
  party?: string;
  startTurn: number;
  startDate: string;
  endTurn?: number;
  endDate?: string;
}

interface RecentEvent {
  id: string;
  eventType: string;
  title: string;
  turn: number;
  date: string;
  party?: string;
  characterName?: string;
}

interface CountryHistoryData {
  countryId: string;
  countryName: string;
  headOfGovernmentTitle: string;
  currentLeader: {
    name: string;
    party?: string;
    title: string;
  } | null;
  leaderHistory: LeaderTimelineEntry[];
  recentEvents: RecentEvent[];
}

const EVENT_BADGE: Record<string, string> = {
  leader_change: "bg-primary/15 text-primary",
  bill_enacted: "bg-success/15 text-success",
  international_relations: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  regime_escalation: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  region_seceded: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  region_transferred: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  other: "bg-muted/15 text-muted",
};

const EVENT_LABEL: Record<string, string> = {
  leader_change: "Leader",
  bill_enacted: "Law",
  international_relations: "Treaty",
  regime_escalation: "Regime",
  region_seceded: "Independence",
  region_transferred: "Border",
  other: "Event",
};

const DATE_LABEL_OPTIONS = { year: "numeric", month: "short", day: "numeric" } as const;

export function CountryHistory({ data: rawCountry }: { data?: string }) {
  const countryId = (rawCountry ?? "").trim().toUpperCase();
  const [data, setData] = useState<CountryHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!countryId) {
      setError("No country specified");
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/wiki/country-history/${encodeURIComponent(countryId)}`);
        if (!res.ok) throw new Error("Unable to load country history");
        const json = (await res.json()) as CountryHistoryData;
        if (cancelled) return;
        setData(json);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unable to load country history");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [countryId]);

  if (loading) {
    return (
      <div className="my-4 rounded-xl border border-card-border bg-card/40 p-6">
        <div className="h-32 animate-pulse space-y-3">
          <div className="h-4 w-40 rounded bg-card-elevated" />
          <div className="h-6 w-full rounded bg-card-elevated" />
          <div className="h-6 w-3/4 rounded bg-card-elevated" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="my-4 rounded-xl border border-card-border bg-card/40 p-6">
        <p className="text-sm text-muted">{error ?? "No history available"}</p>
      </div>
    );
  }

  const hasLeaderHistory = data.leaderHistory.length > 0;
  const hasEvents = data.recentEvents.length > 0;

  return (
    <div className="my-4 space-y-6 rounded-xl border border-card-border bg-card/40 p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">
          Live country history
        </p>
        <h3 className="mt-0.5 font-semibold text-foreground">
          {data.countryName} — {data.headOfGovernmentTitle} timeline
        </h3>
        {data.currentLeader && (
          <p className="mt-1 text-sm text-muted">
            Incumbent:{" "}
            <span className="font-medium text-foreground">{data.currentLeader.name}</span>
            {data.currentLeader.party && (
              <span className="ml-1 text-muted">({data.currentLeader.party})</span>
            )}
          </p>
        )}
      </header>

      <section>
        <h4 className="mb-2 text-sm font-semibold text-foreground">Leaders over time</h4>
        {hasLeaderHistory ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border/60 text-xs uppercase tracking-wider text-muted">
                  <th className="py-2 pr-3 text-left font-semibold">Name</th>
                  <th className="py-2 px-3 text-left font-semibold">Party</th>
                  <th className="py-2 px-3 text-right font-semibold">From</th>
                  <th className="py-2 pl-3 text-right font-semibold">To</th>
                </tr>
              </thead>
              <tbody>
                {data.leaderHistory.map((entry, i) => {
                  const isCurrent = !entry.endTurn;
                  return (
                    <tr
                      key={`${entry.startTurn}-${i}`}
                      className="border-b border-card-border/30 last:border-b-0"
                    >
                      <td className="py-2 pr-3 font-medium text-foreground">
                        {entry.characterName}
                        {isCurrent && (
                          <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                            Incumbent
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-muted">{entry.party ?? "—"}</td>
                      <td className="py-2 px-3 text-right font-mono text-muted">
                        T{entry.startTurn} ·{" "}
                        <LocalTime value={entry.startDate} options={DATE_LABEL_OPTIONS} />
                      </td>
                      <td className="py-2 pl-3 text-right font-mono text-muted">
                        {entry.endTurn != null ? (
                          <>
                            T{entry.endTurn}
                            {entry.endDate && (
                              <>
                                {" "}
                                · <LocalTime value={entry.endDate} options={DATE_LABEL_OPTIONS} />
                              </>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">
            No recorded {data.headOfGovernmentTitle} transitions yet. History starts accumulating
            from the first leader change after deployment.
          </p>
        )}
      </section>

      <section>
        <h4 className="mb-2 text-sm font-semibold text-foreground">Recent events</h4>
        {hasEvents ? (
          <ul className="space-y-1">
            {data.recentEvents.map((e) => (
              <li
                key={e.id}
                className="flex items-start gap-3 rounded bg-card-elevated/60 px-3 py-2 text-sm"
              >
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${EVENT_BADGE[e.eventType] ?? EVENT_BADGE.other}`}
                >
                  {EVENT_LABEL[e.eventType] ?? EVENT_LABEL.other}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground">{e.title}</p>
                  <p className="text-xs text-muted">
                    Turn {e.turn} · <LocalTime value={e.date} options={DATE_LABEL_OPTIONS} />
                    {e.party ? ` · ${e.party}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No events recorded for this country yet.</p>
        )}
      </section>
    </div>
  );
}
