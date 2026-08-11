import type { Db } from "mongodb";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";

export function getMilitaryUnitsCollection(db: Db) {
  return db.collection<MilitaryUnit>("militaryUnits");
}
