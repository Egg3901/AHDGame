"use client";

import { useEffect, useMemo, useState } from "react";
import { ShareBar } from "@/components/alignment/ShareBar";
import type { InfluenceTarget, OrgInfluenceView } from "@/lib/alignment/queries/orgInfluence";
import { formatShare, formatShareDelta, roundToShareGrid } from "@/lib/alignment/normalize";
import { useFundFormatter } from "../useFundFormatter";

export type SortMode = "cheapest" | "toJoin" | "flashpoint" | "members";

/**
 * What an empty list means, per mode. Only the narrowing modes can come back
 * empty, and a blank panel reads as a bug rather than as an answer.
 */
const EMPTY_COPY: Record<SortMode, string> = {
  cheapest: "There is no one left to court.",
  toJoin: "There is no one left to court.",
  flashpoint: "No flashpoint is open anywhere right now.",
  members: "This organisation has no members with a standing to defend yet.",
};

/** How many rows before the list asks to be expanded. */
const VISIBLE_LIMIT = 25;

/**
 * Absent data sorts last under every mode — never first, which would read as
 * "best" when it actually means "we could not price this at all".
 */
function nullsLast(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

const SORTS: Record<
  SortMode,
  {
    label: string;
    compare: (a: InfluenceTarget, b: InfluenceTarget) => number;
    /** Modes that narrow the roster rather than just reordering it. */
    filter?: (t: InfluenceTarget) => boolean;
  }
> = {
  cheapest: {
    label: "Cheapest to flip",
    compare: (a, b) => nullsLast(a.costToGate, b.costToGate),
  },
  toJoin: {
    label: "Closest to joining",
    // Fewest points from our own gate, regardless of what those points cost.
    // Distinct from "cheapest to flip", which multiplies the same distance by
    // the price: a nation two points away can be the dearest on the board, and
    // a bargain can still be thirty points out.
    //
    // Deliberately NOT the old "closest battles", which sorted by the gap
    // between the top two poles. That surfaced the most evenly contested
    // nations — a knife-edge fight in a country where we hold twenty percent
    // is not a country close to joining us.
    compare: (a, b) => b.ourShare - a.ourShare,
  },
  flashpoint: {
    label: "Under flashpoint",
    // Narrows, like the membership view: the question is "where is influence
    // worth most right now", and a nation with no flashpoint is not an answer
    // to it. Soonest to settle first — a crisis about to close is the one whose
    // raised ceiling you are about to lose.
    filter: (t) => t.crisis != null,
    compare: (a, b) => (a.crisis?.turnsRemaining ?? 0) - (b.crisis?.turnsRemaining ?? 0),
  },
  members: {
    label: "Already a member",
    // Retention, not acquisition — and the one mode that NARROWS the roster.
    // The other three answer "who should I go after", where hiding a nation
    // would hide an option; this one answers "who am I about to lose", and a
    // list padded with countries you have no relationship to cannot answer it.
    // Weakest hold first: the ally closest to walking out is the one to spend on.
    //
    // It replaced a per-turn "slipping away" trend that looked right and was
    // useless — on turn one nothing has a previous turn, so every trend was
    // null and the mode collapsed into an alphabetical list of non-members.
    filter: (t) => t.isMember,
    compare: (a, b) => a.ourShare - b.ourShare,
  },
};

/**
 * The roster of everyone you could court, ranked.
 *
 * Three of the four modes only reorder, so a nation you could court never
 * disappears because of how the list happens to be sorted. "Already a member"
 * is the deliberate exception: it answers "who am I about to lose", and a list
 * padded with countries you have no relationship to cannot answer that.
 *
 * The metric on each row changes with the active sort — a ranking whose number
 * is off-screen is a ranking the player has to take on trust.
 */
export function NationsInPlay({
  view,
  selectedEntityId,
  onSelect,
}: {
  view: OrgInfluenceView;
  selectedEntityId: string | null;
  onSelect: (entityId: string) => void;
}) {
  const fundAmount = useFundFormatter(view);
  const [mode, setMode] = useState<SortMode>("cheapest");
  const [expanded, setExpanded] = useState(false);

  const ranked = useMemo(() => {
    const { filter, compare } = SORTS[mode];
    return view.targets
      .filter((t) => filter?.(t) ?? true)
      .sort((a, b) => compare(a, b) || a.name.localeCompare(b.name));
  }, [view.targets, mode]);
  const shown = expanded ? ranked : ranked.slice(0, VISIBLE_LIMIT);

  // Open on the top-ranked nation. An empty dossier column on load would waste
  // half the screen and hide the very thing the ranking just worked out. Mount
  // only, deliberately: re-sorting reorders the list, and yanking the open
  // dossier away because the leader changed would be hostile.
  const topRankedId = ranked[0]?.entityId ?? null;
  useEffect(() => {
    if (selectedEntityId === null && topRankedId !== null) onSelect(topRankedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design; see above
  }, []);

  const joinShare = view.joinShare;
  const metric = (t: InfluenceTarget): string => {
    switch (mode) {
      case "cheapest":
        return t.costToGate === null ? "unpriced" : fundAmount(t.costToGate);
      case "toJoin": {
        const toGate = roundToShareGrid(joinShare - t.ourShare);
        return toGate <= 0
          ? `ours ${formatShare(t.ourShare)} · eligible`
          : `${formatShare(toGate)} to join`;
      }
      case "flashpoint":
        return t.crisis ? `${t.crisis.turnsRemaining} turns` : "—";
      case "members":
        return t.ourShareTrend === null
          ? `ours ${formatShare(t.ourShare)}`
          : `ours ${formatShare(t.ourShare)} (${formatShareDelta(t.ourShareTrend)})`;
    }
  };

  return (
    <section className="space-y-2 rounded-lg border border-card-border bg-card p-4">
      <h3 className="text-body-sm font-semibold text-foreground">Nations in play</h3>

      <div className="flex flex-wrap gap-1">
        {(Object.keys(SORTS) as SortMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`rounded px-2 py-1 text-body-xs transition-colors ${
              mode === m ? "bg-card-muted text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            {SORTS[m].label}
          </button>
        ))}
      </div>

      {ranked.length === 0 && <p className="text-body-sm text-muted">{EMPTY_COPY[mode]}</p>}

      <ul className="space-y-1">
        {shown.map((t) => (
          <li key={t.entityId}>
            <button
              type="button"
              data-testid="nation-row"
              onClick={() => onSelect(t.entityId)}
              aria-current={selectedEntityId === t.entityId}
              className={`w-full space-y-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                selectedEntityId === t.entityId
                  ? "border-primary bg-card-muted"
                  : "border-transparent hover:bg-card-muted"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-body-sm text-foreground">{t.name}</span>
                <span className="font-mono text-body-xs tabular-nums text-muted">{metric(t)}</span>
              </div>
              <ShareBar
                poles={view.poles}
                shares={t.shares}
                nonAligned={t.nonAligned}
                remainderLabel={view.remainderLabel}
              />
              <span className="text-body-xs text-muted">
                {t.status}
                {t.crisis ? " · flashpoint" : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {ranked.length > VISIBLE_LIMIT && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-body-xs text-muted hover:text-foreground"
        >
          Show all {ranked.length}
        </button>
      )}
    </section>
  );
}
