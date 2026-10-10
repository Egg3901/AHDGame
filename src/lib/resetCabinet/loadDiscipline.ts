import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { loadCabinetGameplayEffects } from "./loadGameplayEffects";
import { cabinetEffectsForRegion, cabinetWhipBonus } from "./rules/gameplay";

import type { CabinetDiscipline } from "./rules/gameplay";
export { cabinetDisciplineForParty, type CabinetDiscipline } from "./rules/gameplay";

/** Only the formed government's supporting parties benefit; opposition whips do not. */
export async function loadCabinetDiscipline(
  db: Db,
  game?: GameState | null,
  turn?: number
): Promise<CabinetDiscipline[]> {
  const effects = await loadCabinetGameplayEffects(db, game, turn);
  const countries = [
    ...new Set(
      effects
        .filter((effect) => effect.target === "S:partyDiscipline")
        .map((effect) => effect.country)
    ),
  ];
  if (!countries.length) return [];
  const formations = await db
    .collection<GovernmentFormation>("governmentFormations")
    .find(
      { _id: { $in: countries }, status: "formed" },
      { projection: { _id: 1, status: 1, governingPartyId: 1, coalitionPartyIds: 1 } }
    )
    .toArray();
  return formations
    .filter(
      (row) => row.status === "formed" && countries.includes(row._id as (typeof countries)[number])
    )
    .map((row) => ({
      countryId: row._id,
      parties: [
        ...new Set(
          [row.governingPartyId, ...(row.coalitionPartyIds ?? [])].filter(
            (party): party is string => typeof party === "string" && party.length > 0
          )
        ),
      ],
      bonus: cabinetWhipBonus(cabinetEffectsForRegion(effects, row._id)),
    }));
}
