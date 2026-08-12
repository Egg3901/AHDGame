import type { OrganizationResolutionType } from "@/lib/db/types/internationalOrganization";

/**
 * Shared classification for every international organization (built-in and
 * custom), fixed at creation. Category is the single knob that drives an org's
 * resolution powers, flagship layout, and group label uniformly.
 */
export type OrganizationCategory = "political" | "economic" | "security" | "development" | "bloc";

/**
 * Every category, in DIRECTORY DISPLAY ORDER — the org list groups by this
 * array, so the sequence is meaningful, not incidental.
 *
 * Blocs lead: in a Cold War world they are the organisations the whole board is
 * about, and burying them under the forums and trade bodies buried the point.
 */
export const ORGANIZATION_CATEGORIES: OrganizationCategory[] = [
  "bloc",
  "political",
  "economic",
  "security",
  "development",
];

/**
 * Categories a player may found an organisation as.
 *
 * `bloc` is deliberately absent: it is a designation the world confers on the
 * two alliances that WERE the Cold War, not an archetype anyone can pick. A
 * player founding a "bloc" would be handing themselves patronage and coercion
 * powers a security alliance is explicitly denied.
 */
export const CREATABLE_ORGANIZATION_CATEGORIES: OrganizationCategory[] =
  ORGANIZATION_CATEGORIES.filter((c) => c !== "bloc");

/** Flagship template key the UI renders per category. */
export type FlagshipTemplate = "assembly" | "market" | "alliance" | "development";

export interface OrgCategoryMeta {
  label: string;
  /** Short flagship sub-tab label. */
  flagshipLabel: string;
  /** Flagship template the UI dispatches to. */
  flagship: FlagshipTemplate;
  /** One-line description for the create form. */
  blurb: string;
  /** Resolution types orgs of this category may pass (enforced in Phase 2). */
  powers: OrganizationResolutionType[];
}

export const ORGANIZATION_CATEGORY_META: Record<OrganizationCategory, OrgCategoryMeta> = {
  political: {
    label: "Political",
    flagshipLabel: "Assembly",
    flagship: "assembly",
    blurb: "A diplomatic forum — agency funding, joint statements, aid, and coordination.",
    // No FTAs: free trade is an economic/development instrument, not a diplomatic forum's.
    powers: ["fund_agency", "joint_statement", "aid_package"],
  },
  economic: {
    label: "Economic",
    flagshipLabel: "Single Market",
    flagship: "market",
    blurb: "A trade and economic bloc — directives, free-trade agreements, sanctions, and aid.",
    powers: ["directive", "free_trade_agreement", "sanctions", "aid_package"],
  },
  security: {
    label: "Security",
    flagshipLabel: "Alliance",
    flagship: "alliance",
    blurb: "A defense alliance — collective posture, pledges, and joint statements.",
    // A defense alliance has no trade/coercion instruments: no FTAs or sanctions —
    // just collective posture and joint statements (plus the baseline dues).
    powers: ["set_posture", "joint_statement"],
  },
  development: {
    label: "Development",
    flagshipLabel: "Development",
    flagship: "development",
    blurb: "A development bank — aid packages and trade access for members.",
    powers: ["aid_package", "free_trade_agreement"],
  },
  bloc: {
    label: "Bloc",
    flagshipLabel: "Alliance",
    // Still an alliance in every structural sense — the same flagship, plus the
    // instruments a superpower bloc actually used on the countries behind its
    // line.
    flagship: "alliance",
    blurb:
      "A Cold War bloc — a defense alliance that also pays and coerces the countries in its sphere.",
    // A security alliance's powers, plus patronage and coercion. The security
    // category is explicit that a defense pact has neither, and for an ordinary
    // alliance that holds. NATO and the Warsaw Pact were not ordinary alliances:
    // they were the instruments through which two superpowers ran their halves
    // of the world, and aid and sanctions are how that was actually done.
    //
    // `join_conflict` is granted here and NOWHERE else. Calling its members into a
    // war is the defining act of a bloc, and an ordinary defence pact — which is
    // what `security` models — does not get to make it.
    powers: ["set_posture", "joint_statement", "aid_package", "sanctions", "join_conflict"],
  },
};

/** Category applied to legacy custom orgs created before the field existed. */
export const DEFAULT_CUSTOM_ORG_CATEGORY: OrganizationCategory = "political";

/**
 * Resolution types whose effects are actually implemented and therefore
 * proposable today. Grows as Phase 2 lands each effect. A type must be both in
 * its org's category powers AND in this set to be tabled.
 */
export const IMPLEMENTED_RESOLUTION_TYPES: OrganizationResolutionType[] = [
  "free_trade_agreement",
  "sanctions",
  "aid_package",
  "set_dues",
  "directive",
  "joint_statement",
  "set_posture",
  "fund_agency",
  "join_conflict",
];

/**
 * Powers every category has regardless of archetype (baseline governance). Only
 * dues are universal — every org funds itself. Trade (FTA) is an economic/
 * development instrument granted per-category, not a universal power.
 */
const BASELINE_POWERS: OrganizationResolutionType[] = ["set_dues"];

/** True if a category may table a resolution of this type AND its effect exists. */
export function canTableResolutionType(
  category: OrganizationCategory,
  type: OrganizationResolutionType
): boolean {
  if (!IMPLEMENTED_RESOLUTION_TYPES.includes(type)) return false;
  return (
    BASELINE_POWERS.includes(type) || ORGANIZATION_CATEGORY_META[category].powers.includes(type)
  );
}

export function isOrganizationCategory(value: string): value is OrganizationCategory {
  return (ORGANIZATION_CATEGORIES as string[]).includes(value);
}

/** Resolution types an org of this category may pass. */
export function categoryPowers(category: OrganizationCategory): OrganizationResolutionType[] {
  return ORGANIZATION_CATEGORY_META[category].powers;
}

/**
 * Worlds in which the two alliances are blocs. Keyed on the PRESET, which never
 * changes, so a 1953 game still has blocs in its year 2050.
 */
export const BLOC_DESIGNATION_PRESETS: readonly string[] = ["1953-default", "1979-default"];

/** The two organisations that were the Cold War, and are designated as such. */
export const BLOC_DESIGNATED_ORG_IDS: readonly string[] = ["NATO", "WARSAW_PACT"];

/**
 * An organisation's EFFECTIVE category in a given world.
 *
 * NATO and the Warsaw Pact are `security` by archetype and `bloc` in a world
 * that began in the Cold War — they were not ordinary defence pacts but the
 * instruments two superpowers ran their spheres through, so they get the
 * patronage and coercion a security alliance is otherwise denied.
 *
 * NOT DERIVED FROM THE YEAR, and that is the whole point. `resolveAlignmentEra`
 * flips to post-cold-war at 1991, and hanging this off it would end the Cold War
 * on the calendar whether or not anyone had resolved it — a 1953 game still
 * being fought in 1992 would silently strip both blocs of half their tools. The
 * Cold War ends when the game says it has, not when the date says so. That is
 * the same principle the org window already follows: the Warsaw Pact carries a
 * `dissolvedYear` of 1991 and is still never force-dissolved while it has
 * members, because a running game outranks history.
 *
 * `coldWarEnded` is the seam for an ending nobody has built yet. Until something
 * sets it, it is always false and the designation simply holds.
 */
export function resolveOrgCategory(params: {
  organizationId: string;
  /** The archetype from the definition. */
  category: OrganizationCategory;
  /** The world's reset preset. */
  preset?: string;
  /** True once the Cold War has been resolved in-game. */
  coldWarEnded?: boolean;
}): OrganizationCategory {
  const { organizationId, category, preset, coldWarEnded } = params;
  if (coldWarEnded) return category;
  if (!preset || !BLOC_DESIGNATION_PRESETS.includes(preset)) return category;
  if (!BLOC_DESIGNATED_ORG_IDS.includes(organizationId)) return category;
  return "bloc";
}
