import type { AuthUser, AuthUserWithCharacter } from "@/lib/auth";
import type { CountryId } from "@/lib/constants/countries";
import type { PoliticalParty, StatePartyOrg } from "@/lib/db/types";
import type { ObjectId } from "mongodb";
import { isSameCountry } from "@/lib/api/sameCountry";

export type PartyLeadershipRole = "chair" | "viceChair" | "treasurer";

/** Maximum number of chair-assigned campaigners per national party. */
export const MAX_NATIONAL_CAMPAIGNERS = 3 as const;

function objectIdEquals(
  left: ObjectId | null | undefined,
  right: ObjectId | null | undefined
): boolean {
  return !!left && !!right && left.equals(right);
}

export function isNationalPartyMember(
  party: PoliticalParty,
  character:
    | {
        party?: string | null;
        countryId?: CountryId | null;
      }
    | null
    | undefined
): boolean {
  if (!character) return false;
  return character.party === String(party.sequentialId) && isSameCountry(character, party);
}

export function getNationalPartyLeadershipRole(
  party: PoliticalParty,
  characterId: ObjectId | null | undefined
): PartyLeadershipRole | null {
  if (objectIdEquals(party.chairId, characterId)) return "chair";
  if (objectIdEquals(party.viceChairId, characterId)) return "viceChair";
  if (objectIdEquals(party.treasurerId, characterId)) return "treasurer";
  return null;
}

export function canViewNationalTreasuryInsights(
  party: PoliticalParty,
  user: AuthUserWithCharacter,
  moderatorOverride = false
): boolean {
  if (moderatorOverride && user.isModerator) return true;
  if (user.isAdmin) return true;
  return getNationalPartyLeadershipRole(party, user.character?._id ?? null) !== null;
}

/**
 * Who may reach the national NPP Management surface (Influence Actions
 * and NPP Move): chair, vice-chair, admins, and committee-confirmed
 * campaigners (suggestion #269).
 *
 * Campaigners reach this surface only after the National Committee
 * confirms the chair's nomination, and the chair can fire them back out
 * instantly — that pairing is what makes widening the seat safe.
 * Recruitment stays chair / vice / admin (see `canRelocateOrRecruit`):
 * it creates new bodies and commits party funds rather than steering
 * NPPs the party already has.
 */
export function canUseNationalPartyInfluence(
  party: PoliticalParty,
  user: AuthUserWithCharacter
): boolean {
  if (user.isAdmin) return true;
  const characterId = user.character?._id ?? null;
  const role = getNationalPartyLeadershipRole(party, characterId);
  if (role === "chair" || role === "viceChair") return true;
  return isNationalCampaigner(party, characterId);
}

/**
 * Whether the user is a campaigner of the national party. Campaigners
 * are chair-nominated and National-Committee-confirmed; they can spend
 * party PS to Build Org and use NPP Management on the party's behalf.
 * Recruitment stays chair / vice-chair / admin.
 */
export function isNationalCampaigner(
  party: PoliticalParty,
  characterId: ObjectId | null | undefined
): boolean {
  if (!characterId) return false;
  return (party.campaignerIds ?? []).some((id) => objectIdEquals(id, characterId));
}

/** State equivalent — single campaigner per state-party row. */
export function isStateCampaigner(
  stateParty: Pick<StatePartyOrg, "campaignerId"> | null | undefined,
  characterId: ObjectId | null | undefined
): boolean {
  if (!stateParty || !characterId) return false;
  return objectIdEquals(stateParty.campaignerId ?? null, characterId);
}

/**
 * Auth predicate for state-scope PS spends (Build Org).
 *
 * Allowed: admin, state chair / state vice-chair, the state campaigner,
 * the national chair / vice-chair (cross-scope authority), and any
 * national campaigner of the same party (cross-state authority).
 *
 * Not allowed: state treasurer (treasury role), regular members.
 * National NPP Management is `canUseNationalPartyInfluence` (includes
 * confirmed campaigners). State NPP Management stays chair / vice / admin.
 */
export function canSpendOnStateParty(
  party: PoliticalParty,
  stateParty: Pick<StatePartyOrg, "chairId" | "viceChairId" | "campaignerId"> | null | undefined,
  user: AuthUserWithCharacter
): boolean {
  if (user.isAdmin) return true;
  const characterId = user.character?._id ?? null;
  if (!characterId) return false;

  if (stateParty?.chairId && stateParty.chairId.equals(characterId)) return true;
  if (stateParty?.viceChairId && stateParty.viceChairId.equals(characterId)) return true;
  if (isStateCampaigner(stateParty, characterId)) return true;

  const nationalRole = getNationalPartyLeadershipRole(party, characterId);
  if (nationalRole === "chair" || nationalRole === "viceChair") return true;
  if (isNationalCampaigner(party, characterId)) return true;

  return false;
}

export interface SpenderScopeEligibility {
  /** Qualifies via a state-tier role → may spend the per-state PS pool. */
  state: boolean;
  /** Qualifies via a national-tier role → may spend the national PS pool. */
  national: boolean;
}

/**
 * Which PS pools `user` is authorized to spend from for a state-scope action
 * (Build Org) on this party-state. A dual-role officer (national +
 * state) returns `{ state: true, national: true }`.
 *
 * Admins get no blanket pool override here — eligibility derives from their
 * real national/state roles like any other player. (Admins retain the ability
 * to perform the action via `canSpendOnStateParty`; a role-less admin's spend
 * falls back to the state pool through `resolveSpenderScope`.)
 */
export function resolveSpenderScopeEligibility(
  party: PoliticalParty,
  stateParty: Pick<StatePartyOrg, "chairId" | "viceChairId" | "campaignerId"> | null | undefined,
  user: AuthUserWithCharacter
): SpenderScopeEligibility {
  const characterId = user.character?._id ?? null;
  if (!characterId) return { state: false, national: false };

  const stateTier =
    (!!stateParty?.chairId && stateParty.chairId.equals(characterId)) ||
    (!!stateParty?.viceChairId && stateParty.viceChairId.equals(characterId)) ||
    isStateCampaigner(stateParty, characterId);

  const nationalRole = getNationalPartyLeadershipRole(party, characterId);
  const nationalTier =
    nationalRole === "chair" ||
    nationalRole === "viceChair" ||
    isNationalCampaigner(party, characterId);

  return { state: stateTier, national: nationalTier };
}

/**
 * Resolve which PS pool a state-scope action (Build Org) should
 * debit when triggered by `user`. State-tier roles (state chair / state
 * vice / state campaigner) pay from the per-state PS pool; national-tier
 * roles (national chair / vice / campaigner) pay from the national PS pool.
 *
 * `preferred` lets a dual-role officer pick a pool explicitly. It is honored
 * ONLY when the user is actually eligible for it; otherwise the historical
 * precedence applies (state first, then national, then "state" as a safe
 * fallback — the spend then fails at the insufficient-PS / missing-row guard
 * inside `spendPoliticalStrength`). Admins follow their real roles like anyone
 * else; a role-less admin lands on the final "state" fallback.
 */
export function resolveSpenderScope(
  party: PoliticalParty,
  stateParty: Pick<StatePartyOrg, "chairId" | "viceChairId" | "campaignerId"> | null | undefined,
  user: AuthUserWithCharacter,
  preferred?: "state" | "national-targeted"
): "state" | "national-targeted" {
  const eligibility = resolveSpenderScopeEligibility(party, stateParty, user);

  if (preferred === "national-targeted" && eligibility.national) return "national-targeted";
  if (preferred === "state" && eligibility.state) return "state";

  if (eligibility.state) return "state";
  if (eligibility.national) return "national-targeted";
  return "state";
}

/**
 * Tighter auth predicate for actions still excluded from the campaigner
 * role: NPP Recruitment. Same shape as `canSpendOnStateParty` minus the
 * campaigner inclusions.
 *
 * NPP Move (`relocate_state`) moved out of this set with suggestion
 * #269 — it is NPP Management, which confirmed campaigners now hold.
 */
export function canRelocateOrRecruit(
  party: PoliticalParty,
  stateParty: Pick<StatePartyOrg, "chairId" | "viceChairId"> | null | undefined,
  user: AuthUserWithCharacter
): boolean {
  if (user.isAdmin) return true;
  const characterId = user.character?._id ?? null;
  if (!characterId) return false;

  if (stateParty?.chairId && stateParty.chairId.equals(characterId)) return true;
  if (stateParty?.viceChairId && stateParty.viceChairId.equals(characterId)) return true;

  const nationalRole = getNationalPartyLeadershipRole(party, characterId);
  return nationalRole === "chair" || nationalRole === "viceChair";
}

/**
 * Who may declare/withdraw a party's referendum position: the region's
 * state-party Chair or Vice-chair, or the national party Chair or Vice-chair
 * (and admins). Campaigners, treasurers, and ordinary members may not. Same
 * shape as `canRelocateOrRecruit`; named separately for a clear call site.
 */
export function canDeclarePartyPosition(
  party: PoliticalParty,
  stateParty: Pick<StatePartyOrg, "chairId" | "viceChairId"> | null | undefined,
  user: AuthUserWithCharacter
): boolean {
  if (user.isAdmin) return true;
  const characterId = user.character?._id ?? null;
  if (!characterId) return false;

  if (stateParty?.chairId && stateParty.chairId.equals(characterId)) return true;
  if (stateParty?.viceChairId && stateParty.viceChairId.equals(characterId)) return true;

  const nationalRole = getNationalPartyLeadershipRole(party, characterId);
  return nationalRole === "chair" || nationalRole === "viceChair";
}

export function canViewPartyAnalytics(
  party: PoliticalParty,
  user: AuthUser,
  moderatorOverride = false
): boolean {
  if (moderatorOverride && user.isModerator) return true;
  if (user.isAdmin) return true;
  return isNationalPartyMember(party, (user as AuthUserWithCharacter).character);
}
