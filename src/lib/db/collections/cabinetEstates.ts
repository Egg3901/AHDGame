import type { Db } from "mongodb";
import type { CabinetEstate } from "@/lib/db/types/cabinetEstate";

export function getCabinetEstatesCollection(db: Db) {
  return db.collection<CabinetEstate>("cabinetEstates");
}
