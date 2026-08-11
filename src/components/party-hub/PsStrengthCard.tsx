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
          Political Strength
          <PsHelpTooltip />
        </span>
        <span className="text-lg font-bold tabular-nums">
          {Math.round(current)} / {cap}
        </span>
      </div>
      <div
        className="relative h-2.5 overflow-hidden rounded-full bg-background"
        title={`${(pct * 100).toFixed(0)}% of cap — ${bandLabel}`}
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${bandColor}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <div className="mt-1.5 text-xs text-muted flex items-center justify-between gap-2">
        <span>
          +{passive} passive/turn
          {treasuryGainPerTurn != null && treasuryGainPerTurn > 0
            ? ` + ${treasuryGainPerTurn.toFixed(2)} spend`
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
  if (pct >= 1) return "at cap";
  if (pct >= 0.8) return "80–100% of cap";
  if (pct >= 0.5) return "50–80% of cap";
  return "under 50% of cap";
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
        "Political Strength (PS) is a reserve, not a flat-spend wallet.",
        "",
        "Reserve growth:",
        "  • Flat passive every turn (national +20, state +5) — no treasury needed",
        "  • Optional chair-set spend: debits treasury, up to +20 PS/turn",
        "  • Both convert at full rate up to the hard cap — only the cap limits growth",
        "",
        "Repeated PS actions in the SAME state escalate cost:",
        "  • +1 to effective cost per spend",
        "  • Pressure decays −3/turn (so the ladder dissipates if you stop)",
        "  • Caps at +8 effective cost",
        "",
        "Acting in Arizona doesn't raise the cost in California.",
      ].join("\n")}
    >
      ⓘ
    </span>
  );
}
