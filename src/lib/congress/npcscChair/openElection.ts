/**
 * NPC Standing Committee Chairman election opener — mirrors the US Speaker
 * auto-open and the DE Bundestagspräsident opener
 * (src/lib/congress/bundestagspraesident/openElection.ts).
 *
 * Called from the CN NPC general-election resolution path once seats are
 * reconciled. The 24-hour ballot opens among seated NPC delegates; the
 * incumbent Chairman is auto-nominated when they still hold a seat and remain
 * eligible under the role's policy.
 */
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import { getPartyMap } from "@/lib/db/partyMap";
import { getGameTime } from "@/lib/time/gameTime";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";
import { getNpcComposition } from "@/lib/congress/npcComposition";
import {
  buildChamberLeadershipContext,
  isPartyEligible,
  POLICY_BY_ROLE,
} from "@/lib/congress/leadership/rolePolicy";
import type {
  NpcscChairElection,
  NpcscChairNomination,
  Character,
  CongressLeader,
  ElectedOfficial,
} from "@/lib/db/types";

const ELECTION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours — parity with US Speaker

/**
 * Open a fresh 24-hour NPC Standing Committee Chairman election. Idempotent:
 * if an active election is already in progress (status === "voting" and not yet
 * expired), this is a no-op so it can be called multiple times during the
 * post-resolution flow without double-opening.
 */
export async function triggerNpcscChairElectionAfterReconcile(db: Db, now: Date): Promise<void> {
  const existing = await db
    .collection<NpcscChairElection>("npcscChairElections")
    .findOne({ _id: "current" });
  const currentTurn = (await getGameTime()).currentTurn;
  if (existing?.status === "voting" && !isLeadershipElectionClosed(existing, currentTurn, now)) {
    return; // already running — leave it
  }

  // Clear any stale nominations from a prior cycle.
  await db
    .collection<NpcscChairNomination>("npcscChairNominations")
    .updateMany(
      { status: { $in: ["open", "voting"] } },
      { $set: { status: "failed", updatedAt: now } }
    );

  const endsAt = new Date(now.getTime() + ELECTION_DURATION_MS);
  const endsOnTurn = currentTurn + ELECTION_DURATION_MS / 3_600_000;
  await db.collection<NpcscChairElection>("npcscChairElections").updateOne(
    { _id: "current" },
    {
      $set: {
        _id: "current",
        status: "voting",
        startedAt: now,
        endsAt,
        endsOnTurn,
        updatedAt: now,
      },
    },
    { upsert: true }
  );

  // Auto-nominate the incumbent if they still hold an NPC seat and remain
  // eligible under the chair_npcsc policy.
  const partyMap = await getPartyMap(db, "CN");
  const npc = await getNpcComposition(db, partyMap);
  const policy = POLICY_BY_ROLE.chair_npcsc;
  const chamberCtx = buildChamberLeadershipContext({
    composition: npc.composition,
    majorityParty: npc.majorityParty,
    majorityBloc: npc.majorityBloc,
  });

  const incumbent = await db
    .collection<CongressLeader>("congressLeaders")
    .findOne({ role: "chair_npcsc" });

  if (incumbent?.characterId) {
    const hasSeat = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      officeType: "npcDelegate",
      characterId: incumbent.characterId,
      countryId: "CN",
    });
    if (hasSeat) {
      const char = await db
        .collection<Character>("characters")
        .findOne(
          { _id: incumbent.characterId },
          { projection: { party: 1, homeState: 1, name: 1 } }
        );
      const incumbentParty = char?.party ?? incumbent.party ?? null;
      if (incumbentParty && isPartyEligible(policy, incumbentParty, chamberCtx)) {
        await db.collection<NpcscChairNomination>("npcscChairNominations").insertOne({
          _id: new ObjectId(),
          nomineeId: incumbent.characterId,
          nomineeName: incumbent.characterName,
          nomineeParty: incumbentParty,
          nomineeCountryId: "CN",
          nomineeState: char?.homeState ?? hasSeat.state ?? undefined,
          nominatedById: incumbent.characterId,
          nominatedByName: "Incumbent",
          status: "voting",
          votesFor: 0,
          votesAgainst: 0,
          votes: {},
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  console.log(
    `[Turn] NPC Standing Committee Chairman election opened after reconciliation (ends ${endsAt.toISOString()})`
  );
}
