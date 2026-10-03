/** A formed NPC Bulgarian government can introduce a draft for the constituent vote. */
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { Db } from "mongodb";
import type { ElectedOfficial, GameState, NPP } from "@/lib/db/types";
import {
  Bg1991ConstitutionalConflict,
  loadBg1991ConstitutionalDecision,
  openBg1991ConstitutionalProposal,
} from "./constitutionalProposals1991";
import { calendarTurn } from "@/lib/utils/gameDate";
import { bg1991DecisionAvailability } from "./rules/constitutionalDecision1991";
import { canBg1991NpcGovernmentIntroduce } from "./rules/constitutionalExecutive1991";
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
        { projection: { characterId: 1, nppId: 1, seatsHeld: 1 } }
      )
      .toArray(),
    db
      .collection("states")
      .find({ countryId: "BG" }, { projection: { houseDistricts: 1 } })
      .toArray(),
  ]);
  if (!leader) return false;
  const capacity = regions.reduce((n, row) => n + (row.houseDistricts ?? 0), 0);
  if (
    !canBg1991NpcGovernmentIntroduce({
      formed: government.status === "formed",
      playerPrimeMinister: Boolean(government.pmCharacterId),
      npcPrimeMinister: Boolean(government.pmNppId && leader),
      leaderParty: leader.party,
      capacity,
      mandates: officials
        .filter((row) => row.seatsHeld !== 0)
        .map((row) => ({
          actor: row.characterId
            ? `human:${row.characterId.toHexString()}`
            : row.nppId
              ? `npc:${row.nppId.toHexString()}`
              : "",
          seats: row.seatsHeld ?? 1,
          human: Boolean(row.characterId),
        })),
    })
  )
    return false;
  try {
    await openBg1991ConstitutionalProposal({
      db,
      game,
      turn,
      now,
      sponsor: null,
      sponsorParty: leader.party,
      reason: "npc_government_constituent_mandate",
    });
  } catch (error) {
    if (error instanceof Bg1991ConstitutionalConflict) return false;
    throw error;
  }
  return true;
}
