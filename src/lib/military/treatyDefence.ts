import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { GameState } from "@/lib/db/types/gameState";
import { getGameStateCollection } from "@/lib/db/collections";
import { BLOC_DESIGNATED_ORG_IDS, resolveOrgCategory } from "@/lib/constants/orgCategory";
import {
  INTERNATIONAL_ORGANIZATIONS,
  type InternationalOrganizationId,
} from "@/lib/constants/internationalOrganizations";
import { isMember } from "@/lib/internationalOrganizations/service";
import { votingMembers } from "@/lib/internationalOrganizations/orgMembership";

/**
 * Enforced mutual defence: who a treaty drags into a war, and under which treaty.
 *
 * NATO and the Warsaw Pact carry collective-defence charters ("an armed attack against
 * any member shall be considered an attack against them all") that the engine did not
 * honour — `declareWar` opened a war between exactly two countries, and no code on the
 * war path ever read alliance membership. `alliesOf` existed in `allianceBar.ts` and its
 * only consumer was the truces route.
 *
 * DEFENSIVE ONLY, and that is the whole shape of it. The trigger is a declaration
 * against a member, never "a member is at war", which is what makes chaining impossible
 * by construction: an ally pulled in to defend has not declared on anybody, so it never
 * becomes a victim whose own alliance fires. No cascade guard is needed because no
 * cascade can start.
 *
 * Spec: docs/superpowers/specs/2026-08-24-enforced-treaty-defence-design.md
 */
export interface TreatyDefender {
  countryId: CountryId;
  /** The alliance that binds this country to the defence. */
  organizationId: string;
}

export interface ResolveTreatyDefendersParams {
  /** The country being declared on. Membership is read for THIS country only. */
  defender: CountryId;
  /** The declaring country, always excluded from the result. */
  declarer: CountryId;
  /**
   * The live conflict being joined, when there is one. Countries already on either
   * roster are skipped: `joinSide` is idempotent, but a second treaty entry for a
   * country already fighting would give the peace bar a duplicate to reason about.
   */
  conflict?: Pick<ConflictDoc, "sideA" | "sideB">;
}

export async function resolveTreatyDefenders(
  db: Db,
  params: ResolveTreatyDefendersParams
): Promise<TreatyDefender[]> {
  // ONE game-state read for all three facts. `service.loadCategoryContext` resolves the
  // designation context alone and is private besides; `conflictsEnabled` has to be read
  // here regardless, so reading all three together costs one round trip instead of two.
  const gs = await (
    await getGameStateCollection(db)
  ).findOne(
    { _id: "current" },
    { projection: { conflictsEnabled: 1, preset: 1, coldWarEndedTurn: 1 } }
  );
  if (!gs?.conflictsEnabled) return [];

  const preset = (gs as Partial<GameState>).preset;
  const coldWarEnded = (gs as Partial<GameState>).coldWarEndedTurn != null;

  // Already fighting, or the two principals. `declarer` cannot normally share the
  // defender's bloc (the alliance bar refuses that declaration at proposal AND at
  // enactment), but excluding it here costs nothing and means this function is correct
  // on its own terms rather than correct because something upstream held.
  const excluded = new Set<string>([
    params.defender,
    params.declarer,
    ...((params.conflict?.sideA.countries ?? []) as string[]),
    ...((params.conflict?.sideB.countries ?? []) as string[]),
  ]);

  const out: TreatyDefender[] = [];
  const seen = new Set<string>();

  // Iterating the designated ids rather than "every org the defender belongs to" is
  // exactly equivalent: `resolveOrgCategory` returns the archetype unchanged for every
  // id outside this list, so no other organisation can ever resolve to "bloc".
  for (const organizationId of BLOC_DESIGNATED_ORG_IDS) {
    const def =
      INTERNATIONAL_ORGANIZATIONS[organizationId as keyof typeof INTERNATIONAL_ORGANIZATIONS];
    if (!def) continue;
    const category = resolveOrgCategory({
      organizationId,
      category: def.category,
      preset,
      coldWarEnded,
    });
    if (category !== "bloc") continue;
    if (!(await isMember(db, organizationId as InternationalOrganizationId, params.defender))) {
      continue;
    }
    // Player-enabled members only: a country with no player and no legislature is a
    // member in every other sense but does not march.
    for (const countryId of await votingMembers(db, organizationId)) {
      if (excluded.has(countryId) || seen.has(countryId)) continue;
      seen.add(countryId);
      out.push({ countryId, organizationId });
    }
  }
  return out;
}
