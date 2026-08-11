import type { Db } from "mongodb";
import type { Character, GameState, PoliticalParty, PurgeRejoinBlock } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { PURGE_REJOIN_COOLDOWN_TURNS } from "@/lib/constants/partyActions";

/**
 * Is the one cooldown-free party move currently open? This is an explicit,
 * admin-controlled window (gameState.freePartyMovesOpen), not inferred from the
 * pause state: a staged launch unpauses to run verification turns and re-pauses,
 * so the pre-go-live pause is indistinguishable from an ordinary mid-game admin
 * pause (pausedAt stamped, currentTurn advanced). The operator flips the flag on
 * while staging and off at go-live. See the join route.
 */
export function isFreePartyMoveWindowOpen(
  gameState: Pick<GameState, "freePartyMovesOpen"> | null | undefined
): boolean {
  return gameState?.freePartyMovesOpen === true;
}

export const PARTY_SWITCH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const PARTY_NPP_CONTROL_TENURE_MS = 48 * 60 * 60 * 1000;
export const PARTY_NPP_ENTRY_MIN_PARTY_AGE_MS = 48 * 60 * 60 * 1000;
export const PARTY_NPP_CONTROL_MIN_PLAYERS = 3;

export interface GuardResult {
  ok: boolean;
  error?: string;
  unblockAt?: Date;
}

function latestDate(...dates: Array<Date | null | undefined>): Date | null {
  const times = dates
    .filter((date): date is Date => date instanceof Date)
    .map((date) => date.getTime());
  if (times.length === 0) return null;
  return new Date(Math.max(...times));
}

function cooldownResult(anchor: Date | null, cooldownMs: number, now: Date): GuardResult {
  if (!anchor) return { ok: true };
  const unblockAt = new Date(anchor.getTime() + cooldownMs);
  if (now < unblockAt) {
    return { ok: false, unblockAt };
  }
  return { ok: true };
}

export function getPartySwitchCooldown(
  character: Pick<Character, "partyJoinedAt" | "lastPartySwitchAt">,
  now = new Date()
): GuardResult {
  const anchor = latestDate(character.lastPartySwitchAt, character.partyJoinedAt);
  const result = cooldownResult(anchor, PARTY_SWITCH_COOLDOWN_MS, now);
  if (!result.ok) {
    return {
      ...result,
      error: `You changed parties recently. You can join another party after ${result.unblockAt?.toISOString()}.`,
    };
  }
  return result;
}

export function getPartyPowerTenureCooldown(
  character: Pick<Character, "partyJoinedAt" | "lastPartySwitchAt">,
  now = new Date()
): GuardResult {
  const anchor = latestDate(character.lastPartySwitchAt, character.partyJoinedAt);
  const result = cooldownResult(anchor, PARTY_NPP_CONTROL_TENURE_MS, now);
  if (!result.ok) {
    return {
      ...result,
      error: `Party NPP controls unlock after your membership has been stable for 48 hours (${result.unblockAt?.toISOString()}).`,
    };
  }
  return result;
}

async function countActivePlayerMembers(
  db: Db,
  countryId: CountryId,
  partyId: string
): Promise<number> {
  const members = await db
    .collection<Character>("characters")
    .find({ countryId, party: partyId }, { projection: { userId: 1 } })
    .project<Pick<Character, "userId">>({ userId: 1 })
    .toArray();
  if (members.length === 0) return 0;

  const userIds = members
    .map((member) => member.userId)
    .filter((id): id is Character["userId"] => !!id);
  if (userIds.length === 0) return 0;

  const bannedUsers = await db
    .collection("users")
    .find({ _id: { $in: userIds }, isBanned: true })
    .project<{ _id: NonNullable<Character["userId"]> }>({ _id: 1 })
    .toArray();
  const bannedUserIds = new Set(bannedUsers.map((user) => user._id.toString()));
  return members.filter((member) => !bannedUserIds.has(member.userId.toString())).length;
}

export async function getPartyNppControlStatus(args: {
  db: Db;
  countryId: CountryId;
  party: PoliticalParty;
  actor?: Pick<Character, "party" | "partyJoinedAt" | "lastPartySwitchAt"> | null;
  isAdmin?: boolean;
  now?: Date;
}): Promise<GuardResult> {
  if (args.isAdmin || args.party.isDefault) return { ok: true };

  const now = args.now ?? new Date();
  const partyAge = cooldownResult(args.party.createdAt, PARTY_NPP_ENTRY_MIN_PARTY_AGE_MS, now);
  if (!partyAge.ok) {
    return {
      ...partyAge,
      error: `New custom parties cannot use NPP controls for 48 hours after creation (${partyAge.unblockAt?.toISOString()}).`,
    };
  }

  const playerCount = await countActivePlayerMembers(
    args.db,
    args.countryId,
    String(args.party.sequentialId)
  );
  if (playerCount < PARTY_NPP_CONTROL_MIN_PLAYERS) {
    return {
      ok: false,
      error: `Custom parties need at least ${PARTY_NPP_CONTROL_MIN_PLAYERS} active player members before using NPP controls. Current player members: ${playerCount}.`,
    };
  }

  if (args.actor) {
    if (args.actor.party !== String(args.party.sequentialId)) {
      return { ok: false, error: "You must be a current member of this party." };
    }
    const tenure = getPartyPowerTenureCooldown(args.actor, now);
    if (!tenure.ok) return tenure;
  }

  return { ok: true };
}

export function buildNppElectionEligiblePartyKeys(
  parties: PoliticalParty[],
  now = new Date()
): Set<string> {
  const eligible = new Set<string>();
  for (const party of parties) {
    const countryId = (party.countryId ?? "US") as CountryId;
    const partyId = String(party.sequentialId);
    if (party.isDefault) {
      eligible.add(`${countryId}:${partyId}`);
      continue;
    }

    if (cooldownResult(party.createdAt, PARTY_NPP_ENTRY_MIN_PARTY_AGE_MS, now).ok) {
      eligible.add(`${countryId}:${partyId}`);
    }
  }
  return eligible;
}

/**
 * Drop purge rejoin blocks whose cooldown has elapsed. A block is active while
 * `purgedAtTurn + PURGE_REJOIN_COOLDOWN_TURNS > currentTurn`.
 */
export function prunePurgeRejoinBlocks(
  blocks: PurgeRejoinBlock[] | undefined,
  currentTurn: number
): PurgeRejoinBlock[] {
  if (!blocks || blocks.length === 0) return [];
  return blocks.filter((block) => block.purgedAtTurn + PURGE_REJOIN_COOLDOWN_TURNS > currentTurn);
}

/**
 * Is the character currently blocked from rejoining a specific party because
 * they were purged from it? Matches on both party sequentialId and country.
 */
export function getPurgeRejoinBlock(
  blocks: PurgeRejoinBlock[] | undefined,
  partyId: string,
  countryId: CountryId,
  currentTurn: number
): { blocked: boolean; turnsRemaining: number } {
  if (!blocks || blocks.length === 0) return { blocked: false, turnsRemaining: 0 };
  const match = blocks.find((block) => block.partyId === partyId && block.countryId === countryId);
  if (!match) return { blocked: false, turnsRemaining: 0 };
  const turnsRemaining = match.purgedAtTurn + PURGE_REJOIN_COOLDOWN_TURNS - currentTurn;
  return turnsRemaining > 0
    ? { blocked: true, turnsRemaining }
    : { blocked: false, turnsRemaining: 0 };
}
