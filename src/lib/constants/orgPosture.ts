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

import { ORGANIZATION_CATEGORY_META, type OrganizationCategory } from "@/lib/constants/orgCategory";

export type AlertPosture = "reduced" | "standard" | "heightened" | "article5";

export const ALERT_POSTURES: AlertPosture[] = ["reduced", "standard", "heightened", "article5"];

export const DEFAULT_ALERT_POSTURE: AlertPosture = "standard";

export interface PostureMeta {
  label: string;
  blurb: string;
  /** UI tone for the badge/tile. */
  tone: "calm" | "neutral" | "warn" | "alarm";
  /**
   * Whether this posture binds members to defend each other. Honoured only by a
   * category whose `mutualDefence.byPosture` is set (see `orgCategory.ts`); the
   * rule itself lives in `mutualDefenceBasis` (`mutualDefence.ts`).
   */
  commitsMembers: boolean;
}

export const POSTURE_META: Record<AlertPosture, PostureMeta> = {
  reduced: {
    label: "Reduced",
    blurb: "Peace footing: lower readiness in exchange for a civil-liberties dividend.",
    tone: "calm",
    commitsMembers: false,
  },
  standard: {
    label: "Standard",
    blurb: "Normal posture: no alliance-wide effect.",
    tone: "neutral",
    commitsMembers: false,
  },
  heightened: {
    label: "Heightened",
    blurb: "Elevated alert: higher readiness at some cost to civil liberties.",
    tone: "warn",
    commitsMembers: false,
  },
  article5: {
    label: "Article 5",
    blurb:
      "Mutual defence. When a member is declared on, every other member with a government enters the war on its side. Also maximum readiness, at a civil-liberties and economic cost.",
    tone: "alarm",
    commitsMembers: true,
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

/**
 * How members of this organization enter a war, shown beside the posture so the
 * player reads the actual rule rather than guessing it from the posture's name.
 * The rule is `mutualDefenceBasis` (`mutualDefence.ts`); this is its copy, and
 * both read the same category and posture data so they cannot drift apart.
 */
export function postureWarEntryNote(params: {
  category: OrganizationCategory;
  posture: AlertPosture;
  /** The def's `standingMutualDefence`: a charter that binds without any posture. */
  standingMutualDefence?: boolean;
}): string {
  const { category, posture, standingMutualDefence } = params;
  const rules = ORGANIZATION_CATEGORY_META[category]?.mutualDefence;
  if (!rules?.byPosture) {
    return "This organization has no mutual-defence clause. Each member enters a war only through its own declaration of war.";
  }
  if (standingMutualDefence && rules.honoursStandingCharter) {
    return "This alliance's charter binds its members in any posture. When a member is declared on, every other member with a government enters the war on its side.";
  }
  const defence = POSTURE_META[posture]?.commitsMembers
    ? "At Article 5, a declaration of war on a member brings every other member with a government into the war on its side. Lowering the posture stops new entries but does not take anyone out of a war already joined."
    : "Only Article 5 commits members to defend each other. At this posture, a declaration of war on a member brings nobody else in.";
  return category === "bloc"
    ? `${defence} A bloc can also call its members into any war through a unanimous conflict-entry resolution.`
    : defence;
}

/** The alliance defense-spending pledge target, as a percent of GDP (NATO's 2%). */
export const DEFENSE_PLEDGE_TARGET_PCT = 2;
