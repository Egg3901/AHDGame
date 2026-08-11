/**
 * Bundestagspräsident election opener — mirrors the US Speaker auto-open
 * inside `triggerLeadershipElectionsAfterChamberVote(db, "house", ...)`.
 *
 * Called from the Bundestag election resolution path once the AMS
 * reconciliation completes (i.e., the cycle has filled the full 630 seats
 * via direct mandates + list seats). The 24-hour ballot opens among MdBs;
 * the incumbent Bundestagspräsident is auto-nominated when they still hold
 * a seat and remain eligible under the role's policy.
 */
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import { getPartyMap } from "@/lib/db/partyMap";
import { getGameTime } from "@/lib/time/gameTime";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";
import { getBundestagComposition } from "@/lib/congress/bundestagComposition";
import {
  buildChamberLeadershipContext,
  isPartyEligible,
  POLICY_BY_ROLE,
} from "@/lib/congress/leadership/rolePolicy";
import type {
  BundestagspraesidentElection,
  BundestagspraesidentNomination,
  Character,
  CongressLeader,
  ElectedOfficial,
} from "@/lib/db/types";

const ELECTION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours — parity with US Speaker

/**
 * Open a fresh 24-hour Bundestagspräsident election. Idempotent: if an
 * active election is already in progress (status === "voting" and not yet
 * expired), this is a no-op so it can be called multiple times during the
 * post-resolution flow without double-opening.
 */
export async function triggerBundestagspraesidentElectionAfterReconcile(
  db: Db,
  now: Date
): Promise<void> {
  const existing = await db
    .collection<BundestagspraesidentElection>("bundestagspraesidentElections")
    .findOne({ _id: "current" });
  const currentTurn = (await getGameTime()).currentTurn;
  if (existing?.status === "voting" && !isLeadershipElectionClosed(existing, currentTurn, now)) {
    return; // already running — leave it
  }

  // Clear any stale nominations from a prior cycle.
  await db
    .collection<BundestagspraesidentNomination>("bundestagspraesidentNominations")
    .updateMany(
      { status: { $in: ["open", "voting"] } },
      { $set: { status: "failed", updatedAt: now } }
    );

  const endsAt = new Date(now.getTime() + ELECTION_DURATION_MS);
  const endsOnTurn = currentTurn + ELECTION_DURATION_MS / 3_600_000;
  await db.collection<BundestagspraesidentElection>("bundestagspraesidentElections").updateOne(
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

  // Auto-nominate the incumbent if they still hold an MdB seat and remain
  // eligible under the Bundestagspräsident policy.
  const partyMap = await getPartyMap(db, "DE");
  const bundestag = await getBundestagComposition(db, partyMap);
  const policy = POLICY_BY_ROLE.speaker_of_the_bundestag;
  const chamberCtx = buildChamberLeadershipContext({
    composition: bundestag.composition,
    majorityParty: bundestag.majorityParty,
    majorityBloc: bundestag.majorityBloc,
  });

  const incumbent = await db
    .collection<CongressLeader>("congressLeaders")
    .findOne({ role: "speaker_of_the_bundestag" });

  if (incumbent?.characterId) {
    const hasSeat = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      officeType: "bundestag",
      characterId: incumbent.characterId,
      countryId: "DE",
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
        await db
          .collection<BundestagspraesidentNomination>("bundestagspraesidentNominations")
          .insertOne({
            _id: new ObjectId(),
            nomineeId: incumbent.characterId,
            nomineeName: incumbent.characterName,
            nomineeParty: incumbentParty,
            nomineeCountryId: "DE",
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
    `[Turn] Bundestagspräsident election opened after AMS reconciliation (ends ${endsAt.toISOString()})`
  );
}
