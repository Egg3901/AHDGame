import type { Db } from "mongodb";
import {
  defaultRulesetFor,
  type LeadershipRemovalRuleset,
} from "@/lib/uk/leadership/leadershipRemoval";
import { committeeNameForFamily, LEADERSHIP_HISTORY_CAP } from "@/lib/uk/leadership/rules";
import type {
  LeadershipHistoryEntry,
  LeadershipHistoryKind,
  LeadershipPartyFamily,
  UKPartyLeadership,
} from "@/lib/uk/leadership/leadershipTypes";
import type { PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getUKPartyLeadershipCollection } from "@/lib/db/collections/ukPartyLeadership";

export function leadershipDocId(countryId: CountryId, partySeqId: string): string {
  return `${countryId}:${partySeqId}`;
}

/**
 * Map a party document to its leadership family. Abbreviation-first (UK seeds
 * use CON/LAB across every preset), with a name fallback for renamed parties.
 * Anything else gets CON-style starting rules.
 */
export function partyFamilyKeyFor(party: Pick<PoliticalParty, "abbreviation" | "name">): {
  family: LeadershipPartyFamily;
  familyKey: string;
} {
  const abbr = (party.abbreviation ?? "").trim().toUpperCase();
  if (abbr === "LAB") return { family: "lab", familyKey: "lab" };
  if (abbr === "CON") return { family: "con", familyKey: "con" };
  const name = (party.name ?? "").toLowerCase();
  if (name.includes("labour")) return { family: "lab", familyKey: "labour" };
  if (name.includes("conservative") || name.includes("tory") || name.includes("tories")) {
    return { family: "con", familyKey: "conservative" };
  }
  return { family: "other", familyKey: abbr.toLowerCase() || name };
}

export function defaultRulesetForParty(party: Pick<PoliticalParty, "abbreviation" | "name">): {
  ruleset: LeadershipRemovalRuleset;
  family: LeadershipPartyFamily;
} {
  const { family, familyKey } = partyFamilyKeyFor(party);
  return { ruleset: { ...defaultRulesetFor(familyKey) }, family };
}

/**
 * Load a party's leadership document, lazily seeding CON/LAB defaults on
 * first touch (same pattern as the confidence gauge default: no migration,
 * legacy rows heal on read). Atomic via $setOnInsert so concurrent seeds
 * cannot duplicate the row.
 */
export async function getOrSeedPartyLeadership(
  db: Db,
  countryId: CountryId,
  party: PoliticalParty,
  now: Date,
  currentTurn: number
): Promise<UKPartyLeadership> {
  const partySeqId = String(party.sequentialId);
  const _id = leadershipDocId(countryId, partySeqId);
  const { ruleset, family } = defaultRulesetForParty(party);
  const seedHistory: LeadershipHistoryEntry[] = [
    {
      turn: currentTurn,
      at: now,
      kind: "seeded",
      detail: `Starting ${family === "lab" ? "Labour-style" : family === "con" ? "Conservative-style" : "default"} removal rules adopted`,
    },
  ];
  await getUKPartyLeadershipCollection(db).updateOne(
    { _id },
    {
      $setOnInsert: {
        _id,
        countryId,
        partyId: partySeqId,
        family,
        committeeName: committeeNameForFamily(family),
        ruleset,
        lastAmendedTurn: null,
        lastAmendedByCharacterId: null,
        lastSurvivalTurn: null,
        appliedConferenceMotionIds: [],
        activeChallengeId: null,
        history: seedHistory,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
  const doc = await getUKPartyLeadershipCollection(db).findOne({ _id });
  // The upsert just wrote it, so a miss here is a driver failure, not a race.
  if (!doc) throw new Error("Failed to seed UK party leadership state");
  return doc;
}

/** Append a history entry, keeping the trail bounded and append-only. */
export function pushHistoryEntry(
  history: LeadershipHistoryEntry[],
  entry: Omit<LeadershipHistoryEntry, "at"> & { at?: Date }
): LeadershipHistoryEntry[] {
  const next = [...history, { at: new Date(), ...entry } as LeadershipHistoryEntry];
  return next.length > LEADERSHIP_HISTORY_CAP
    ? next.slice(next.length - LEADERSHIP_HISTORY_CAP)
    : next;
}

export function historyEntry(
  turn: number,
  kind: LeadershipHistoryKind,
  detail: string,
  actor?: { characterId?: import("mongodb").ObjectId; actorName?: string },
  at?: Date
): LeadershipHistoryEntry {
  return {
    turn,
    at: at ?? new Date(),
    kind,
    ...(actor?.characterId ? { actorCharacterId: actor.characterId } : {}),
    ...(actor?.actorName ? { actorName: actor.actorName } : {}),
    detail,
  };
}
