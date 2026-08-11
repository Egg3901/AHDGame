import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import {
  getBranches,
  getUnitTypesForYear,
  POSTURES,
  type UnitArchetype,
} from "@/lib/constants/military";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import { resolveOrderOfBattle } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * Maximum tech tier seeded per era. Prevents modern precision-guided munitions,
 * stealth aircraft, and network-centric warfare systems appearing in historical worlds.
 * Tier 0–1 = WWII/early Cold War conventional; 2 = guided-missile era; 3 = modern.
 */
export const MAX_TECH_TIER_BY_ERA: Partial<Record<string, number>> = {
  "1953": 1,
  "1979": 2,
  "1991": 2,
  "1999": 2,
  "2007": 3,
};

/**
 * The tech-tier ceiling for a preset — the same gate the seeder applies to starting rosters,
 * exposed so procurement cannot route around it.
 *
 * Defence contracts deliver materiel at a grade set by the supplying corporation's R&D, and
 * without this a 1953 world could be handed modern kit simply by researching for it. The era
 * ceiling wins over corporate capability, exactly as it does over the seeded roster.
 */
export function maxTechTierForPreset(preset: string): number {
  return MAX_TECH_TIER_BY_ERA[eraForPreset(preset)] ?? 3;
}

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

const ORDINALS = [
  "1st",
  "2nd",
  "3rd",
  "4th",
  "5th",
  "7th",
  "9th",
  "11th",
  "12th",
  "18th",
  "24th",
  "82nd",
  "101st",
];
const DESIG = [
  "Alpha",
  "Bravo",
  "Vanguard",
  "Sentinel",
  "Iron",
  "Thunder",
  "Tempest",
  "Aegis",
  "Falcon",
  "Trident",
];

/**
 * Deterministic starting roster for a country. Pure: same (countryId, regionIds, era,
 * startingYear) always yields the same units. Returns [] for countries with no
 * era-active branches or no regions to station in. Tech tiers are capped to
 * era-appropriate maximums; branches/unit types founded after startingYear are omitted.
 */
export function buildCountryRoster(
  countryId: string,
  regionIds: string[],
  currentTurn: number,
  era?: string,
  startingYear?: number
): Omit<MilitaryUnit, "_id">[] {
  const branches = getBranches(countryId, startingYear);
  if (branches.length === 0 || regionIds.length === 0) return [];
  const maxTier = era ? (MAX_TECH_TIER_BY_ERA[era] ?? 3) : 3;
  const units: Omit<MilitaryUnit, "_id">[] = [];
  const authored = resolveOrderOfBattle(countryId, era);

  for (const br of branches) {
    const r = rng(hash(`${countryId}:${br.id}`));
    const types = getUnitTypesForYear(br.domain, startingYear);
    if (types.length === 0) continue;

    // Authored composition for branches the table names; legacy random draw for
    // everything else. A 1953-pegged table cannot name a 1959 rocket force, so
    // "unnamed" must mean "generate", never "seed nothing" — otherwise those
    // services disappear from every later era.
    const entries = authored?.filter((e) => e.branchId === br.id) ?? [];

    // Authored branches get an explicit per-unit archetype list. An archetype
    // that does not exist yet in this era is dropped — the era gate wins over
    // authored content.
    const authoredPicks: UnitArchetype[] = [];
    for (const entry of entries) {
      const archetype = types.find((x) => x.type === entry.type);
      if (!archetype) continue;
      for (let i = 0; i < entry.count; i++) authoredPicks.push(archetype);
    }

    // Keyed on authoredPicks, NOT entries: if every authored archetype for this
    // branch was dropped by the era gate, `entries.length > 0` with an empty
    // picks list would seed zero units — the exact silent-zero failure this plan
    // rejects for unnamed branches. Falling back to random generation is the
    // consistent behaviour. No shipped data triggers this (no authored type
    // carries an establishedYear), but any future era override could.
    const isAuthored = authoredPicks.length > 0;
    // The count draw stays on the unauthored path ONLY, in its original position.
    const count = isAuthored ? authoredPicks.length : 3 + Math.floor(r() * 3);

    for (let i = 0; i < count; i++) {
      // CRITICAL: the unauthored type draw stays HERE, inside the per-unit loop.
      // Hoisting it above the loop reorders the shared r() sequence and silently
      // changes every unauthored country's roster.
      const t = isAuthored ? authoredPicks[i] : types[Math.floor(r() * types.length)];
      const posture = POSTURES[Math.floor(r() * POSTURES.length)].id;
      const rawTier = Math.floor(r() * 4);
      const techTier = Math.min(rawTier, maxTier) as 0 | 1 | 2 | 3;
      const readiness = Math.round(55 + r() * 43);
      const name = `${ORDINALS[Math.floor(r() * ORDINALS.length)]} ${DESIG[Math.floor(r() * DESIG.length)]} ${t.type}`;
      units.push({
        countryId: countryId as CountryId,
        branchId: br.id,
        domain: br.domain,
        name,
        type: t.type,
        icon: t.icon,
        posture,
        techTier,
        personnel: t.personnel,
        readiness,
        basePower: t.power,
        upkeepBase: t.upkeep,
        vet: Math.floor(r() * 4) as 0 | 1 | 2 | 3,
        xp: Math.floor(r() * 80),
        equipment: {
          firepower: 1 + Math.floor(r() * 2),
          protection: Math.floor(r() * 3),
          support: Math.floor(r() * 3),
        },
        drill: null,
        theaterId: "reserve",
        assignedGeneralId: null,
        createdTurn: currentTurn,
      });
    }
  }
  return units;
}

/** Idempotent: seeds a per-country roster only when that country has zero units. */
export async function seedMilitaryUnits(db: Db, preset: string): Promise<void> {
  const era = eraForPreset(preset);
  const startingYear = getStartingYearForPreset(preset);
  const col = getMilitaryUnitsCollection(db);

  // Which countries already have units, in one read rather than a
  // countDocuments each. `distinct` answers exactly the ">0 units" question the
  // per-country count was asked for.
  const alreadySeeded = new Set<string>(await col.distinct("countryId"));

  // Staged and inserted once at the end: buildCountryRoster is pure and seeds
  // its RNG per country, so no row depends on a prior country's insert.
  const staged: MilitaryUnit[] = [];

  for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
    if (getBranches(countryId, startingYear).length === 0) continue;
    if (alreadySeeded.has(countryId)) continue;
    const regions = await db.collection("states").find({ countryId }).project({ _id: 1 }).toArray();
    const regionIds = regions.map((s) => String(s._id));
    const roster = buildCountryRoster(countryId, regionIds, 1, era, startingYear);
    if (roster.length === 0) continue;
    staged.push(...roster.map((u) => ({ _id: new ObjectId(), ...u })));
  }

  if (staged.length > 0) await col.insertMany(staged);
}
