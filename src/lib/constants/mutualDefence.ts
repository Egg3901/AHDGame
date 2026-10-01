import { ORGANIZATION_CATEGORY_META, type OrganizationCategory } from "@/lib/constants/orgCategory";
import { POSTURE_META, type AlertPosture } from "@/lib/constants/orgPosture";

/**
 * Why an organization binds its members to defend each other right now.
 *
 * - `charter`: the def carries `standingMutualDefence` and its effective category
 *   honours a standing charter (NATO and the Warsaw Pact in a Cold War world).
 * - `posture`: the members voted a posture that commits them (Article 5), and the
 *   category honours posture commitments (Security and Bloc).
 */
export type MutualDefenceBasis = "charter" | "posture";

/**
 * THE mutual-defence rule, for every organization, built-in or custom.
 *
 * Pure and data-driven: it reads the category's `mutualDefence` switches, the
 * posture's `commitsMembers` flag and the def's `standingMutualDefence`, and names
 * no organization. NATO and the Warsaw Pact are not a special case here; they are
 * two defs that carry a standing charter. Every war-entry path (declaration-time
 * enrolment and the per-turn reconciliation in `treatyDefence.ts`) and every piece
 * of copy that describes the rule (`postureWarEntryNote`) reads the same inputs.
 *
 * `category` must be the EFFECTIVE category (`resolveOrgCategory`), not the
 * archetype: NATO is `security` by archetype and `bloc` only in a Cold War world.
 */
export function mutualDefenceBasis(params: {
  category: OrganizationCategory;
  posture?: AlertPosture | null;
  standingMutualDefence?: boolean;
}): MutualDefenceBasis | null {
  const rules = ORGANIZATION_CATEGORY_META[params.category]?.mutualDefence;
  if (!rules) return null;
  if (rules.honoursStandingCharter && params.standingMutualDefence) return "charter";
  if (rules.byPosture && params.posture && POSTURE_META[params.posture]?.commitsMembers) {
    return "posture";
  }
  return null;
}

/** Postures that commit members, for a narrow database read. */
export function committingPostures(): AlertPosture[] {
  return (Object.keys(POSTURE_META) as AlertPosture[]).filter(
    (p) => POSTURE_META[p].commitsMembers
  );
}
