import type { StatePartyOrg, PoliticalParty } from "@/lib/db/types";

/**
 * Defense constants for default-party anti-decay protection.
 *
 * NOTE — as of the 2026-05-20 cap-cleanup pass, **no per-party Org floor
 * is enforced at runtime**. Any party can be chipped from any Org level
 * all the way to 0 via the Build Org rival-poach. The tier bands and helpers below are
 * retained as inert scaffolding for analytics / future re-introduction
 * of a tunable defense system; nothing on the action paths reads them.
 *
 * See [docs/design/political-system-reg-support.md §6](../../../../docs/design/political-system-reg-support.md)
 * for the original design (tier bands, calibration). The pool-sum
 * invariant + 0-clamp at action time are the only structural ceilings.
 */

/** Tier classification of a state by the home-default party's Org%. */
export type DefenseTier = "strong" | "solid" | "lean" | "competitive";

/**
 * Tier-scaled minimum Org% floor — INERT after 2026-05-20.
 *
 * Originally enforced as a per-party floor at Contest time; no longer
 * read by any action path. Kept as documentation of the historical band
 * thresholds (and for any analytics dashboard that wants to surface
 * "what tier is this state at?").
 */
export const DEFENSE_ORG_FLOOR: Record<DefenseTier, number> = {
  strong: 18,
  solid: 14,
  lean: 10,
  competitive: 0,
} as const;

/**
 * Capture-rate multiplier applied to rival actions when the targeted
 * default party has no active human chair. Restored to `1.0` once a human
 * chair is seated.
 *
 * Applies to Org capture, Reg poach, GOTV, Suppression — every external
 * action whose primary effect is reducing the targeted party's metrics.
 * Does NOT apply to non-targeted effects (e.g. building Org for self by
 * pulling from `Unaffiliated Org`).
 */
export const DEFENSE_UNMANNED_CAPTURE_MULTIPLIER = 0.5 as const;

/**
 * Derive the defense tier for a state from the home default party's Org%.
 *
 * Bands are inclusive on the lower bound (28, 32, 36 belong to the higher
 * tier each: Lean ≥ 28, Solid ≥ 32, Strong ≥ 36).
 */
export function deriveDefenseTier(homeDefaultOrgPct: number): DefenseTier {
  if (homeDefaultOrgPct >= 36) return "strong";
  if (homeDefaultOrgPct >= 32) return "solid";
  if (homeDefaultOrgPct >= 28) return "lean";
  return "competitive";
}

/**
 * Resolve the home default party for a state. Returns the highest-Org
 * party in that state with `politicalParties.isDefault === true`, or
 * `null` if no default party has any presence in this state.
 *
 * In countries where multiple default parties exist (UK Lab + Con; DE
 * SPD + CDU/CSU + Greens + FDP; JP LDP + opposition), this picks
 * whichever default has the highest Org% in this specific state.
 *
 * Tie-breaking: alphabetically lowest `partyId` (deterministic).
 *
 * NOTE — `partyId` mapping: `StatePartyOrg.partyId` is the party's
 * `sequentialId` cast to string, NOT `_id` (the design doc sketch shows
 * `String(p._id)` but the codebase indexes by `sequentialId` per
 * `getRegionPartyOrg` / `getRegionOfficials`; same fix as Phase 1 Pass 1).
 */
export function resolveHomeDefaultParty(
  parties: PoliticalParty[],
  rows: StatePartyOrg[]
): { partyId: string; orgPct: number } | null {
  const defaults = new Set(parties.filter((p) => p.isDefault).map((p) => String(p.sequentialId)));
  let best: { partyId: string; orgPct: number } | null = null;
  for (const r of rows) {
    if (!defaults.has(r.partyId)) continue;
    const orgPct = r.organization ?? 0;
    if (
      best === null ||
      orgPct > best.orgPct ||
      (orgPct === best.orgPct && r.partyId < best.partyId)
    ) {
      best = { partyId: r.partyId, orgPct };
    }
  }
  return best;
}

/** Convenience: resolve tier + floor in one call. */
export function resolveDefenseFloor(
  parties: PoliticalParty[],
  rows: StatePartyOrg[]
): { partyId: string; tier: DefenseTier; floor: number } | null {
  const home = resolveHomeDefaultParty(parties, rows);
  if (home === null) return null;
  const tier = deriveDefenseTier(home.orgPct);
  return { partyId: home.partyId, tier, floor: DEFENSE_ORG_FLOOR[tier] };
}

/**
 * Predicate: is the targeted party an unmanned default?
 *
 * "Unmanned" means the chair seat is not held by an active human player
 * (vacant, NPP-held, or banned/inactive user). The `isActiveHumanChair`
 * callback abstracts the chairId → user lookup so this constants module
 * doesn't depend on Character / User collection access patterns.
 */
export async function isUnmannedDefault(
  party: PoliticalParty,
  isActiveHumanChair: (chairId: PoliticalParty["chairId"]) => Promise<boolean>
): Promise<boolean> {
  if (!party.isDefault) return false;
  return !(await isActiveHumanChair(party.chairId));
}
