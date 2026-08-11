/**
 * Legislative strategic-sector designation (spec §6.3/§8): the enactment of a
 * `designate_strategic_sector` bill provision arms the strategic nationalization
 * trigger for that `(country, sectorType)`. Passage IS the authorization — no
 * eligibility gate. Idempotent via the upsert in `designateStrategicSector`.
 */
import type { Db } from "mongodb";
import type { DesignateStrategicSectorProvision } from "@/lib/db/types/legislation";
import type { CountryId } from "@/lib/constants/countries";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { designateStrategicSector, getDesignatedSectorTypes } from "./strategicSectors";
import { MAX_STRATEGIC_SECTOR_DESIGNATIONS } from "./constants";

export async function applyDesignateStrategicSectorProvision(
  db: Db,
  countryId: CountryId,
  provision: DesignateStrategicSectorProvision
): Promise<void> {
  // Respect the per-country cap. Re-designating an existing sector is idempotent
  // and never trips it; a new one at the cap is a no-op (bill passed, but the
  // strategic register is full).
  const designated = await getDesignatedSectorTypes(db, countryId);
  if (
    !designated.has(provision.sectorType) &&
    designated.size >= MAX_STRATEGIC_SECTOR_DESIGNATIONS
  ) {
    return;
  }
  const turn = await getCurrentTurn(db);
  await designateStrategicSector(db, {
    countryId,
    sectorType: provision.sectorType,
    turn,
    source: "legislation",
  });
}
