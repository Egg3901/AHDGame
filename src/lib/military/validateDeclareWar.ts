import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { findWarBetween } from "@/lib/military/findWarBetween";
import { activeTruceExpiry } from "@/lib/military/truce";
import { isSelectableWarGoal, WAR_DECLARATION_COOLDOWN_TURNS } from "@/lib/military/warGoals";
import { isCountryEnabledForPlayers } from "@/lib/countryAccess";
import type { Bill } from "@/lib/db/types/legislation";

export type DeclareWarCheck = { ok: true } | { ok: false; status: number; error: string };

/**
 * Every check a war declaration must clear, in ONE place.
 *
 * Both proposal paths call this. `cabinet-bills` — the route the executive actually
 * uses — builds its provision array directly and never runs `validateBillProvisions`,
 * so keeping these checks only in that validator would leave every one of them
 * unenforced on the path players take. The conquest reservation in particular is
 * only meaningful if it holds here.
 *
 * Spec: docs/superpowers/specs/2026-08-04-war-declaration-legislation-design.md
 */
export async function validateDeclareWar(
  db: Db,
  p: { targetCountry?: string; warGoal?: string },
  sourceCountry: CountryId,
  currentTurn?: number
): Promise<DeclareWarCheck> {
  const target = p.targetCountry;
  if (!target || !COUNTRY_CONFIGS[target as CountryId]) {
    return { ok: false, status: 400, error: "That country does not exist." };
  }
  if (target === sourceCountry) {
    return { ok: false, status: 400, error: "A country cannot declare war on itself." };
  }
  // Only player-enabled countries can be fought. COUNTRY_CONFIGS also holds
  // sub-national entities (SCO, WAL) and countries an admin has not switched on, and
  // accepting those would open a war nobody can play the other side of. Read from
  // countryGameStates so an admin flip takes effect with no redeploy.
  if (!(await isCountryEnabledForPlayers(db, target as CountryId))) {
    return {
      ok: false,
      status: 400,
      error: "That country is not open to players and cannot be declared war on.",
    };
  }
  if (!p.warGoal || !isSelectableWarGoal(p.warGoal)) {
    return { ok: false, status: 400, error: "That war goal is not yet available." };
  }

  // ONE war at a time between the same two countries. A live conflict is NOT itself
  // a rejection: one the declarer is not opposed in is exactly the join case, and
  // refusing on the mere existence of a conflict would make joining unreachable.
  if (await findWarBetween(db, sourceCountry, target as CountryId)) {
    return { ok: false, status: 400, error: "You are already at war with that country." };
  }
  // One declaration per country per cooldown, counted from the last PROPOSAL —
  // a declaration the chambers rejected still spent the country's capital, so
  // re-filing it immediately would make the vote meaningless.
  if (currentTurn != null) {
    const last = await db
      .collection<Bill>("bills")
      .find({ countryId: sourceCountry, "provisions.type": "declare_war" })
      .sort({ proposedTurn: -1 })
      .limit(1)
      .toArray();
    const lastTurn = last[0]?.proposedTurn;
    if (lastTurn != null && currentTurn - lastTurn < WAR_DECLARATION_COOLDOWN_TURNS) {
      const wait = WAR_DECLARATION_COOLDOWN_TURNS - (currentTurn - lastTurn);
      return {
        ok: false,
        status: 429,
        error: `Your last declaration of war was too recent. ${wait} more turn${wait === 1 ? "" : "s"} must pass.`,
      };
    }
  }

  // A truce is a per-PAIR bar, distinct from the cooldown above: a country under a
  // truce with CN may still declare on someone else once its cooldown lapses, it
  // simply cannot re-open that particular war. Named with the lapse turn so it is
  // not discovered by being refused.
  if (currentTurn != null) {
    const lapses = await activeTruceExpiry(db, sourceCountry, target as CountryId, currentTurn);
    if (lapses != null) {
      return {
        ok: false,
        status: 400,
        error: `A truce with that country holds until turn ${lapses}.`,
      };
    }
  }

  return { ok: true };
}
