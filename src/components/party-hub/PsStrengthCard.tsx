"use client";

import {
  NATIONAL_PASSIVE_PS_PER_TURN,
  STATE_PASSIVE_PS_PER_TURN,
} from "@/lib/politicalStrength/strengthConstants";

/**
 * Political Strength reserve card. Replaces the legacy `+5 actions/hour ·
 * Cap: 100` display with the Phase 3 reserve model: current/cap, gain
 * breakdown, a fill indicator, and a help affordance explaining the
 * reserve / pressure mechanic.
 *
 * Used on both the National Party Hub and the State Party Hub. Both pages
 * are client components that already pass party / state-party data fetched
 * server-side.
 *
 * Acceptance: addresses Phase 3 §"Acceptance Criteria" — PS UI explains
 * the reserve/pressure model clearly enough that players can tell how full
 * their reserve is relative to the hard cap and why repeated same-state
 * actions get more expensive.
 */
export function PsStrengthCard({
  current,
  cap,
  scope,
  passiveGainPerTurn,
  treasuryGainPerTurn,
}: {
  current: number;
  cap: number;
  scope: "national" | "state";
  passiveGainPerTurn?: number;
  /** Optional — show the treasury component if known. Hidden when null. */
  treasuryGainPerTurn?: number | null;
}) {
  // Flat passive defaults to the scope's rate (national 20 / state 5).
  const passive =
    passiveGainPerTurn ??
    (scope === "national" ? NATIONAL_PASSIVE_PS_PER_TURN : STATE_PASSIVE_PS_PER_TURN);
  const pct = cap > 0 ? Math.min(1, current / cap) : 0;
  const bandLabel = bandLabelFor(pct);
  const bandColor = bandColorFor(pct);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted flex items-center gap-1.5">
          Political strength
          <PsHelpTooltip />
        </span>
        <span className="text-lg font-bold tabular-nums">
          {Math.round(current)} / {cap}
        </span>
      </div>
      <div
        className="relative h-2.5 overflow-hidden rounded-full bg-background"
        title={`${(pct * 100).toFixed(0)}% of maximum (${bandLabel})`}
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${bandColor}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <div className="mt-1.5 text-xs text-muted flex items-center justify-between gap-2">
        <span>
          +{passive} free per turn
          {treasuryGainPerTurn != null && treasuryGainPerTurn > 0
            ? ` + ${treasuryGainPerTurn.toFixed(2)} bought`
            : null}
        </span>
        <span className="text-[10px] uppercase tracking-wider opacity-70">
          {bandLabel} · {scope}
        </span>
      </div>
    </div>
  );
}

function bandLabelFor(pct: number): string {
  if (pct >= 1) return "full";
  if (pct >= 0.8) return "80-100% full";
  if (pct >= 0.5) return "50-80% full";
  return "under 50% full";
}

function bandColorFor(pct: number): string {
  if (pct >= 1) return "bg-warning";
  if (pct >= 0.8) return "bg-amber-500";
  if (pct >= 0.5) return "bg-blue-500";
  return "bg-primary";
}

function PsHelpTooltip() {
  return (
    <span
      className="cursor-help text-muted hover:text-foreground"
      title={[
        "Political Strength (PS) is the party's reserve for party actions: building Organization in states and campaigning for its candidates.",
        "",
        "How it grows:",
        "  • Free every turn: national parties +20, state parties +5",
        "  • Optional budget: the treasury buys up to 20 more per turn",
        "  • Growth stops at the maximum",
        "",
        "Building in the same state again and again costs more:",
        "  • Each build there adds 1 PS to the next one",
        "  • The extra cost fades by 3 per turn once you stop",
        "  • A build never costs more than 8 PS",
        "",
        "Building in Arizona doesn't raise the cost in California.",
      ].join("\n")}
    >
      ⓘ
    </span>
  );
}
