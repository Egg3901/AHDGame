"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import type { ElectionLogEntry } from "@/lib/elections/electionResponseTypes";
import { PartyLogo } from "@/components/PartyLogo";
import { CardSkeleton, Skeleton } from "@/components/ui";
import { formatElectionTypeLabel } from "@/lib/utils/electionLabels";
import type { CountryId } from "@/lib/constants/countries";
import { LocalTime } from "@/components/time/LocalTime";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  upcoming: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  active: "bg-green-500/15 text-green-400 border-green-500/30",
  completed: "bg-muted/15 text-muted border-muted/30",
  cancelled: "bg-red-500/15 text-red-400 border-red-500/30",
};

const STATUS_LABELS: Record<string, string> = {
  upcoming: "Upcoming",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};

function fmtVotes(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("en-US");
}

const DATE_LABEL_OPTIONS = {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
} as const;

// ─── Sub-components ───────────────────────────────────────────────────────────

function EventLine({
  text,
  color,
  partyId,
  countryId,
}: {
  text: string;
  color?: string;
  partyId?: string;
  countryId?: "US" | "UK" | "DE";
}) {
  const isWin = text.includes("wins") || text.includes("advanced");
  const isLoss =
    text.includes("eliminated") || text.includes("defeated") || text.includes("no seats");
  const dotColor = isWin ? "var(--success)" : isLoss ? "var(--error)" : "var(--muted)";
  return (
    <div className="flex items-start gap-2 text-xs">
      {partyId ? (
        <PartyLogo
          partyId={partyId}
          partyColor={color ?? dotColor}
          countryId={countryId}
          size="h-1.5 w-1.5 mt-1"
        />
      ) : (
        <span
          className="mt-1 h-1.5 w-1.5 rounded-full shrink-0"
          style={{ backgroundColor: color ?? dotColor }}
        />
      )}
      <span className={isWin ? "text-green-400" : isLoss ? "text-red-400/80" : "text-muted"}>
        {text}
      </span>
    </div>
  );
}

function PartyChip({
  name,
  color,
  partyId,
  countryId,
}: {
  name: string;
  color: string;
  partyId: string;
  countryId?: "US" | "UK" | "DE";
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
      style={{ borderColor: `${color}50`, backgroundColor: `${color}15`, color }}
    >
      <PartyLogo partyId={partyId} partyColor={color} countryId={countryId} size="h-1.5 w-1.5" />
      {name}
    </span>
  );
}

function PrimaryBlock({ result }: { result: ElectionLogEntry["primaryResults"][0] }) {
  const [open, setOpen] = useState(false);
  const isContested = result.candidates.length > 1;

  return (
    <div className="rounded-lg border border-card-border bg-background/50">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <PartyLogo
            partyId={result.party}
            partyColor={result.partyColor}
            countryId={result.countryId}
            size="h-2 w-2"
          />
          <span className="text-xs font-medium truncate">{result.partyName}</span>
          {isContested ? (
            <span className="rounded-full bg-yellow-500/15 border border-yellow-500/30 px-1.5 py-0.5 text-[9px] text-yellow-400">
              contested
            </span>
          ) : (
            <span className="rounded-full bg-muted/15 border border-muted/30 px-1.5 py-0.5 text-[9px] text-muted">
              uncontested
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-muted">
            {result.candidates.length} candidate{result.candidates.length !== 1 ? "s" : ""}
          </span>
          <svg
            className={`h-3 w-3 text-muted transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="border-t border-card-border px-3 py-2.5 space-y-1.5">
          {/* Candidate score bars */}
          {isContested && (
            <div className="space-y-1.5 mb-2">
              {result.candidates.map((c) => (
                <div key={c.candidateId} className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-medium w-32 truncate ${c.advanced ? "text-foreground" : "text-muted/60 line-through"}`}
                  >
                    {c.name}
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-card-border overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, c.sharePct)}%`,
                        backgroundColor: c.advanced ? result.partyColor : "var(--muted)",
                        opacity: c.advanced ? 1 : 0.4,
                      }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums text-muted w-10 text-right">
                    {c.sharePct.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}
          {/* Event lines */}
          <div className="space-y-1">
            {result.events.map((ev, i) => (
              <EventLine
                key={i}
                text={ev}
                color={result.partyColor}
                partyId={result.party}
                countryId={result.countryId}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GeneralBlock({
  result,
  totalSeats,
}: {
  result: NonNullable<ElectionLogEntry["generalResult"]>;
  totalSeats: number | null;
}) {
  const [open, setOpen] = useState(true);
  const totalVotes = result.totalVotes;

  return (
    <div className="rounded-lg border border-card-border bg-background/50">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${result.finalized ? "bg-green-400" : "bg-blue-400 animate-pulse"}`}
          />
          <span className="text-xs font-medium">
            {result.finalized ? "Final Results" : "Live Tally"}
          </span>
          {totalSeats && (
            <span className="text-[10px] text-muted">
              · {totalSeats} seat{totalSeats !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-muted">
            {fmtVotes(totalVotes)} votes · {result.turnsCounted} turn
            {result.turnsCounted !== 1 ? "s" : ""}
          </span>
          <svg
            className={`h-3 w-3 text-muted transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="border-t border-card-border px-3 py-2.5 space-y-3">
          {/* Candidate vote bars */}
          {result.candidates.length > 0 && (
            <div className="space-y-2">
              {result.candidates.map((c) => (
                <div key={c.candidateId}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <PartyLogo
                        partyId={c.party}
                        partyColor={c.partyColor}
                        countryId={c.countryId}
                        size="h-2 w-2"
                      />
                      <span className="text-xs font-medium truncate">{c.name}</span>
                      <PartyChip
                        name={c.partyName}
                        color={c.partyColor}
                        partyId={c.party}
                        countryId={c.countryId}
                      />
                      {c.won && result.finalized && (
                        <span className="rounded-full bg-yellow-500/15 border border-yellow-500/30 px-1.5 py-0.5 text-[9px] text-yellow-400">
                          ✓ won
                        </span>
                      )}
                    </div>
                    <div className="shrink-0 text-right text-[10px] tabular-nums">
                      <span className="font-semibold" style={{ color: c.partyColor }}>
                        {c.pct.toFixed(1)}%
                      </span>
                      <span className="text-muted ml-1">{fmtVotes(c.votes)}</span>
                      {c.seats !== null && (
                        <span className="ml-1 font-medium" style={{ color: c.partyColor }}>
                          · {c.seats}s
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-card-border overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, c.pct)}%`, backgroundColor: c.partyColor }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Event lines */}
          {result.events.length > 0 && (
            <div className="pt-2 border-t border-card-border/50 space-y-1">
              {result.events.map((ev, i) => (
                <EventLine key={i} text={ev} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ElectionCard({ entry }: { entry: ElectionLogEntry }) {
  const typeLabel = formatElectionTypeLabel(entry.electionType, entry.countryId as CountryId);
  const statusStyle = STATUS_STYLES[entry.status] ?? STATUS_STYLES.upcoming;
  const hasPrimary = entry.primaryResults.some((r) => r.candidates.length > 0);
  const hasGeneral = entry.generalResult !== null;

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-card-border bg-card/80">
        <div className="min-w-0">
          <div className="flex items-center flex-wrap gap-2 mb-0.5">
            <Link
              href={`/elections/${entry.id}`}
              className="text-sm font-semibold hover:text-primary transition-colors"
            >
              {entry.stateName} — {typeLabel}
              {entry.senateClass ? ` (Class ${entry.senateClass})` : ""}
              {entry.totalSeats ? ` · ${entry.totalSeats} seats` : ""}
            </Link>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusStyle}`}
            >
              {STATUS_LABELS[entry.status] ?? entry.status}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
            <span>Cycle {entry.cycle}</span>
            {entry.startTime && (
              <span>
                Started <LocalTime value={entry.startTime} options={DATE_LABEL_OPTIONS} />
              </span>
            )}
            {entry.endTime && (
              <span>
                Ends <LocalTime value={entry.endTime} options={DATE_LABEL_OPTIONS} />
              </span>
            )}
          </div>
        </div>
        <Link
          href={`/elections/${entry.id}`}
          className="shrink-0 text-[10px] text-muted hover:text-primary transition-colors"
        >
          View →
        </Link>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Primary results */}
        {hasPrimary && (
          <div>
            <div className="text-[10px] font-medium text-muted uppercase tracking-wide mb-2">
              Primary
            </div>
            <div className="space-y-2">
              {entry.primaryResults.map((r) => (
                <PrimaryBlock key={r.party} result={r} />
              ))}
            </div>
          </div>
        )}

        {/* General results */}
        {hasGeneral && entry.generalResult && (
          <div>
            <div className="text-[10px] font-medium text-muted uppercase tracking-wide mb-2">
              General Election
            </div>
            <GeneralBlock result={entry.generalResult} totalSeats={entry.totalSeats} />
          </div>
        )}

        {/* No data yet */}
        {!hasPrimary && !hasGeneral && (
          <p className="text-xs text-muted/50 italic">No candidates yet</p>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ElectionLog() {
  const [entries, setEntries] = useState<ElectionLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLog = useCallback(
    async (params: { q: string; type: string; status: string; state: string; page: number }) => {
      setLoading(true);
      try {
        const sp = new URLSearchParams();
        if (params.q) sp.set("q", params.q);
        if (params.type) sp.set("type", params.type);
        if (params.status) sp.set("status", params.status);
        if (params.state) sp.set("state", params.state);
        sp.set("page", String(params.page));
        sp.set("limit", "50");

        const res = await fetch(`/api/admin/elections/log?${sp}`);
        const data = await res.json();
        if (res.ok) {
          setEntries(data.entries ?? []);
          setTotal(data.total ?? 0);
          setPages(data.pages ?? 1);
        }
      } catch (err) {
        console.error("Failed to load election log:", err);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Debounce free-text, immediate for dropdowns
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(
      () => {
        setPage(1);
        fetchLog({ q, type, status, state, page: 1 });
      },
      q ? 300 : 0
    );
  }, [q, type, status, state, fetchLog]);

  // Fetch when page changes; filter changes handled by debounce effect above
  useEffect(() => {
    fetchLog({ q, type, status, state, page });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- page is the trigger; q/type/status/state passed as args
  }, [page, fetchLog]);

  return (
    <div className="space-y-4">
      {/* Search + filters */}
      <div className="rounded-xl border border-card-border bg-card p-4">
        <div className="flex flex-wrap gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-52">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search state, candidate…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full rounded-lg border border-card-border bg-background pl-8 pr-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>

          {/* Type */}
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="">All types</option>
            <option value="senate">Senate</option>
            <option value="house">House</option>
            <option value="stateSenate">State Senate</option>
            <option value="governor">Governor</option>
          </select>

          {/* Status */}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="">All statuses</option>
            <option value="upcoming">Upcoming</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>

          {/* State */}
          <input
            type="text"
            placeholder="State (CA, TX…)"
            value={state}
            onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))}
            maxLength={2}
            className="w-28 rounded-lg border border-card-border bg-background px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary/50"
          />

          {/* Refresh */}
          <button
            onClick={() => fetchLog({ q, type, status, state, page })}
            disabled={loading}
            className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            <svg
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>

        {/* Summary */}
        <div className="mt-2 text-[11px] text-muted">
          {loading ? (
            <Skeleton className="h-3 w-28" />
          ) : (
            `${total.toLocaleString("en-US")} election${total !== 1 ? "s" : ""} found`
          )}
        </div>
      </div>

      {/* Log entries */}
      {loading && entries.length === 0 ? (
        // Silhouettes the election cards: title/meta header + result rows.
        <div className="min-h-[24rem] space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i}>
              <div className="flex items-center gap-2 mb-3">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-4 w-16 rounded-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </CardSkeleton>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-card-border bg-card p-12 text-center text-sm text-muted">
          No elections match your filters.
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <ElectionCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
            className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm text-muted hover:text-foreground disabled:opacity-40 transition-colors"
          >
            ← Prev
          </button>
          <span className="text-sm text-muted">
            Page {page} of {pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page === pages || loading}
            className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm text-muted hover:text-foreground disabled:opacity-40 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
