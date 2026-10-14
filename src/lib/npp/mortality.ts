/**
 * Under V5, seated NPPs age each game year and can be replaced after death.
 * Native slate financial owners retain their filed people and accounts.
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
import type { Corporation } from "@/lib/db/types/corporation";
import type { CabinetMember } from "@/lib/db/types/cabinet";
import type { CountryLeaderState } from "@/lib/db/types/countryLeaderState";
import { closeCeoTenure, openCeoTenure } from "@/lib/corporations/ceoHistory";
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
    /** Turn of this pass; stamps the successor's caretaker CEO tenure when given. */
    turn?: number;
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

  // A shared financial owner is not each person on its filed slate. Random
  // owner replacement would bypass statutory succession and rewrite mandate
  // custody without changing the original nomination receipt.
  const nativeCandidates = candidates.filter(
    (row) => ["BG", "HU"].includes(row.countryId ?? "US") && isEligibleNppForMortality(row)
  );
  const nativeOwners = nativeCandidates.length
    ? await db.collection<ElectedOfficial>("electedOfficials").distinct("nppId", {
        nppId: { $in: nativeCandidates.map((row) => row._id) },
        seatsHeld: 1,
        $or: [
          { countryId: "BG", "bulgarianFoundingMandate.receiptId": { $exists: true } },
          { countryId: "HU", "hungarianAssemblyMandate.receiptId": { $exists: true } },
        ],
      })
    : [];
  const nativeOwnerIds = new Set(nativeOwners.flatMap((id) => (id ? [id.toHexString()] : [])));

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
  const deadIds: ObjectId[] = [];
  const successions: Array<{ deadId: ObjectId; successor: NPP }> = [];

  for (const npp of candidates) {
    // Belt-and-braces with the query filter above. The pure eligibility rule
    // keeps this shell safe if the query projection or filter changes later.
    if (
      !isEligibleNppForMortality({
        ...npp,
        representsNativeSlate: nativeOwnerIds.has(npp._id.toHexString()),
      })
    )
      continue;
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

    successions.push({ deadId: npp._id as ObjectId, successor: replacement });
    deadIds.push(npp._id as ObjectId);
    deaths += 1;
    replacements += 1;
  }

  if (successions.length > 0) await seatSuccessors(db, successions, now, opts.turn);

  // A dead NPP must not stay on as a company's CEO. Its NPP-run companies are
  // marked vacant, so the caretaker step seats a living NPP next turn (by
  // sector record at v6). Player companies were handed to the successor above.
  if (deadIds.length > 0) {
    await db
      .collection<Corporation>("corporations")
      .updateMany(
        { ceoId: { $in: deadIds }, caretakerCeo: { $exists: false }, ceoVacant: { $ne: true } },
        { $set: { ceoVacant: true, updatedAt: now } }
      );
  }

  return { deaths, replacements };
}

/**
 * The successor also takes the dead NPP's cabinet posts, its national
 * leadership, and any player company it was caretaking (the owner's stash and
 * mandate stay). One batched write per collection for the whole pass.
 */
async function seatSuccessors(
  db: Db,
  successions: Array<{ deadId: ObjectId; successor: NPP }>,
  now: Date,
  turn: number | undefined
): Promise<void> {
  const successorOf = new Map(successions.map((s) => [s.deadId.toHexString(), s.successor]));

  await db.collection<CabinetMember>("cabinetMembers").bulkWrite(
    successions.map(({ deadId, successor }) => ({
      updateMany: {
        filter: { nppId: deadId },
        update: {
          $set: {
            nppId: successor._id as ObjectId,
            characterName: successor.name,
            updatedAt: now,
          },
        },
      },
    })),
    { ordered: false }
  );
  await db.collection<CountryLeaderState>("countryLeaderStates").bulkWrite(
    successions.map(({ deadId, successor }) => ({
      updateMany: {
        filter: { leaderNppId: deadId },
        update: { $set: { leaderNppId: successor._id as ObjectId } },
      },
    })),
    { ordered: false }
  );

  const caretaken = await db
    .collection<Corporation>("corporations")
    .find(
      { ceoId: { $in: successions.map((s) => s.deadId) }, caretakerCeo: { $exists: true } },
      { projection: { _id: 1, ceoId: 1 } }
    )
    .toArray();
  const reseats = caretaken.flatMap((corp) => {
    const successor = corp.ceoId ? successorOf.get(corp.ceoId.toHexString()) : undefined;
    return successor && corp.ceoId ? [{ corp, deadId: corp.ceoId, successor }] : [];
  });
  if (reseats.length === 0) return;
  await db.collection<Corporation>("corporations").bulkWrite(
    reseats.map(({ corp, successor }) => ({
      updateOne: {
        filter: { _id: corp._id },
        update: { $set: { ceoId: successor._id as ObjectId, updatedAt: now } },
      },
    })),
    { ordered: false }
  );
  if (turn == null) return;
  await Promise.all(
    reseats.map(async ({ corp, deadId, successor }) => {
      await closeCeoTenure(db, corp._id, { holderId: deadId, turn });
      await openCeoTenure(db, corp._id, {
        holderId: successor._id as ObjectId,
        ceoType: "npp",
        turn,
      });
    })
  );
}
