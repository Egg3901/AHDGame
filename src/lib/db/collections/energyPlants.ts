import type { Db } from "mongodb";
import type { EnergyPlant } from "@/lib/db/types/energyPlant";

export function getEnergyPlantsCollection(db: Db) {
  return db.collection<EnergyPlant>("energyPlants");
}
