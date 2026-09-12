/**
 * Under V5, seated NPPs age each game year and can be replaced after death.
 * This shell applies country gates, persists retirement, and updates office references.
 * @see processNppMortality
 */

import type { Db, ObjectId } from "mongodb";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { CountryId } from "@/lib/constants/countries";
import type { NPP } from "@/lib/db/types/npp";
import type { ElectedOfficial } from "@/lib/db/types/officials";
import type { ElectionCandidate } from "@/lib/db/types/election";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { nppAutonomyAtLeast } from "@/lib/nppAutonomy/featureFlag";
import { generateNPP } from "@/lib/npp/generator";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import {
  isEligibleNppForMortality,
  nppAgeAtYear,
  nppDiesThisTurn,
  randomReplacementBirthYear,
} from "./rules/mortality";

export {
  annualDeathProbability,
  isEligibleNppForMortality,
  nppAgeAtYear,
  nppDiesThisTurn,
  randomReplacementBirthYear,
} from "./rules/mortality";

export interface NppMortalityResult {
  deaths: number;
  replacements: number;
}

/** A minted random successor, ready to insert (needs no further DB reads). */
export type ReplacementMinter = (dead: NPP, year: number) => Promise<NPP>;

/** Production minter: a fully random NPP of the same party, aimed at the same office. */
export async function mintRandomSuccessor(
  db: Db,
  dead: NPP,
  year: number,
  rng: () => number
): Promise<NPP> {
  const countryId = (dead.countryId ?? "US") as CountryId;
  const replacement = await generateNPP({
    state: dead.homeState,
    party: dead.party,
    countryId,
    ...(dead.currentOffice ? { targetOffice: dead.currentOffice } : {}),
    year,
  });
  replacement.sequentialId = await getNextSequentialId(db, "npp");
  replacement.birthYear = randomReplacementBirthYear(year, rng);
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
    now: Date;
    year: number;
    rng: () => number;
    /** Test seam: replaces the generateNPP-backed minter above. */
    mintReplacement?: ReplacementMinter;
  }
): Promise<NppMortalityResult> {
  const { now, year, rng } = opts;
  const mint =
    opts.mintReplacement ?? ((dead: NPP, y: number) => mintRandomSuccessor(db, dead, y, rng));

  const candidates = await db
    .collection<NPP>("npps")
    .find({
      retiredAt: null,
      birthYear: { $ne: null },
      isTechnocrat: { $ne: true },
      currentOffice: { $exists: true, $ne: null },
    })
    .project({
      _id: 1,
      countryId: 1,
      homeState: 1,
      party: 1,
      currentOffice: 1,
      birthYear: 1,
      isTechnocrat: 1,
      retiredAt: 1,
    })
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
    // Belt-and-braces with the query filter above. The pure eligibility rule
    // keeps this shell safe if the query projection or filter changes later.
    if (!isEligibleNppForMortality(npp)) continue;
    const countryId = (npp.countryId ?? "US") as CountryId;
    if (!(await isV5(countryId))) continue;
    const age = nppAgeAtYear(npp, year);
    if (age == null) continue;
    if (!nppDiesThisTurn(age, rng, TURNS_PER_YEAR)) continue;

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

    await db
      .collection<ElectionCandidate>("electionCandidates")
      .updateMany(
        { nppId: npp._id, status: "active" },
        { $set: { status: "withdrawn", withdrawnAt: now } }
      );

    // Head-of-government succession: the successor inherits the office, so a
    // government formed under the dead NPP continues under them rather than
    // pointing at a retired head. Covers pm / president / head-of-state ids.
    const succession: Record<string, unknown> = { updatedAt: now };
    const successionFields = [
      ["pmNppId", "pmName"],
      ["presidentNppId", "presidentName"],
      ["hosNppId", "hosName"],
    ] as const;
    for (const [idField, nameField] of successionFields) {
      const nameUpdates =
        idField === "presidentNppId"
          ? { presidentName: replacement.name, pmName: replacement.name }
          : { [nameField]: replacement.name };
      await db
        .collection<GovernmentFormation>("governmentFormations")
        .updateMany(
          { [idField]: npp._id },
          { $set: { ...succession, ...nameUpdates, [idField]: replacement._id } }
        );
    }

    deaths += 1;
    replacements += 1;
  }

  return { deaths, replacements };
}
