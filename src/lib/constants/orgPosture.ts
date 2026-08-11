/**
 * Security-alliance **alert posture** — the signature flagship mechanic of a
 * `security`-category organization. Members vote (a `set_posture` resolution) to
 * raise or lower the alliance's collective posture, which applies a bounded,
 * member-wide metric effect every turn while set.
 *
 * Design (Phase 2B): the effect is **benefit-with-a-cost** — a higher posture
 * lifts military readiness but drags civil liberties (and, at Article 5, growth),
 * so an alliance can't just sit permanently maxed. `standard` is the parity
 * baseline (no effect). Deltas are bounded to the directive / synergy scale and
 * target node-backed metrics so the metric turn driver can apply them via
 * `targetNudges` (smoothed, not hard-set), exactly like directives.
 */

export type AlertPosture = "reduced" | "standard" | "heightened" | "article5";

export const ALERT_POSTURES: AlertPosture[] = ["reduced", "standard", "heightened", "article5"];

export const DEFAULT_ALERT_POSTURE: AlertPosture = "standard";

export interface PostureMeta {
  label: string;
  blurb: string;
  /** UI tone for the badge/tile. */
  tone: "calm" | "neutral" | "warn" | "alarm";
}

export const POSTURE_META: Record<AlertPosture, PostureMeta> = {
  reduced: {
    label: "Reduced",
    blurb: "Peace footing — lower readiness in exchange for a civil-liberties dividend.",
    tone: "calm",
  },
  standard: {
    label: "Standard",
    blurb: "Normal posture — no alliance-wide effect.",
    tone: "neutral",
  },
  heightened: {
    label: "Heightened",
    blurb: "Elevated alert — higher readiness at some cost to civil liberties.",
    tone: "warn",
  },
  article5: {
    label: "Article 5",
    blurb: "Collective defense — maximum readiness; civil-liberties and economic cost.",
    tone: "alarm",
  },
};

/**
 * Per-posture member-wide metric nudges (bare metricId → signed delta), applied
 * to every member while the posture is set. `standard` is empty (parity). All
 * metrics are node-backed (`governance.militaryReadiness`, `governance.civilLiberties`,
 * `economic.gdpGrowth`); deltas are bounded and directional (benefit-with-cost).
 */
export const POSTURE_EFFECTS: Record<AlertPosture, Record<string, number>> = {
  reduced: { militaryReadiness: -3, civilLiberties: 1.5 },
  standard: {},
  heightened: { militaryReadiness: 3, civilLiberties: -1.5 },
  article5: { militaryReadiness: 6, civilLiberties: -3, gdpGrowth: -0.4 },
};

/** Metric nudges a posture applies to each member (empty for `standard`). */
export function postureEffect(posture: AlertPosture): Record<string, number> {
  return POSTURE_EFFECTS[posture] ?? {};
}

export function isAlertPosture(value: string): value is AlertPosture {
  return (ALERT_POSTURES as string[]).includes(value);
}

/** The alliance defense-spending pledge target, as a percent of GDP (NATO's 2%). */
export const DEFENSE_PLEDGE_TARGET_PCT = 2;
