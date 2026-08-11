"use client";

/**
 * Public-facing regime-stability panel for one-party-state countries.
 *
 * Only renders content when the country is currently OPS (the API
 * short-circuits to `{ active: false }` otherwise). Shows the
 * popular-legitimacy band label — never the raw number — plus the
 * current escalation stage, an under-strain warning at Stage 3+, and
 * the last three stage transitions for context.
 *
 * Info-asymmetry rule: no raw scalars cross this surface. The
 * ruling-party-leader's Regime Health tab (Task 7.2) is the only
 * place the diagnostic value is visible.
 */
import { useEffect, useState } from "react";

interface Transition {
  turn: number;
  from: string;
  to: string;
  at: string;
}

interface RegimePublic {
  active: true;
  band: "strong" | "discontent" | "crisis" | "collapsing";
  stage: "stable" | "discontent" | "crisis" | "internalChallenge" | "collapse";
  underStrain: boolean;
  recentTransitions: Transition[];
}

type ApiResponse = RegimePublic | { active: false };

interface Props {
  countryCode: string;
}

const BAND_STYLE: Record<RegimePublic["band"], { label: string; className: string }> = {
  strong: { label: "Strong public support", className: "border-emerald-500/40 bg-emerald-500/5" },
  discontent: {
    label: "Public discontent visible",
    className: "border-amber-500/40 bg-amber-500/5",
  },
  crisis: { label: "Crisis-level legitimacy", className: "border-rose-500/40 bg-rose-500/5" },
  collapsing: {
    label: "Regime legitimacy collapsing",
    className: "border-rose-700/50 bg-rose-600/10",
  },
};

const STAGE_LABEL: Record<RegimePublic["stage"], string> = {
  stable: "Stable",
  discontent: "Public discontent",
  crisis: "Mass unrest",
  internalChallenge: "Internal party challenge",
  collapse: "Regime in collapse",
};

/**
 * Severity coloring for the stage chip. Mirrors the leader-only tab's
 * STAGE_VISUALS palette so both surfaces speak the same color
 * language. The chip stays severity-coded even when the popular band
 * disagrees (e.g. admin force-stage to Crisis with healthy scalars).
 */
const STAGE_CHIP_STYLE: Record<RegimePublic["stage"], string> = {
  stable: "border-card-border bg-card/60 text-foreground",
  discontent: "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  crisis: "border-orange-500/50 bg-orange-500/15 text-orange-700 dark:text-orange-300",
  internalChallenge: "border-rose-500/60 bg-rose-500/15 text-rose-700 dark:text-rose-300",
  collapse: "border-rose-700/70 bg-rose-700/20 text-rose-700 dark:text-rose-300 font-semibold",
};

/**
 * In-character flavor text shown under the stage chip. Deliberately
 * timeless — no specific years, no "this week", no "current rate" —
 * so the text reads correctly regardless of game start date or how
 * many turns have elapsed.
 */
const STAGE_BLURB: Record<RegimePublic["stage"], string | null> = {
  stable: null,
  discontent:
    "Whispers grow louder in workers' canteens and university lecture halls. The official press dismisses them; private conversations do not.",
  crisis:
    "Protests spill from the streets into the squares. Editorials abroad sharpen their tone; allies at home grow quieter, calculating.",
  internalChallenge:
    "A faction within the ruling party has broken openly with the leadership. Cadres count loyalties; the state's grip on its own house is no longer assured.",
  collapse:
    "The regime's authority has fractured. Provincial offices act on their own initiative; the question is no longer whether change comes, but on whose terms.",
};

export function RegimeStabilityPanel({ countryCode }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/country/${countryCode}/regime/public`);
        if (!res.ok) return;
        const body = (await res.json()) as ApiResponse;
        if (!cancelled) setData(body);
      } catch {
        /* swallow; the panel just doesn't render */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [countryCode]);

  if (!data || data.active === false) return null;

  const bandStyle = BAND_STYLE[data.band];

  return (
    <div
      data-testid="regime-stability-panel"
      className={`rounded-lg border ${bandStyle.className} p-4`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Regime Stability</h3>
          <p className="mt-0.5 text-xs text-muted" data-testid="regime-band-label">
            {bandStyle.label}
          </p>
        </div>
        {data.stage !== "stable" && (
          <span
            className={`rounded-full border px-2 py-0.5 text-xs ${STAGE_CHIP_STYLE[data.stage]}`}
            data-testid="regime-stage-label"
          >
            {STAGE_LABEL[data.stage]}
          </span>
        )}
      </div>

      {STAGE_BLURB[data.stage] && (
        <p className="mt-3 text-xs italic text-foreground/75" data-testid="regime-stage-blurb">
          {STAGE_BLURB[data.stage]}
        </p>
      )}

      {data.underStrain && (
        <p
          className="mt-3 text-xs font-medium text-rose-600 dark:text-rose-400"
          data-testid="regime-under-strain"
        >
          Regime under strain
        </p>
      )}

      {data.recentTransitions.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-muted" data-testid="regime-recent-transitions">
          {data.recentTransitions.map((t) => (
            <li key={`${t.turn}-${t.from}-${t.to}`}>
              {STAGE_LABEL[t.from as RegimePublic["stage"]] ?? t.from} →{" "}
              <span className="text-foreground">
                {STAGE_LABEL[t.to as RegimePublic["stage"]] ?? t.to}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
