/**
 * Reform-action cooldown read / write helpers.
 *
 * The Phase-5 liberalization menu reads this layer to know whether a
 * reform is currently available, and writes back here right after the
 * reform's other side effects fire. Every helper goes through
 * `getCountryState` / `updateCountryState` so the per-Db cache stays
 * coherent.
 *
 * The `legalizeParty` action is partyId-scoped — every banned party has
 * its own independent 168-turn cooldown. The rest of the actions use a
 * single per-country turn-of-next-availability scalar.
 * `constitutionalAmendment` is a one-time action stored as `"used"`.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryState, updateCountryState } from "@/lib/countryState";
import type { ReformCooldownsMap } from "@/lib/db/types/countryState";

export type ReformActionId =
  | "legalizeParty"
  | "reduceVoteMultipliers"
  | "holdHonestByElection"
  | "anticorruptionPurge"
  | "constitutionalAmendment";

export interface CooldownScope {
  /** Required for `legalizeParty`; the partyId being legalised. */
  partyId?: number;
}

/**
 * Is the reform action currently usable in this country?
 *
 *   - `constitutionalAmendment` returns `false` once it's been used.
 *   - `legalizeParty` returns `false` if the caller omits `partyId` —
 *     the action is partyId-scoped and a global query has no meaning.
 *   - Simple per-action keys return `true` when `currentTurn >=` the
 *     stored turn-of-next-availability (or no cooldown exists yet).
 */
export async function isActionAvailable(
  db: Db,
  countryId: CountryId,
  action: ReformActionId,
  currentTurn: number,
  scope: CooldownScope = {}
): Promise<boolean> {
  const state = await getCountryState(db, countryId);
  const cd = state.reformCooldowns ?? {};

  switch (action) {
    case "constitutionalAmendment":
      return cd.constitutionalAmendment !== "used";
    case "legalizeParty": {
      if (scope.partyId === undefined) return false;
      const perParty = cd.legalizeParty?.perPartyId ?? {};
      const until = perParty[scope.partyId] ?? 0;
      return currentTurn >= until;
    }
    case "reduceVoteMultipliers":
      return currentTurn >= (cd.reduceVoteMultipliers ?? 0);
    case "holdHonestByElection":
      return currentTurn >= (cd.holdHonestByElection ?? 0);
    case "anticorruptionPurge":
      return currentTurn >= (cd.anticorruptionPurge ?? 0);
  }
}

/**
 * Stamp the cooldown for an action. For everything except
 * `constitutionalAmendment`, the stored value is
 * `currentTurn + durationTurns` (turn-of-next-availability).
 * `constitutionalAmendment` ignores `durationTurns` and stores
 * `"used"`. `legalizeParty` writes into a partyId-keyed sub-map without
 * disturbing entries for other parties.
 */
export async function setCooldown(
  db: Db,
  countryId: CountryId,
  action: ReformActionId,
  currentTurn: number,
  durationTurns: number,
  scope: CooldownScope = {}
): Promise<void> {
  const state = await getCountryState(db, countryId);
  const cd: ReformCooldownsMap = { ...(state.reformCooldowns ?? {}) };
  const untilTurn = currentTurn + durationTurns;

  switch (action) {
    case "constitutionalAmendment":
      cd.constitutionalAmendment = "used";
      break;
    case "legalizeParty": {
      if (scope.partyId === undefined) {
        throw new Error("setCooldown: legalizeParty requires scope.partyId");
      }
      const perParty = { ...(cd.legalizeParty?.perPartyId ?? {}) };
      perParty[scope.partyId] = untilTurn;
      cd.legalizeParty = { perPartyId: perParty };
      break;
    }
    case "reduceVoteMultipliers":
      cd.reduceVoteMultipliers = untilTurn;
      break;
    case "holdHonestByElection":
      cd.holdHonestByElection = untilTurn;
      break;
    case "anticorruptionPurge":
      cd.anticorruptionPurge = untilTurn;
      break;
  }

  await updateCountryState(db, countryId, { reformCooldowns: cd });
}
