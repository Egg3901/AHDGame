import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { NuclearProgram } from "@/lib/db/types/nuclearProgram";
import { getNuclearProgramsCollection } from "@/lib/db/collections/nuclearPrograms";

/**
 * Historical nuclear-programme seeding for the founding cold-war powers.
 *
 * Era-aware: for the world's seed year, each capable country adopts exactly
 * the tree nodes whose historical adoption year has already passed, and gets
 * a game-scale stockpile interpolated between anchor years. The data is inert
 * while the Cold War subsystem is off (nothing reads it), so seeding is
 * unconditional and harmless.
 *
 * NEVER clobbers: a country whose doc already has adopted nodes is skipped,
 * so re-runs, live-world migrations, and resets cannot wipe player progress.
 * `nuclearPrograms` is deliberately NOT in RESET_DROP_COLLECTIONS and no
 * later seeder writes the collection (checked 2026-08-23: the only writers
 * are the cabinet nuclear routes, the production turn, and this seeder).
 */

/** node key -> historical adoption year, per country. */
const HISTORICAL_ADOPTION: Record<string, Record<string, number>> = {
  US: {
    "device-fission": 1945,
    "device-boosted": 1951,
    "device-thermo": 1952,
    "device-mirv": 1970,
    "delivery-bombers": 1948,
    "delivery-irbm": 1958,
    "delivery-icbm": 1959,
    "delivery-slbm": 1960,
  },
  RU: {
    "device-fission": 1949,
    "device-boosted": 1953,
    "device-thermo": 1955,
    "device-mirv": 1973,
    "delivery-bombers": 1954,
    "delivery-irbm": 1957,
    "delivery-icbm": 1959,
    "delivery-slbm": 1963,
  },
  UK: {
    "device-fission": 1952,
    "device-boosted": 1953,
    "device-thermo": 1957,
    // Thor squadrons under Project Emily; no UK ICBM was ever fielded.
    "delivery-bombers": 1955,
    "delivery-irbm": 1959,
    // Polaris boats enter service; the UK skips the ICBM rung entirely.
    "delivery-slbm": 1968,
  },
};

/** Game-scale stockpile anchors (NOT real-world counts), year -> warheads. */
const WARHEAD_ANCHORS: Record<string, [year: number, warheads: number][]> = {
  US: [
    [1945, 1],
    [1953, 25],
    [1959, 60],
    [1968, 90],
  ],
  RU: [
    [1949, 1],
    [1953, 8],
    [1959, 30],
    [1968, 70],
  ],
  UK: [
    [1952, 1],
    [1953, 2],
    [1959, 8],
    [1968, 12],
  ],
};

/** Nodes historically adopted by `year` for one country (turn value 1). */
export function historicalAdoptedNodes(countryId: string, year: number): Record<string, number> {
  const table = HISTORICAL_ADOPTION[countryId] ?? {};
  const adopted: Record<string, number> = {};
  for (const [key, adoptionYear] of Object.entries(table)) {
    if (adoptionYear <= year) adopted[key] = 1;
  }
  return adopted;
}

/** Game-scale warheads for one country at `year`: linear between anchors, floor 0. */
export function historicalWarheads(countryId: string, year: number): number {
  const anchors = WARHEAD_ANCHORS[countryId];
  if (!anchors || anchors.length === 0) return 0;
  const [firstYear] = anchors[0];
  if (year < firstYear) return 0;
  const last = anchors[anchors.length - 1];
  if (year >= last[0]) return last[1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [y0, w0] = anchors[i];
    const [y1, w1] = anchors[i + 1];
    if (year >= y0 && year < y1) {
      const t = (year - y0) / (y1 - y0);
      return Math.max(0, Math.round(w0 + (w1 - w0) * t));
    }
  }
  return 0;
}

export interface SeedNuclearProgramsResult {
  seeded: CountryId[];
  skipped: CountryId[];
}

/**
 * Upsert historical nuclearPrograms docs for the capable powers at `year`.
 * Skips any country whose doc already has adopted nodes (live progress wins).
 * A country with no historically adopted nodes at `year` gets no doc at all
 * (absent doc = programme never opened, the collection's own convention).
 */
export async function seedNuclearPrograms(
  db: Db,
  { year }: { year: number }
): Promise<SeedNuclearProgramsResult> {
  const col = getNuclearProgramsCollection(db);
  const seeded: CountryId[] = [];
  const skipped: CountryId[] = [];
  for (const countryId of Object.keys(HISTORICAL_ADOPTION) as CountryId[]) {
    const adopted = historicalAdoptedNodes(countryId, year);
    if (Object.keys(adopted).length === 0) continue;
    const existing = await col.findOne({ _id: countryId });
    if (existing && Object.keys(existing.adopted ?? {}).length > 0) {
      skipped.push(countryId);
      continue;
    }
    const doc: Omit<NuclearProgram, "_id"> = {
      adopted,
      warheads: historicalWarheads(countryId, year),
      productionRate: 0,
      updatedAt: new Date(),
    };
    await col.updateOne({ _id: countryId }, { $set: doc }, { upsert: true });
    seeded.push(countryId);
  }
  return { seeded, skipped };
}
