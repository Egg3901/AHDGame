import type { Db } from "mongodb";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types";
import { allRegionCodes } from "./regionManifest";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";

/**
 * Of the requested codes with no `states` doc, which have SECEDED into a
 * sovereign country of the same id? A region that became its own nation (SCO,
 * WAL) no longer has an aggregate `states` row — it was expanded into
 * sub-regions whose `countryId` is the new nation — so the coarse map region
 * (e.g. the British-Isles "SCO" blob) must resolve to that country, not vanish.
 */
async function secededCountryCodes(db: Db, codes: string[]): Promise<Set<string>> {
  if (codes.length === 0) return new Set();
  const owners = await db
    .collection<State>("states")
    .distinct("countryId", { countryId: { $in: codes as CountryId[] } });
  return new Set(owners.map(String));
}

/**
 * regionCode → current owning countryId, read live from `states` (for the given
 * codes). The single source of "who owns what" for the maps — a transferred
 * region's owner changes here the moment its `states` doc flips.
 */
export async function getRegionOwnership(
  db: Db,
  regionCodes: string[]
): Promise<Record<string, CountryId>> {
  if (regionCodes.length === 0) return {};
  const docs = await db
    .collection<State>("states")
    .find({ _id: { $in: regionCodes } })
    .project({ countryId: 1 })
    .toArray();
  const out: Record<string, CountryId> = {};
  for (const d of docs) {
    if (d.countryId) out[String(d._id)] = d.countryId as CountryId;
  }
  // A coarse region that seceded into its own nation owns itself.
  const seceded = await secededCountryCodes(
    db,
    regionCodes.filter((c) => !(c in out))
  );
  for (const code of seceded) out[code] = code as CountryId;
  return out;
}

export interface RegionDetail {
  countryId: CountryId;
  name: string;
  population: number;
  houseDistricts: number;
  /** Province / regional grouping, used for map coloring (e.g. "Ulster"). */
  region: string;
}

/**
 * regionCode → live display detail (owner + name + population + lower-chamber
 * seats + province), read straight from `states`. Lets the maps render the
 * preset-correct figures the game actually runs on, instead of a static seed
 * baked for one era.
 */
export async function getRegionDetails(
  db: Db,
  regionCodes: string[]
): Promise<Record<string, RegionDetail>> {
  if (regionCodes.length === 0) return {};
  const docs = await db
    .collection<State>("states")
    .find({ _id: { $in: regionCodes } })
    .project({ countryId: 1, name: 1, population: 1, houseDistricts: 1, region: 1 })
    .toArray();
  const out: Record<string, RegionDetail> = {};
  for (const d of docs) {
    if (!d.countryId) continue;
    out[String(d._id)] = {
      countryId: d.countryId as CountryId,
      name: d.name ?? String(d._id),
      population: d.population ?? 0,
      houseDistricts: d.houseDistricts ?? 0,
      region: d.region ?? "",
    };
  }
  // A coarse region that seceded into its own nation owns itself — the world
  // map's British-Isles overlay needs an owner for it or the blob vanishes.
  const seceded = await secededCountryCodes(
    db,
    regionCodes.filter((c) => !(c in out))
  );
  for (const code of seceded) {
    out[code] = {
      countryId: code as CountryId,
      name: getCountryConfig(code as CountryId)?.name ?? code,
      population: 0,
      houseDistricts: 0,
      region: "",
    };
  }
  return out;
}

/**
 * A country's region codes that the map manifest actually has geometry for. The
 * front map draws the host's own regions, so codes with no shard are dropped here
 * rather than fetched and discarded.
 *
 * Takes a WorldEntityId: a conflict host may be a non-playable entity. `states` holds
 * only full-autonomous countries, so such an entity returns `[]` and the caller falls
 * back to static features (or to the territory meter).
 */
export async function regionCodesOfCountry(db: Db, countryId: WorldEntityId): Promise<string[]> {
  const docs = await db
    .collection<State>("states")
    // `State.countryId` is a CountryId; the argument may be any world entity. A
    // non-playable host simply matches nothing, which is the intended result.
    .find({ countryId: countryId as CountryId })
    .project({ _id: 1 })
    .toArray();
  const drawable = new Set(allRegionCodes());
  return docs.map((d) => String(d._id)).filter((code) => drawable.has(code));
}
