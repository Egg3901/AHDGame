/**
 * Westminster's initial stance allowance belongs to the seated government.
 * loadWestminsterGovernment resolves the canonical ministry, with legacy fallback.
 */
import type { Db } from "mongodb";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import type { ParliamentaryGovernment } from "@/lib/db/types/parliamentaryGovernment";
import type { WestminsterGovernment } from "./rules";

export async function loadWestminsterGovernment(db: Db): Promise<WestminsterGovernment | null> {
  const formation = await getGovernmentFormationsCollection(db).findOne({ _id: "UK" });
  const government =
    formation ??
    (await db
      .collection<ParliamentaryGovernment>("parliamentaryGovernments")
      .findOne({ _id: "UK" }));
  if (!government?.pmCharacterId || government.status !== "formed") return null;
  return {
    key: JSON.stringify([
      government.cycle,
      government.pmCharacterId.toString(),
      government.formedTurn ?? null,
      government.formedAt?.toISOString() ?? null,
    ]),
    formedTurn: government.formedTurn ?? null,
  };
}
