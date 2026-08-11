"use client";

import { useMemo, useState } from "react";
import { formatShare, formatShareDelta } from "@/lib/alignment/normalize";
import { ALIGNMENT_GATES } from "@/lib/constants/alignmentEras";
import type { AlignmentStatus } from "@/lib/alignment/project";
import type { LedgerRow, WorldAlignmentView } from "@/lib/alignment/queries/worldAlignment";
import { ShareBar, POLE_TEXT } from "@/components/alignment/ShareBar";
import { CrisisDesk } from "./components/CrisisDesk";

/** Band label + the semantic token it renders in. */
const BAND: Record<AlignmentStatus, { label: string; text: string }> = {
  player: { label: "Player", text: "text-gold" },
  locked: { label: "Locked", text: "text-muted" },
  loyal: { label: "Loyal", text: "text-success" },
  "defection-risk": { label: "Defection risk", text: "text-error" },
  eligible: { label: "Eligible", text: "text-info" },
  contested: { label: "Contested", text: "text-warning" },
  "non-aligned": { label: "Non-aligned", text: "text-muted" },
};

type Filter = "all" | "in-play" | "non-aligned" | string;

export function ColdWarLedgerClient({ view }: { view: WorldAlignmentView }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const tallies = useMemo(() => {
    const byPole = new Map<string, number>();
    let undecided = 0;
    let inPlay = 0;
    for (const row of view.rows) {
      if (row.status === "non-aligned") undecided++;
      else if (row.topPoleId) byPole.set(row.topPoleId, (byPole.get(row.topPoleId) ?? 0) + 1);
      if (row.status === "contested" || row.status === "non-aligned") inPlay++;
    }
    return { byPole, undecided, inPlay };
  }, [view.rows]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return view.rows.filter((row) => {
      if (filter === "in-play" && row.status !== "contested" && row.status !== "non-aligned")
        return false;
      if (filter === "non-aligned" && row.status !== "non-aligned") return false;
      if (filter !== "all" && filter !== "in-play" && filter !== "non-aligned") {
        if (row.topPoleId !== filter) return false;
      }
      if (q && !row.name.toLowerCase().includes(q) && !row.entityId.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [view.rows, filter, query]);

  const chips: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    ...view.poles.map((p) => ({ key: p.id as Filter, label: p.label })),
    { key: "non-aligned", label: "Non-aligned" },
    { key: "in-play", label: "In play" },
  ];

  if (!view.enabled) {
    return (
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <Header view={view} />
        <CrisisDesk crises={view.crises} />
        <div className="rounded-lg border border-card-border bg-card p-6 text-center shadow-card">
          <p className="text-body text-muted">
            Bloc alignment is switched off for this world. An administrator can enable it from
            Feature Gates; opening positions are already seeded, so the ledger fills in as soon as
            it is on.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Header view={view} />

      {/* Summary tiles — one per pole, then the uncommitted and the contested. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {view.poles.map((pole) => (
          <div
            key={pole.id}
            className="rounded-lg border border-card-border bg-card p-3 shadow-card"
          >
            <div className="text-body-xs uppercase tracking-wide text-muted">{pole.label}</div>
            <div className={`font-mono text-heading tabular-nums ${POLE_TEXT[pole.accentToken]}`}>
              {tallies.byPole.get(pole.id) ?? 0}
            </div>
            <div className="text-body-xs text-muted">nations leading</div>
          </div>
        ))}
        <div className="rounded-lg border border-card-border bg-card p-3 shadow-card">
          <div className="text-body-xs uppercase tracking-wide text-muted">Non-aligned</div>
          <div className="font-mono text-heading tabular-nums text-muted">{tallies.undecided}</div>
          <div className="text-body-xs text-muted">lead within {ALIGNMENT_GATES.nonAligned}</div>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-3 shadow-card">
          <div className="text-body-xs uppercase tracking-wide text-muted">In play</div>
          <div className="font-mono text-heading tabular-nums text-warning">{tallies.inPlay}</div>
          <div className="text-body-xs text-muted">contested or non-aligned</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            aria-pressed={filter === chip.key}
            onClick={() => setFilter(chip.key)}
            className={`rounded-full border px-3 py-1 text-body-sm transition-colors ${
              filter === chip.key
                ? "border-muted bg-card-elevated text-foreground"
                : "border-card-border text-muted hover:text-foreground"
            }`}
          >
            {chip.label}
          </button>
        ))}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a nation…"
          aria-label="Find a nation"
          className="ml-auto rounded-md border border-card-border bg-card px-3 py-1 text-body-sm text-foreground"
        />
      </div>

      {/* Ledger */}
      <div className="rounded-lg border border-card-border bg-card shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-full border-collapse md:min-w-[40rem]">
            <thead>
              <tr className="border-b border-card-border">
                <Th>Nation</Th>
                <Th className="w-20 sm:w-1/3">Standing</Th>
                {view.poles.map((p) => (
                  <Th key={p.id} numeric className="hidden md:table-cell">
                    {p.shortLabel}
                  </Th>
                ))}
                <Th numeric className="hidden md:table-cell">
                  {view.remainderLabel}
                </Th>
                {view.poles.length === 2 && (
                  <Th numeric className="hidden lg:table-cell">
                    Axis
                  </Th>
                )}
                <Th numeric className="hidden md:table-cell">
                  Lead
                </Th>
                <Th numeric className="hidden md:table-cell">
                  Trend
                </Th>
                <Th>Band</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row key={row.entityId} row={row} view={view} />
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <p className="p-6 text-center text-body-sm text-muted">
            {view.rows.length === 0
              ? "No alignment has been recorded for this world yet."
              : "No nation matches those filters."}
          </p>
        )}
      </div>

      <p className="text-body-sm text-muted">
        Bands compare a nation&rsquo;s <span className="text-foreground">lead</span> — its leading
        bloc&rsquo;s share minus the runner-up&rsquo;s — against this era&rsquo;s gate of{" "}
        {view.joinGate}. A nation whose lead sits within {ALIGNMENT_GATES.nonAligned} reads as
        non-aligned, whatever its largest share.
      </p>
    </main>
  );
}

function Header({ view }: { view: WorldAlignmentView }) {
  return (
    <header className="space-y-1">
      <p className="text-body-xs uppercase tracking-wide text-muted">
        {view.year} · {view.poles.length} blocs · gate {view.joinGate}
      </p>
      <h1 className="text-display font-semibold">Cold War Ledger</h1>
      <p className="max-w-prose text-body text-muted">
        Where every nation stands between the blocs. Each holds a share per bloc plus an uncommitted
        remainder, always totalling 100.
      </p>
    </header>
  );
}

function Th({
  children,
  numeric,
  className,
}: {
  children: React.ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-2 py-2 text-body-xs uppercase tracking-wide text-muted sm:px-3 ${
        numeric ? "text-right" : "text-left"
      } ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

function Row({ row, view }: { row: LedgerRow; view: WorldAlignmentView }) {
  const band = BAND[row.status];
  return (
    <tr className="border-b border-card-border/50 last:border-0">
      <td className="px-2 py-2 text-body-sm font-medium text-foreground sm:px-3">
        {row.name}
        {!row.isPlayable && (
          <span className="ml-2 whitespace-nowrap text-body-xs font-normal text-muted">
            not playable
          </span>
        )}
      </td>
      <td className="px-2 py-2 sm:px-3">
        <ShareBar
          poles={view.poles}
          shares={row.shares}
          nonAligned={row.nonAligned}
          remainderLabel={view.remainderLabel}
        />
      </td>
      {view.poles.map((p) => (
        <td
          key={p.id}
          className="hidden px-3 py-2 text-right font-mono text-body-sm tabular-nums md:table-cell"
        >
          {formatShare(row.shares[p.id] ?? 0)}
        </td>
      ))}
      <td className="hidden px-3 py-2 text-right font-mono text-body-sm tabular-nums text-muted md:table-cell">
        {formatShare(row.nonAligned)}
      </td>
      {view.poles.length === 2 && (
        <td className="hidden px-3 py-2 text-right font-mono text-body-sm tabular-nums lg:table-cell">
          {row.axis == null ? "—" : formatShareDelta(row.axis)}
        </td>
      )}
      <td className="hidden px-2 py-2 text-right font-mono text-body-sm tabular-nums sm:px-3 md:table-cell">
        {formatShare(row.lead)}
      </td>
      <td className="hidden px-3 py-2 text-right font-mono text-body-sm tabular-nums text-muted md:table-cell">
        {row.trend == null ? "—" : formatShareDelta(row.trend)}
      </td>
      <td className={`px-2 py-2 text-body-sm sm:px-3 ${band.text}`}>{band.label}</td>
    </tr>
  );
}
