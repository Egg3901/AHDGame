import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { declareWar } from "@/lib/military/declareWar";
import { joinManyToSide } from "@/lib/military/joinSide";
import { loadMilitaryBlocs } from "@/lib/military/blocLookup";
import { sideOf } from "@/lib/military/occupation";
import type { WarGoal } from "@/lib/military/warGoals";

/** Start or widen the war for all automatic NPP participants as one coalition. */
export async function enactAutomaticOrganizationWar(params: {
  db: Db;
  declarers: CountryId[];
  defender: CountryId;
  warGoal: WarGoal;
  resolutionId: string;
  currentTurn: number;
}): Promise<string | null> {
  const declarers = [...new Set(params.declarers)].sort();
  const principal = declarers[0];
  if (!principal) return null;

  const result = await declareWar(params.db, {
    declarer: principal,
    defender: params.defender,
    warGoal: params.warGoal,
    billId: `organization:${params.resolutionId}`,
    currentTurn: params.currentTurn,
  });
  const remaining = declarers.slice(1);
  if (remaining.length > 0) {
    const blocs = await loadMilitaryBlocs(params.db);
    const defenderSide = sideOf(result.conflict, params.defender, blocs);
    const declarerSide = defenderSide === "A" ? "B" : "A";
    await joinManyToSide(params.db, result.conflict, remaining, declarerSide, params.currentTurn);
  }
  return result.conflict._id;
}
