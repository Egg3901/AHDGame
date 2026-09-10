/**
 * V5 NPP aging and mortality.
 *
 * Historically-seeded NPPs (1991/2019 presets) carry a real `birthYear`, and
 * runtime replacements get a generated one, so under V5 autonomy every aged
 * NPP rolls age-based mortality each turn. The dead retire and a new random
 * NPP immediately inherits their office — the seat never goes vacant.
 *
 * Gating: per-country `nppAutonomyAtLeast(db, countryId, "v5")`. Below V5 no
 * NPP ages out no matter how old it gets. NPPs with no `birthYear` (legacy
 * rows) and technocrats (corporate lifecycle, not electoral) are exempt.
 */

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { CountryId } from "@/lib/constants/countries";
import type { GameState } from "@/lib/db/types/gameState";
import type { NPP } from "@/lib/db/types/npp";
import type { ElectedOfficial } from "@/lib/db/types/officials";
import { nppAutonomyAtLeast } from "@/lib/nppAutonomy/featureFlag";
import { generateNPP } from "@/lib/npp/generator";
import { getNextSequentialId } from "@/lib/db/sequentialId";

/** Age in whole game years. Null when the NPP has no birth year on record. */
export function nppAgeAtYear(npp: Pick<NPP, "birthYear">, year: number): number | null {
  if (npp.birthYear == null || !Number.isFinite(npp.birthYear)) return null;
  return year - npp.birthYear;
}

/**
 * Annual death probability for a sitting politician of `age`.
 *
 * Game-tuned Gompertz curve, calibrated to rough US actuarial orders of
 * magnitude: ~0.1%/yr at 30, ~0.6%/yr at 50, ~2%/yr at 65, ~6%/yr at 75,
 * ~16%/yr at 85. Capped at 50%/yr so even the very old sometimes survive a
 * year. Pure — the turn pass divides by TURNS_PER_YEAR for the weekly roll.
 */
export function annualDeathProbability(age: number): number {
  if (!Number.isFinite(age) || age < 0) return 0;
  const p = 0.00005 * Math.exp(0.095 * age);
  return Math.min(p, 0.5);
}

/**
 * Birth year for a freshly generated replacement NPP: a working-age adult
 * (32–68) as of `currentYear`, so replacements age and die in turn rather
 * than being immortal or instantly frail.
 */
export function randomReplacementBirthYear(
  currentYear: number,
  rng: () => number = Math.random
): number {
  const age = 32 + Math.floor(rng() * 37);
  return currentYear - age;
}

export interface NppMortalityResult {
  deaths: number;
  replacements: number;
}

/** A minted random successor, ready to insert (needs no further DB reads). */
export type ReplacementMinter = (dead: NPP, year: number) => Promise<NPP>;

/** Production minter: a fully random NPP of the same party, aimed at the same office. */
export async function mintRandomSuccessor(db: Db, dead: NPP, year: number): Promise<NPP> {
  const countryId = (dead.countryId ?? "US") as CountryId;
  const replacement = await generateNPP({
    state: dead.homeState,
    party: dead.party,
    countryId,
    ...(dead.currentOffice ? { targetOffice: dead.currentOffice } : {}),
    year,
  });
  replacement.sequentialId = await getNextSequentialId(db, "npp");
  replacement.birthYear = randomReplacementBirthYear(year);
  return replacement;
}

/**
 * Roll mortality for every live, aged, non-technocrat NPP in a V5 country.
 * Each death retires the NPP and seats a new random NPP of the same party in
 * the same office(s) immediately.
 */
export async function processNppMortality(
  db: Db,
  opts: {
    now?: Date;
    year?: number;
    rng?: () => number;
    /** Test seam: replaces the generateNPP-backed minter above. */
    mintReplacement?: ReplacementMinter;
  } = {}
): Promise<NppMortalityResult> {
  const now = opts.now ?? new Date();
  const rng = opts.rng ?? Math.random;
  const mint = opts.mintReplacement ?? ((dead: NPP, y: number) => mintRandomSuccessor(db, dead, y));
  const year =
    opts.year ??
    (
      await db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentYear: 1 } })
    )?.currentYear ??
    null;
  if (year == null || !Number.isFinite(year)) return { deaths: 0, replacements: 0 };

  const candidates = await db
    .collection<NPP>("npps")
    .find({ retiredAt: null, birthYear: { $ne: null }, isTechnocrat: { $ne: true } })
    .project({ _id: 1, countryId: 1, homeState: 1, party: 1, currentOffice: 1, birthYear: 1 })
    .toArray();

  // Per-country V5 gate, resolved once per country per pass.
  const v5ByCountry = new Map<string, boolean>();
  const isV5 = async (countryId: CountryId): Promise<boolean> => {
    const key = countryId;
    let v = v5ByCountry.get(key);
    if (v === undefined) {
      v = await nppAutonomyAtLeast(db, countryId, "v5");
      v5ByCountry.set(key, v);
    }
    return v;
  };

  let deaths = 0;
  let replacements = 0;

  for (const npp of candidates) {
    // Belt-and-braces with the query filter above: technocrats run a
    // corporate lifecycle and never age out of it.
    if (npp.isTechnocrat) continue;
    const countryId = (npp.countryId ?? "US") as CountryId;
    if (!(await isV5(countryId))) continue;
    const age = nppAgeAtYear(npp, year);
    if (age == null) continue;
    if (rng() >= annualDeathProbability(age) / TURNS_PER_YEAR) continue;

    const replacement = await mint(npp as NPP, year);
    replacement.createdAt = now;
    replacement.updatedAt = now;
    await db.collection<NPP>("npps").insertOne(replacement);

    await db
      .collection<NPP>("npps")
      .updateOne(
        { _id: npp._id },
        { $set: { retiredAt: now, currentOffice: null, updatedAt: now } }
      );
    await db.collection<ElectedOfficial>("electedOfficials").updateMany(
      { nppId: npp._id },
      {
        $set: {
          nppId: replacement._id as ObjectId,
          characterName: replacement.name,
          updatedAt: now,
        },
      }
    );

    // Head-of-government succession: the successor inherits the office, so a
    // government formed under the dead NPP continues under them rather than
    // pointing at a retired head. Covers pm / president / head-of-state ids.
    const succession: Record<string, unknown> = { updatedAt: now };
    for (const field of ["pmNppId", "presidentNppId", "hosNppId"] as const) {
      await db
        .collection("governmentFormations")
        .updateMany({ [field]: npp._id }, { $set: { ...succession, [field]: replacement._id } });
    }

    deaths += 1;
    replacements += 1;
  }

  return { deaths, replacements };
}
