/** An entirely NPC Bulgarian constituent majority can introduce a constitutional draft. */
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { Db } from "mongodb";
import type { ElectedOfficial, GameState, NPP } from "@/lib/db/types";
import {
  loadBg1991ConstitutionalDecision,
  openBg1991ConstitutionalProposal,
} from "./constitutionalProposals1991";
import { calendarTurn } from "@/lib/utils/gameDate";
import {
  passesBgConstitution1991,
  bg1991DecisionAvailability,
} from "./rules/constitutionalDecision1991";
export async function processBg1991ConstitutionalNpcProposal(
  db: Db,
  game: GameState,
  turn: number,
  now: Date
) {
  if (
    !bg1991DecisionAvailability({
      preset: game.preset,
      calendarTurn: calendarTurn(turn, {
        preIterationActive: game.preIteration?.active,
        preIterationTurns: game.preIterationTurns,
      }),
    }).available
  )
    return false;
  const decision = await loadBg1991ConstitutionalDecision(db, game, turn);
  if (!decision?.available || decision.proposal) return false;
  const government = await db
    .collection<GovernmentFormation>("governmentFormations")
    .findOne({ _id: "BG" }, { projection: { status: 1, pmCharacterId: 1, pmNppId: 1 } });
  if (government?.status !== "formed" || government.pmCharacterId || !government.pmNppId)
    return false;
  const [leader, officials, regions] = await Promise.all([
    db.collection<NPP>("npps").findOne({ _id: government.pmNppId }, { projection: { party: 1 } }),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find(
        { countryId: "BG", officeType: "assemblyDeputy" },
        { projection: { officeType: 1, characterId: 1, party: 1, seatsHeld: 1 } }
      )
      .toArray(),
    db
      .collection("states")
      .find({ countryId: "BG" }, { projection: { houseDistricts: 1 } })
      .toArray(),
  ]);
  if (!leader || !officials.length || officials.some((row) => row.characterId)) return false;
  const seats = regions.reduce((n, row) => n + (row.houseDistricts ?? 0), 0);
  const support = officials
    .filter((row) => row.party === leader.party)
    .reduce((n, row) => n + (row.seatsHeld ?? 1), 0);
  if (seats !== 400 || !passesBgConstitution1991({ for: support, against: 0, abstain: 0 }, seats))
    return false;
  await openBg1991ConstitutionalProposal({
    db,
    game,
    turn,
    now,
    sponsor: null,
    sponsorParty: leader.party,
    reason: "npc_government_constituent_mandate",
  });
  return true;
}
