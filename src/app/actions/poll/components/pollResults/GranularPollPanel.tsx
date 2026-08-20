"use client";

import { useMemo, useState } from "react";
import { Tooltip } from "@/components/Tooltip";
import type { GenericGranularCell } from "@/lib/demographics/granularCells";
import type { GranularCandidateShare } from "@/lib/actions/granularPollPayload";
import { DEMOGRAPHIC_LABELS } from "@/lib/seeds/demographicCategories";
import type { PollData, StoredPoll } from "../../types";

const BASE_MOE = 3.0; // Typical large-poll margin of error (percentage points).

type SortKey = string;

interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

interface VoteShareAggregate {
  share: number;
  turnout: number;
  you: number;
  totalOpponents: number;
  bestOpponent: number;
  undecided: number;
  bestOpponentName: string;
}

/** Convert a raw key into a readable label. First word capitalized, underscores
 *  become spaces; remaining words lowercase. */
function prettifyKey(key: string): string {
  return key
    .split("_")
    .map((word, i) =>
      i === 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()
    )
    .join(" ");
}

function bucketLabel(dim: string, key: string): string {
  return DEMOGRAPHIC_LABELS[dim]?.[key] ?? prettifyKey(key);
}

function aggregateVoteShares(
  cells: GenericGranularCell[],
  candidateShares: Record<string, GranularCandidateShare>,
  predicate: (cell: GenericGranularCell) => boolean
): VoteShareAggregate {
  const subset = cells.filter(predicate);
  const share = subset.reduce((s, c) => s + c.share, 0);
  if (share <= 0) {
    return {
      share: 0,
      turnout: 0,
      you: 0,
      totalOpponents: 0,
      bestOpponent: 0,
      undecided: 0,
      bestOpponentName: "",
    };
  }
  const turnout = subset.reduce((s, c) => s + c.share * c.turnout, 0) / share;

  let you = 0;
  let undecided = 0;
  const opponentTotals: Record<string, { name: string; share: number }> = {};

  for (const cell of subset) {
    const cs = candidateShares[cell.id];
    if (!cs) continue;
    you += cell.share * cs.you;
    undecided += cell.share * cs.undecided;
    for (const opp of cs.opponents) {
      const entry = opponentTotals[opp.id] ?? { name: opp.name, share: 0 };
      entry.share += cell.share * opp.share;
      opponentTotals[opp.id] = entry;
    }
  }

  // Every accumulator above is weighted by cell.share, so it is currently
  // expressed as a fraction of the WHOLE electorate. Dividing by the subset's
  // share re-expresses each one as a fraction of THIS subset, which is what a
  // vote share means and what makes you + opponents + undecided sum to 100%.
  // Without this the topline (share === 1, so a no-op) was being compared
  // against segment figures scaled down by the segment's size, which is what
  // made "your share vs. topline" unreadable (ticket-1121).
  you /= share;
  undecided /= share;
  for (const entry of Object.values(opponentTotals)) {
    entry.share /= share;
  }

  const opponentEntries = Object.values(opponentTotals);
  const best = opponentEntries.reduce(
    (bestSoFar, o) => (o.share > bestSoFar.share ? o : bestSoFar),
    opponentEntries[0] ?? { name: "", share: 0 }
  );

  const totalOpponents = opponentEntries.reduce((s, o) => s + o.share, 0);

  return {
    share,
    turnout,
    you,
    totalOpponents,
    bestOpponent: best.share,
    undecided,
    bestOpponentName: best.name,
  };
}

function toplineAggregate(
  cells: GenericGranularCell[],
  candidateShares: Record<string, GranularCandidateShare>
): VoteShareAggregate {
  return aggregateVoteShares(cells, candidateShares, () => true);
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function formatTurnout(n: number): string {
  return `${n.toFixed(1)}%`;
}

function StackedShareBar({
  you,
  opponents,
  undecided,
  title,
}: {
  you: number;
  opponents: number;
  undecided: number;
  title?: string;
}) {
  const youPct = Math.max(0, Math.min(100, you * 100));
  const oppPct = Math.max(0, Math.min(100, opponents * 100));
  const undPct = Math.max(0, Math.min(100, undecided * 100));

  return (
    <div
      className="h-2.5 w-full rounded-full bg-card-border overflow-hidden flex"
      title={
        title ??
        `You ${formatPct(you)} · Opponents ${formatPct(opponents)} · Undecided ${formatPct(
          undecided
        )}`
      }
    >
      <div
        className="h-full bg-primary transition-all duration-500"
        style={{ width: `${youPct}%` }}
      />
      <div
        className="h-full bg-red-500 transition-all duration-500"
        style={{ width: `${oppPct}%` }}
      />
      <div
        className="h-full bg-slate-500 transition-all duration-500"
        style={{ width: `${undPct}%` }}
      />
    </div>
  );
}

function HeaderButton({
  children,
  onClick,
  active,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
        active
          ? "bg-primary/10 border-primary/40 text-primary"
          : "bg-card border-card-border text-foreground hover:bg-foreground/[0.03]"
      }`}
    >
      {children}
    </button>
  );
}

function DimensionTabs({
  dims,
  dimLabels,
  active,
  onChange,
}: {
  dims: string[];
  dimLabels: Record<string, string>;
  active: string;
  onChange: (dim: string) => void;
}) {
  return (
    <nav className="flex flex-wrap gap-2" role="tablist" aria-label="Granular dimensions">
      {dims.map((dim) => (
        <button
          key={dim}
          role="tab"
          aria-selected={active === dim}
          onClick={() => onChange(dim)}
          className={`px-3 py-1.5 text-sm font-medium rounded-full border transition-colors ${
            active === dim
              ? "bg-primary/10 border-primary/40 text-primary"
              : "bg-card border-card-border text-muted hover:text-foreground hover:bg-foreground/[0.03]"
          }`}
        >
          {dimLabels[dim] ?? prettifyKey(dim)}
        </button>
      ))}
    </nav>
  );
}

function buildCsv(
  cells: GenericGranularCell[],
  candidateShares: Record<string, GranularCandidateShare>,
  dims: string[],
  dimLabels: Record<string, string>
): string {
  const headers = [
    ...dims.map((d) => dimLabels[d] ?? prettifyKey(d)),
    "ShareOfElectorate",
    "Turnout",
    "You",
    "BestOpponent",
    "Undecided",
    "Margin",
  ];
  const rows = cells.map((cell) => {
    const cs = candidateShares[cell.id];
    const bestOpp = cs
      ? cs.opponents.reduce(
          (best, o) => (o.share > best.share ? o : best),
          cs.opponents[0] ?? { id: "", name: "", share: 0 }
        )
      : { share: 0 };
    const margin = (cs?.you ?? 0) - bestOpp.share;
    return [
      ...dims.map((d) => bucketLabel(d, cell.buckets[d])),
      cell.share.toFixed(4),
      cell.turnout.toFixed(1),
      ((cs?.you ?? 0) * 100).toFixed(1),
      (bestOpp.share * 100).toFixed(1),
      ((cs?.undecided ?? 0) * 100).toFixed(1),
      (margin * 100).toFixed(1),
    ];
  });

  const escape = (v: string) => {
    const needsQuotes = /[",\n\r]/.test(v);
    if (!needsQuotes) return v;
    return `"${v.replace(/"/g, '"')}"`;
  };

  return [headers, ...rows].map((row) => row.map(escape).join(",")).join("\n");
}

export function GranularPollPanel({ poll, pollData }: { poll: StoredPoll; pollData: PollData }) {
  const granular = poll.granular!;
  const { dims, dimLabels, cells, candidateShares } = granular;
  const [activeDim, setActiveDim] = useState<string>(dims[0] ?? "");
  const [filters, setFilters] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(dims.map((d) => [d, null]))
  );
  const [tableOpen, setTableOpen] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "share", dir: "desc" });

  const topline = useMemo(() => toplineAggregate(cells, candidateShares), [cells, candidateShares]);

  const allBucketKeys = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const dim of dims) {
      const keys = new Set<string>();
      for (const cell of cells) {
        keys.add(cell.buckets[dim]);
      }
      // Restore US pruned buckets (under polling floor) only when this dim is
      // actually US-shaped. DEMOGRAPHIC_LABELS.education is no_college/college/
      // graduate — merging it into every country's `education` dim leaked those
      // US keys onto DD/DE/JP polls (ticket #1121).
      const usLabelKeys = Object.keys(DEMOGRAPHIC_LABELS[dim] ?? {});
      const usLabelSet = new Set(usLabelKeys);
      const cellKeys = Array.from(keys);
      const usShaped = cellKeys.length > 0 && cellKeys.every((k) => usLabelSet.has(k));
      if (usShaped) {
        for (const key of usLabelKeys) keys.add(key);
      }
      map[dim] = Array.from(keys);
    }
    return map;
  }, [cells, dims]);

  const marginalRows = useMemo(() => {
    return (allBucketKeys[activeDim] ?? []).map((key) => {
      const agg = aggregateVoteShares(cells, candidateShares, (c) => c.buckets[activeDim] === key);
      return { key, label: bucketLabel(activeDim, key), ...agg };
    });
  }, [cells, candidateShares, activeDim, allBucketKeys]);

  const segmentAggregate = useMemo(() => {
    const activeFilters = Object.entries(filters).filter(([, v]) => v != null) as [
      string,
      string,
    ][];
    if (activeFilters.length === 0) return null;
    return aggregateVoteShares(cells, candidateShares, (c) =>
      activeFilters.every(([dim, key]) => c.buckets[dim] === key)
    );
  }, [cells, candidateShares, filters]);

  const tableRows = useMemo(() => {
    const rows = cells.map((cell) => {
      const cs = candidateShares[cell.id];
      const bestOpp = cs
        ? cs.opponents.reduce(
            (best, o) => (o.share > best.share ? o : best),
            cs.opponents[0] ?? { id: "", name: "", share: 0 }
          )
        : { id: "", name: "", share: 0 };
      return {
        cell,
        cs,
        bestOpp,
        margin: (cs?.you ?? 0) - bestOpp.share,
      };
    });

    rows.sort((a, b) => {
      const { key, dir } = sort;
      let av: number | string;
      let bv: number | string;

      if (key === "share") {
        av = a.cell.share;
        bv = b.cell.share;
      } else if (key === "turnout") {
        av = a.cell.turnout;
        bv = b.cell.turnout;
      } else if (key === "you") {
        av = a.cs?.you ?? 0;
        bv = b.cs?.you ?? 0;
      } else if (key === "bestOpponent") {
        av = a.bestOpp.share;
        bv = b.bestOpp.share;
      } else if (key === "undecided") {
        av = a.cs?.undecided ?? 0;
        bv = b.cs?.undecided ?? 0;
      } else if (key === "margin") {
        av = a.margin;
        bv = b.margin;
      } else {
        av = a.cell.buckets[key] ?? "";
        bv = b.cell.buckets[key] ?? "";
      }

      if (typeof av === "string" && typeof bv === "string") {
        return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = typeof av === "number" ? av : 0;
      const bn = typeof bv === "number" ? bv : 0;
      return dir === "asc" ? an - bn : bn - an;
    });

    return rows;
  }, [cells, candidateShares, sort]);

  const toggleFilter = (dim: string, key: string) => {
    setFilters((prev) => ({ ...prev, [dim]: prev[dim] === key ? null : key }));
  };

  const cycleSort = (key: SortKey) => {
    setSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc",
    }));
  };

  const exportCsv = () => {
    const csv = buildCsv(cells, candidateShares, dims, dimLabels);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stateId = pollData.homeState ?? "unknown";
    const taken = new Date(poll.takenAt).toISOString().slice(0, 16).replace(/[-T:]/g, "");
    link.href = url;
    link.download = `poll-granular-${stateId}-${taken}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const segmentMoe =
    segmentAggregate && segmentAggregate.share > 0
      ? BASE_MOE / Math.sqrt(segmentAggregate.share)
      : null;

  const tableColumns: { key: SortKey; label: string; numeric: boolean }[] = [
    ...dims.map((d) => ({ key: d, label: dimLabels[d] ?? prettifyKey(d), numeric: false })),
    { key: "share", label: "% of electorate", numeric: true },
    { key: "turnout", label: "Turnout", numeric: true },
    { key: "you", label: "You %", numeric: true },
    { key: "bestOpponent", label: "Best opp. %", numeric: true },
    { key: "undecided", label: "Undecided %", numeric: true },
    { key: "margin", label: "Margin", numeric: true },
  ];

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 flex flex-wrap items-center gap-3 border-b border-card-border">
        <span className="text-xl shrink-0">🧩</span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Tooltip content="Exit-poll style marginals and cross-tab segments derived from Layer-1 demographics. Smaller segments have a wider margin of error.">
              <span className="font-semibold">Granular electorate</span>
            </Tooltip>
            <span className="text-xs rounded-full border border-card-border px-2 py-0.5 text-muted">
              {cells.length} segments
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <HeaderButton
            onClick={() => setTableOpen((v) => !v)}
            active={tableOpen}
            ariaLabel="Toggle full segment table"
          >
            Table
          </HeaderButton>
          <HeaderButton onClick={exportCsv} ariaLabel="Export granular poll data as CSV">
            Export CSV
          </HeaderButton>
        </div>
      </div>

      <div className="px-5 py-4 space-y-5">
        {/* Dimension tabs */}
        <DimensionTabs
          dims={dims}
          dimLabels={dimLabels}
          active={activeDim}
          onChange={setActiveDim}
        />

        {/* A poll taken during the primary phase carries no modelled rivals, so
            every bar splits between the player and undecided voters and "you"
            sits near 95%. Say that in the open instead of letting the player
            read it as a real projection (ticket-1121). */}
        {topline.totalOpponents <= 0 ? (
          <div className="rounded-lg border border-card-border bg-foreground/[0.02] px-3 py-2 text-xs text-muted">
            No rival candidates are modelled in this race yet, so every share below splits between
            you and undecided voters only. Rivals enter the model once your race reaches the general
            election, and your share drops accordingly.
          </div>
        ) : null}

        {/* Marginal rows */}
        <div className="space-y-3">
          {marginalRows.map((row) => {
            const empty = row.share <= 0;
            return (
              <div
                key={row.key}
                className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
              >
                <div className="min-w-[140px] sm:w-40 shrink-0">
                  <div className="text-sm font-medium">{row.label}</div>
                  <div className="text-xs text-muted tabular-nums">
                    {empty ? (
                      <span className="text-muted/70">under polling floor</span>
                    ) : (
                      `${formatPct(row.share)} of electorate · ${formatTurnout(row.turnout)} turnout`
                    )}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  {empty ? (
                    <div className="h-2.5 w-full rounded-full bg-card-border/50" />
                  ) : (
                    <StackedShareBar
                      you={row.you}
                      opponents={row.totalOpponents}
                      undecided={row.undecided}
                      title={`${row.label}: You ${formatPct(row.you)}, opponents ${formatPct(
                        row.totalOpponents
                      )}, undecided ${formatPct(row.undecided)}`}
                    />
                  )}
                </div>
                <div className="shrink-0 text-right sm:w-36">
                  {empty ? (
                    <span className="text-xs text-muted">-</span>
                  ) : (
                    <div className="text-xs tabular-nums">
                      <span className="text-primary font-medium">{formatPct(row.you)}</span>
                      <span className="text-muted mx-1">/</span>
                      <span className="text-red-400 font-medium">
                        {formatPct(row.bestOpponent)}
                      </span>
                      <span className="text-muted mx-1">/</span>
                      <span className="text-slate-400 font-medium">{formatPct(row.undecided)}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-primary" />
            You
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
            Opponents
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-500" />
            Undecided
          </span>
        </div>

        {/* Segment explorer */}
        <div className="rounded-lg border border-card-border bg-foreground/[0.02] p-4 space-y-4">
          <div className="text-sm font-semibold">Segment explorer</div>
          <div className="space-y-3">
            {dims.map((dim) => (
              <div key={dim} className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                <div className="text-xs text-muted uppercase tracking-wide sm:w-20 shrink-0 pt-1.5">
                  {dimLabels[dim] ?? prettifyKey(dim)}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(allBucketKeys[dim] ?? []).map((key) => {
                    const active = filters[dim] === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleFilter(dim, key)}
                        aria-pressed={active}
                        className={`px-2 py-1 text-xs rounded-full border transition-colors focus:outline-none focus:ring-1 focus:ring-primary/50 ${
                          active
                            ? "bg-primary/15 border-primary/50 text-primary"
                            : "bg-card border-card-border text-foreground hover:bg-foreground/[0.03]"
                        }`}
                      >
                        {bucketLabel(dim, key)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {segmentAggregate ? (
            segmentAggregate.share > 0 ? (
              <div className="rounded-lg border border-card-border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div>
                    <div className="text-xs text-muted">Share of electorate</div>
                    <div className="text-lg font-bold tabular-nums">
                      {formatPct(segmentAggregate.share)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Turnout</div>
                    <div className="text-lg font-bold tabular-nums">
                      {formatTurnout(segmentAggregate.turnout)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Your share of this segment</div>
                    <div className="text-lg font-bold tabular-nums text-primary">
                      {formatPct(segmentAggregate.you)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">vs. your race-wide share</div>
                    <div className="flex items-baseline gap-1.5">
                      <span
                        className={`text-lg font-bold tabular-nums ${
                          segmentAggregate.you - topline.you >= 0
                            ? "text-green-400"
                            : "text-red-400"
                        }`}
                      >
                        {segmentAggregate.you >= topline.you ? "+" : ""}
                        {formatPct(segmentAggregate.you - topline.you)}
                      </span>
                      <span className="text-xs text-muted tabular-nums">
                        ({formatPct(topline.you)} race-wide)
                      </span>
                    </div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-xs text-muted">Widened margin of error</div>
                    <Tooltip content="Small segments are noisier. The MoE widens by the inverse square root of the segment's share of the electorate.">
                      <span className="text-lg font-bold tabular-nums cursor-help">
                        ±{segmentMoe?.toFixed(1) ?? "-"} pts
                      </span>
                    </Tooltip>
                  </div>
                </div>
                <StackedShareBar
                  you={segmentAggregate.you}
                  opponents={segmentAggregate.totalOpponents}
                  undecided={segmentAggregate.undecided}
                  title={`Segment: You ${formatPct(segmentAggregate.you)}, opponents ${formatPct(
                    segmentAggregate.totalOpponents
                  )}, undecided ${formatPct(segmentAggregate.undecided)}`}
                />
                {/* Spelled out in the open: the reporter should never have to
                    hover the bar to read what it splits into (ticket-1121). */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-primary" />
                    You{" "}
                    <span className="text-foreground font-medium tabular-nums">
                      {formatPct(segmentAggregate.you)}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
                    Opponents{" "}
                    <span className="text-foreground font-medium tabular-nums">
                      {formatPct(segmentAggregate.totalOpponents)}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-500" />
                    Undecided{" "}
                    <span className="text-foreground font-medium tabular-nums">
                      {formatPct(segmentAggregate.undecided)}
                    </span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span>
                    Best opponent:{" "}
                    <span className="text-foreground font-medium">
                      {segmentAggregate.bestOpponentName || "-"}
                    </span>
                  </span>
                  <span>
                    Margin:{" "}
                    <span className="text-foreground font-medium tabular-nums">
                      {formatPct(segmentAggregate.you - segmentAggregate.bestOpponent)}
                    </span>
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-card-border p-4 text-center text-sm text-muted">
                This combination is below the polling floor and has been pruned from the model.
              </div>
            )
          ) : (
            <div className="text-xs text-muted">
              Tap a chip in each row to explore a single cross-tab segment.
            </div>
          )}
        </div>

        {/* Full table */}
        {tableOpen && (
          <div className="border border-card-border rounded-lg overflow-hidden">
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-card border-b border-card-border">
                  <tr>
                    {tableColumns.map((col) => (
                      <th
                        key={col.key}
                        scope="col"
                        className={`px-3 py-2 text-left font-semibold text-xs text-muted whitespace-nowrap ${
                          col.numeric ? "text-right" : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => cycleSort(col.key)}
                          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                        >
                          {col.label}
                          {sort.key === col.key && (
                            <span className="text-primary">{sort.dir === "desc" ? "▼" : "▲"}</span>
                          )}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/20">
                  {tableRows.map(({ cell, cs, bestOpp, margin }) => (
                    <tr key={cell.id} className="hover:bg-foreground/[0.02]">
                      {dims.map((dim) => (
                        <td key={dim} className="px-3 py-2 whitespace-nowrap">
                          {bucketLabel(dim, cell.buckets[dim])}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right tabular-nums">{formatPct(cell.share)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatTurnout(cell.turnout)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-primary">
                        {formatPct(cs?.you ?? 0)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-400">
                        {formatPct(bestOpp.share)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                        {formatPct(cs?.undecided ?? 0)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums font-medium ${
                          margin >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {margin >= 0 ? "+" : ""}
                        {formatPct(margin)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
