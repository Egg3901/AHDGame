/**
 * A fully NPC Hungarian government may propose the 1994 threshold amendment.
 * Its governing party must hold over five percent of Assembly seats; player
 * deputies keep the choice, and a rejected NPC bill is not automatically retried.
 */
import type { Db } from "mongodb";
import type { ElectedOfficial, GameState, NPP } from "@/lib/db/types";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { loadHu1994ElectoralDecision, openHu1994ElectoralProposal } from "./electoralProposals1994";
import { hu1994DecisionAvailability, supportsHu1994NpcAmendment } from "./rules/electoralLaw";
import { calendarTurn } from "@/lib/utils/gameDate";

export async function processHu1994ElectoralNpcProposal(
  db: Db,
  game: GameState,
  turn: number,
  now: Date
) {
  if (
    !hu1994DecisionAvailability({
      preset: game.preset,
      calendarTurn: calendarTurn(turn, {
        preIterationActive: game.preIteration?.active,
        preIterationTurns: game.preIterationTurns,
      }),
      modernAssemblyYear: game.huAssemblyReformedAtYear,
    }).available
  )
    return false;
  const decision = await loadHu1994ElectoralDecision(db, game, turn);
  if (!decision?.available || decision.proposal) return false;
  const government = await getGovernmentFormationsCollection(db).findOne(
    { _id: "HU" },
    { projection: { status: 1, pmCharacterId: 1, pmNppId: 1 } }
  );
  if (government?.status !== "formed" || government.pmCharacterId || !government.pmNppId)
    return false;
  const [leader, officials] = await Promise.all([
    db.collection<NPP>("npps").findOne({ _id: government.pmNppId }, { projection: { party: 1 } }),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find(
        { countryId: "HU", officeType: "assemblyDelegate" },
        { projection: { characterId: 1, party: 1, seatsHeld: 1 } }
      )
      .toArray(),
  ]);
  if (!leader || !officials.length || officials.some((row) => row.characterId)) return false;
  const governingSeats = officials
    .filter((row) => row.party === leader.party)
    .reduce((sum, row) => sum + (row.seatsHeld ?? 1), 0);
  if (!supportsHu1994NpcAmendment(governingSeats)) return false;
  await openHu1994ElectoralProposal({
    db,
    game,
    turn,
    now,
    sponsor: null,
    sponsorParty: leader.party,
    reason: "npc_government_threshold_mandate",
  });
  return true;
}
