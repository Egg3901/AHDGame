import type { Db } from "mongodb";
import { getEraNominalAmount } from "@/lib/constants/sectorSeedEra";
import { ceoArchetypeModifiers, deriveCeoArchetype } from "@/lib/turn/ceoArchetype";
import type { Corporation, NPP } from "@/lib/db/types";
import {
  CASH_FLOOR,
  DEFAULT_ARCHETYPE,
  SAFE_CASH_FLOOR_MIN,
} from "@/lib/turn/npp/nppCorporationTuning";

/**
 * The anchor-denominated cash reserve an autonomous NPP corporation must keep.
 * Keep this in one place so turn decisions and owner-issued commands enforce
 * the same personality-adjusted safety rail.
 */
export function getNppCashFloorAnchor(
  preset?: string,
  cashFloorMult = ceoArchetypeModifiers(DEFAULT_ARCHETYPE).cashFloorMult
): number {
  return Math.max(
    getEraNominalAmount(SAFE_CASH_FLOOR_MIN, preset),
    Math.round(getEraNominalAmount(CASH_FLOOR, preset) * cashFloorMult)
  );
}

/** Resolve the reserve for a live corporation, defaulting safely for legacy NPP rows. */
export async function resolveNppCashFloorAnchor(
  db: Db,
  corporation: Corporation,
  preset?: string
): Promise<number> {
  if (corporation.ceoType !== "npp" || !corporation.ceoId) return 0;

  const npp = await db
    .collection<Pick<NPP, "personality">>("npps")
    .findOne({ _id: corporation.ceoId }, { projection: { personality: 1 } });
  const cashFloorMult = npp?.personality
    ? ceoArchetypeModifiers(deriveCeoArchetype(npp.personality)).cashFloorMult
    : ceoArchetypeModifiers(DEFAULT_ARCHETYPE).cashFloorMult;
  return getNppCashFloorAnchor(preset, cashFloorMult);
}
