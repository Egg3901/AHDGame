"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Tooltip } from "@/components/Tooltip";
import type { GenericGranularCell } from "@/lib/demographics/granularCells";
import type { GranularCandidateShare } from "@/lib/actions/granularPollPayload";
import { DEMOGRAPHIC_LABELS } from "@/lib/seeds/demographicLabels";
import { partyHex } from "../../pollHelpers";
import type { PollData, StoredPoll } from "../../types";

const BASE_UNCERTAINTY_BAND = 3.0; // Illustrative points, not sample-based MoE.

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
  /** Every rival's share of the subset, so the bar can color each by party. */
  opponents: Array<{ id: string; name: string; share: number }>;
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
      opponents: [],
    };
  }
  const turnout = subset.reduce((s, c) => s + c.share * c.turnout, 0) / share;

  let you = 0;
  let undecided = 0;
  const opponentTotals: Record<string, { id: string; name: string; share: number }> = {};

  for (const cell of subset) {
    const cs = candidateShares[cell.id];
    if (!cs) continue;
    you += cell.share * cs.you;
    undecided += cell.share * cs.undecided;
    for (const opp of cs.opponents) {
      const entry = opponentTotals[opp.id] ?? { id: opp.id, name: opp.name, share: 0 };
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
    opponentEntries[0] ?? { id: "", name: "", share: 0 }
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
    opponents: opponentEntries,
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

/** Display colors for the bar: the player's party, each rival's party, and neutral undecided. */
export interface ShareColors {
  you: string;
  opponents: Record<string, string>;
}

const FALLBACK_YOU = "var(--primary)";
const FALLBACK_RIVAL = "#9CA3AF";
const UNDECIDED = "#64748b";

function StackedShareBar({
  you,
  opponents,
  undecided,
  title,
  colors,
  rivals,
}: {
  you: number;
  opponents: number;
  undecided: number;
  title?: string;
  colors?: ShareColors;
  rivals?: Array<{ id: string; share: number }>;
}) {
  const pct = (v: number) => Math.max(0, Math.min(100, v * 100));
  // Without per-rival data (or colors) the rivals collapse into one segment.
  const segments =
    rivals && rivals.length > 0
      ? rivals.map((r) => ({
          key: r.id,
          width: pct(r.share),
          color: colors?.opponents[r.id] ?? FALLBACK_RIVAL,
        }))
      : [{ key: "opp", width: pct(opponents), color: FALLBACK_RIVAL }];

  return (
    <div
      className="flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-card-border"
      role="img"
      aria-label={
        title ??
        `You ${formatPct(you)}, opponents ${formatPct(opponents)}, undecided ${formatPct(undecided)}`
      }
    >
      <div
        className="h-full transition-all duration-500"
        style={{ width: `${pct(you)}%`, backgroundColor: colors?.you ?? FALLBACK_YOU }}
      />
      {segments.map((seg) => (
        <div
          key={seg.key}
          className="h-full transition-all duration-500"
          style={{ width: `${seg.width}%`, backgroundColor: seg.color }}
        />
      ))}
      <div
        className="h-full transition-all duration-500"
        style={{ width: `${pct(undecided)}%`, backgroundColor: UNDECIDED }}
      />
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ backgroundColor: color }}
      aria-hidden
    />
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
      className={`rounded-md px-3 py-1.5 text-body-sm font-medium transition-colors ${
        active
          ? "bg-foreground/10 text-foreground"
          : "text-muted hover:bg-foreground/[0.05] hover:text-foreground"
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
    <nav
      className="flex flex-wrap gap-x-1 border-b border-card-border"
      role="tablist"
      aria-label="Granular dimensions"
    >
      {dims.map((dim) => (
        <button
          key={dim}
          role="tab"
          aria-selected={active === dim}
          onClick={() => onChange(dim)}
          className={`-mb-px border-b-2 px-3 py-2 text-body font-medium transition-colors ${
            active === dim
              ? "border-primary text-foreground"
              : "border-transparent text-muted hover:text-foreground"
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
    return `"${v.replace(/"/g, '""')}"`;
  };

  return [headers, ...rows].map((row) => row.map(escape).join(",")).join("\n");
}

export function GranularPollPanel({ poll, pollData }: { poll: StoredPoll; pollData: PollData }) {
  const colors = useMemo<ShareColors>(
    () => ({
      you: partyHex(pollData.partyColors, pollData.myParty),
      opponents: Object.fromEntries(
        (pollData.electionContext?.opponents ?? []).map((o) => [
          o.candidateId,
          partyHex(pollData.partyColors, o.isNPP ? null : o.party),
        ])
      ),
    }),
    [pollData]
  );
  const t = useTranslations("elections.granularPoll");
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

  const segmentUncertainty =
    segmentAggregate && segmentAggregate.share > 0
      ? BASE_UNCERTAINTY_BAND / Math.sqrt(segmentAggregate.share)
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

  const youLabel = (
    <span className="inline-flex items-center gap-1.5">
      <Swatch color={colors.you} />
      You
    </span>
  );

  return (
    <section
      aria-labelledby="poll-granular-heading"
      className="rounded-lg border border-card-border bg-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="poll-granular-heading" className="text-heading font-semibold">
            <Tooltip content={t("projectionExplanation")}>
              <span>Granular electorate</span>
            </Tooltip>
          </h2>
          <p className="text-body-sm text-muted">{cells.length} segments</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
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

      <div className="mt-4 space-y-5">
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
          <p className="text-body text-muted">
            No rival candidates are modelled in this race yet, so every share below splits between
            you and undecided voters only. Rivals enter the model once your race reaches the general
            election, and your share drops accordingly.
          </p>
        ) : null}

        <div className="space-y-3">
          {marginalRows.map((row) => {
            const empty = row.share <= 0;
            return (
              <div
                key={row.key}
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-[140px] shrink-0 sm:w-44">
                  <div className="text-body font-medium">{row.label}</div>
                  <div className="text-body-sm tabular-nums text-muted">
                    {empty ? (
                      <span>under polling floor</span>
                    ) : (
                      `${formatPct(row.share)} of electorate, ${formatTurnout(row.turnout)} turnout`
                    )}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  {empty ? (
                    <div className="h-2.5 w-full rounded-full bg-card-border/50" />
                  ) : (
                    <StackedShareBar
                      you={row.you}
                      opponents={row.totalOpponents}
                      undecided={row.undecided}
                      colors={colors}
                      rivals={row.opponents}
                      title={`${row.label}: You ${formatPct(row.you)}, opponents ${formatPct(
                        row.totalOpponents
                      )}, undecided ${formatPct(row.undecided)}`}
                    />
                  )}
                </div>
                <div className="shrink-0 text-right sm:w-40">
                  {empty ? (
                    <span className="text-body-sm text-muted">No data</span>
                  ) : (
                    <div className="text-body-sm tabular-nums">
                      <span className="font-semibold" style={{ color: colors.you }}>
                        {formatPct(row.you)}
                      </span>
                      <span className="mx-1 text-muted">/</span>
                      <span className="font-semibold text-foreground">
                        {formatPct(row.bestOpponent)}
                      </span>
                      <span className="mx-1 text-muted">/</span>
                      <span className="font-semibold text-muted">{formatPct(row.undecided)}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-muted">
          <li>{youLabel}</li>
          <li className="inline-flex items-center gap-1.5">
            <Swatch color="#9CA3AF" />
            Opponents (party colors when known)
          </li>
          <li className="inline-flex items-center gap-1.5">
            <Swatch color="#64748b" />
            Undecided
          </li>
          <li className="ml-auto">Columns: you / best opponent / undecided</li>
        </ul>

        {/* Segment explorer */}
        <div className="space-y-4 border-t border-card-border pt-5">
          <h3 className="text-body-lg font-semibold">Segment explorer</h3>
          <div className="space-y-3">
            {dims.map((dim) => (
              <div key={dim} className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                <div className="shrink-0 pt-1.5 text-body-sm font-medium text-muted sm:w-24">
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
                        className={`rounded-md px-2.5 py-1 text-body-sm transition-colors focus:outline-none focus:ring-1 focus:ring-primary/50 ${
                          active
                            ? "bg-primary text-white"
                            : "bg-foreground/[0.06] text-foreground hover:bg-foreground/10"
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
              <div className="space-y-3">
                <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:flex sm:flex-wrap">
                  <div>
                    <dt className="text-body-sm text-muted">Share of electorate</dt>
                    <dd className="text-body-lg font-semibold tabular-nums">
                      {formatPct(segmentAggregate.share)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-body-sm text-muted">Turnout</dt>
                    <dd className="text-body-lg font-semibold tabular-nums">
                      {formatTurnout(segmentAggregate.turnout)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-body-sm text-muted">Your share of this segment</dt>
                    <dd
                      className="text-heading font-bold tabular-nums"
                      style={{ color: colors.you }}
                    >
                      {formatPct(segmentAggregate.you)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-body-sm text-muted">vs. your race-wide share</dt>
                    <dd className="flex items-baseline gap-1.5">
                      <span
                        className={`text-body-lg font-semibold tabular-nums ${
                          segmentAggregate.you - topline.you >= 0 ? "text-success" : "text-error"
                        }`}
                      >
                        {segmentAggregate.you >= topline.you ? "+" : ""}
                        {formatPct(segmentAggregate.you - topline.you)}
                      </span>
                      <span className="text-body-sm tabular-nums text-muted">
                        ({formatPct(topline.you)} race-wide)
                      </span>
                    </dd>
                  </div>
                  <div className="sm:ml-auto sm:text-right">
                    <dt className="text-body-sm text-muted">{t("uncertaintyBand")}</dt>
                    <dd>
                      <Tooltip content={t("uncertaintyExplanation")}>
                        <span className="cursor-help text-body-lg font-semibold tabular-nums">
                          ±{segmentUncertainty?.toFixed(1) ?? "-"} pts
                        </span>
                      </Tooltip>
                    </dd>
                  </div>
                </dl>
                <StackedShareBar
                  you={segmentAggregate.you}
                  opponents={segmentAggregate.totalOpponents}
                  undecided={segmentAggregate.undecided}
                  colors={colors}
                  rivals={segmentAggregate.opponents}
                  title={`Segment: You ${formatPct(segmentAggregate.you)}, opponents ${formatPct(
                    segmentAggregate.totalOpponents
                  )}, undecided ${formatPct(segmentAggregate.undecided)}`}
                />
                {/* Spelled out in the open: the reader should never have to
                    hover the bar to read what it splits into (ticket-1121). */}
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-body-sm text-muted">
                  <li className="inline-flex items-center gap-1.5">
                    <Swatch color={colors.you} />
                    You{" "}
                    <span className="font-medium tabular-nums text-foreground">
                      {formatPct(segmentAggregate.you)}
                    </span>
                  </li>
                  <li className="inline-flex items-center gap-1.5">
                    <Swatch color="#9CA3AF" />
                    Opponents{" "}
                    <span className="font-medium tabular-nums text-foreground">
                      {formatPct(segmentAggregate.totalOpponents)}
                    </span>
                  </li>
                  <li className="inline-flex items-center gap-1.5">
                    <Swatch color="#64748b" />
                    Undecided{" "}
                    <span className="font-medium tabular-nums text-foreground">
                      {formatPct(segmentAggregate.undecided)}
                    </span>
                  </li>
                </ul>
                <p className="text-body-sm text-muted">
                  Best opponent:{" "}
                  <span className="font-medium text-foreground">
                    {segmentAggregate.bestOpponentName || "None"}
                  </span>
                  . Margin:{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {formatPct(segmentAggregate.you - segmentAggregate.bestOpponent)}
                  </span>
                </p>
              </div>
            ) : (
              <p className="text-body text-muted">
                This combination is below the polling floor and has been pruned from the model.
              </p>
            )
          ) : (
            <p className="text-body-sm text-muted">
              Tap a chip in each row to explore a single cross-tab segment.
            </p>
          )}
        </div>

        {/* Full table */}
        {tableOpen && (
          <div className="overflow-hidden rounded-md border border-card-border">
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-body">
                <thead className="sticky top-0 z-10 bg-card border-b border-card-border">
                  <tr>
                    {tableColumns.map((col) => (
                      <th
                        key={col.key}
                        scope="col"
                        className={`px-3 py-2 text-left font-medium text-body-sm text-muted whitespace-nowrap ${
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
                      <td
                        className="px-3 py-2 text-right tabular-nums"
                        style={{ color: colors.you }}
                      >
                        {formatPct(cs?.you ?? 0)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums ">
                        {formatPct(bestOpp.share)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">
                        {formatPct(cs?.undecided ?? 0)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums font-medium ${
                          margin >= 0 ? "text-success" : "text-error"
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
    </section>
  );
}
