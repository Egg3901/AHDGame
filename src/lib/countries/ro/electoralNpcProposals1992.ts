/** An entirely NPC Romanian majority can introduce a bicameral electoral bill. */
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { Db } from "mongodb";
import type { ElectedOfficial, GameState, NPP } from "@/lib/db/types";
import { loadRo1992ElectoralDecision, openRo1992ElectoralProposal } from "./electoralProposals1992";
import { calendarTurn } from "@/lib/utils/gameDate";
import {
  passesRoElectoralAmendment,
  ro1992DecisionAvailability,
} from "./rules/electoralDecision1992";
export async function processRo1992ElectoralNpcProposal(
  db: Db,
  game: GameState,
  turn: number,
  now: Date
) {
  if (
    !ro1992DecisionAvailability({
      preset: game.preset,
      calendarTurn: calendarTurn(turn, {
        preIterationActive: game.preIteration?.active,
        preIterationTurns: game.preIterationTurns,
      }),
    }).available
  )
    return false;
  const decision = await loadRo1992ElectoralDecision(db, game, turn);
  if (!decision?.available || decision.proposal) return false;
  const government = await db
    .collection<GovernmentFormation>("governmentFormations")
    .findOne({ _id: "RO" }, { projection: { status: 1, pmCharacterId: 1, pmNppId: 1 } });
  if (government?.status !== "formed" || government.pmCharacterId || !government.pmNppId)
    return false;
  const [leader, officials, regions] = await Promise.all([
    db.collection<NPP>("npps").findOne({ _id: government.pmNppId }, { projection: { party: 1 } }),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find(
        { countryId: "RO", officeType: { $in: ["deputy", "senator"] } },
        { projection: { officeType: 1, characterId: 1, party: 1, seatsHeld: 1 } }
      )
      .toArray(),
    db
      .collection("states")
      .find({ countryId: "RO" }, { projection: { houseDistricts: 1, stateSenateSeats: 1 } })
      .toArray(),
  ]);
  if (!leader || !officials.length || officials.some((row) => row.characterId)) return false;
  for (const [chamber, field] of [
    ["deputy", "houseDistricts"],
    ["senator", "stateSenateSeats"],
  ] as const) {
    const seats = regions.reduce((n, row) => n + (row[field] ?? 0), 0);
    const support = officials
      .filter((row) => row.officeType === chamber && row.party === leader.party)
      .reduce((n, row) => n + (row.seatsHeld ?? 1), 0);
    if (!passesRoElectoralAmendment({ for: support, against: 0, abstain: 0 }, seats)) return false;
  }
  await openRo1992ElectoralProposal({
    db,
    game,
    turn,
    now,
    sponsor: null,
    sponsorParty: leader.party,
    reason: "npc_government_bicameral_mandate",
  });
  return true;
}
