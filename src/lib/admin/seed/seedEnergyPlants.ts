import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { ENERGY_POSITION_BY_COUNTRY, ENERGY_SOURCES } from "@/lib/constants/cabinetEnergy";
import { getEnergyPlantsCollection } from "@/lib/db/collections/energyPlants";
import type { EnergyPlant } from "@/lib/db/types/energyPlant";
import { eraForPreset } from "@/lib/seeds/presetSelector";

/**
 * Energy sources available by era. Gates anachronistic generation from appearing
 * in historical worlds (e.g. nuclear plants in 1953, solar farms in 1979).
 * First commercial nuclear: Calder Hall UK 1956. Utility-scale wind: ~1990s. Solar: 2000s.
 */
const ALLOWED_SOURCES_BY_ERA: Partial<Record<string, string[]>> = {
  "1953": ["coal", "gas", "hydro"],
  "1979": ["coal", "gas", "hydro", "nuclear"],
  "1991": ["coal", "gas", "hydro", "nuclear"],
  "1999": ["coal", "gas", "hydro", "nuclear", "wind"],
  "2007": ["coal", "gas", "hydro", "nuclear", "wind", "solar"],
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic starting fleet for one country's energy seat. Pure. A spread of
 * firm baseload appropriate to the era (coal/gas/nuclear/hydro) + renewables only
 * when historically available.
 */
export function buildCountryFleet(
  countryId: string,
  positionId: string,
  regionIds: string[],
  currentTurn: number,
  era?: string
): Omit<EnergyPlant, "_id">[] {
  if (regionIds.length === 0) return [];
  const r = rng(hash(`${countryId}:energy`));
  const allowedIds = era ? (ALLOWED_SOURCES_BY_ERA[era] ?? null) : null;
  const sourcePool = allowedIds
    ? ENERGY_SOURCES.filter((s) => allowedIds.includes(s.id))
    : ENERGY_SOURCES;
  const pool = sourcePool.length > 0 ? sourcePool : ENERGY_SOURCES;
  const out: Omit<EnergyPlant, "_id">[] = [];
  const count = 6 + Math.floor(r() * 5); // 6-10 plants
  for (let i = 0; i < count; i++) {
    const src = pool[Math.floor(r() * pool.length)];
    out.push({
      countryId: countryId as CountryId,
      positionId,
      source: src.id,
      name: `${src.label} Plant`,
      icon: src.icon,
      capacityBase: src.baseCapacity,
      tier: Math.floor(r() * 2) as 0 | 1,
      regionId: regionIds[Math.floor(r() * regionIds.length)],
      createdTurn: currentTurn,
    });
  }
  return out;
}

/** Idempotent: seeds a fleet only for (country, energy seat) pairs with zero plants. */
export async function seedEnergyPlants(db: Db, preset: string): Promise<void> {
  const era = eraForPreset(preset);
  const col = getEnergyPlantsCollection(db);
  for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
    const positionId = ENERGY_POSITION_BY_COUNTRY[countryId];
    if (!positionId) continue;
    const existing = await col.countDocuments({ countryId, positionId });
    if (existing > 0) continue;
    const regions = await db.collection("states").find({ countryId }).project({ _id: 1 }).toArray();
    const regionIds = regions.map((s) => String(s._id));
    const fleet = buildCountryFleet(countryId, positionId, regionIds, 1, era);
    if (fleet.length === 0) continue;
    await col.insertMany(fleet.map((p) => ({ _id: new ObjectId(), ...p })));
  }
}
