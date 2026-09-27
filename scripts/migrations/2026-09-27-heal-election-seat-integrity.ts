/**
 * Dry-run-first repair for election seat totals found during the 1953 live-world
 * election audit.
 *
 * Repairs:
 *   - FR Council of the Republic regional totals: 799 -> 320
 *   - NG Senate regional totals: 114 -> 109
 *   - JP Shugiin regional totals: 465 -> 466
 *   - JP Sangiin class totals: 250 -> 248
 *   - election candidates and vote tallies whose parent election no longer exists
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-09-27-heal-election-seat-integrity.ts --live
 *   npx tsx scripts/migrations/2026-09-27-heal-election-seat-integrity.ts --live --env-file=C:\path\to\.env.local
 *   npx tsx scripts/migrations/2026-09-27-heal-election-seat-integrity.ts --live --apply
 *
 * The default target is MONGODB_URI. Pass --live to select MONGODB_URI_LIVE.
 * Nothing is written unless --apply is present. This migration intentionally
 * supports only a 1953-default world.
 */
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient, type ObjectId } from "mongodb";
import { apportionSeats } from "../../src/lib/country/seatApportionment";
import { frRegions1953 } from "../../src/lib/countries/fr/data/frRegions1953";
import {
  getJpSangiinClassSeats,
  getJpSangiinSeats,
  getJpShugiinSeats,
  JP_SHUGIIN_SEATS,
} from "../../src/lib/countries/jp/data/jpSeats";
import { ngRegions1953 } from "../../src/lib/countries/ng/data/ngRegions1953";

const envFileArgument = process.argv.find((argument) => argument.startsWith("--env-file="));
const envFile = envFileArgument?.slice("--env-file=".length);
dotenv.config({
  path: envFile ? path.resolve(envFile) : path.resolve(process.cwd(), ".env.local"),
});

function regionalSenateMap(
  regions: Array<{ _id: string | ObjectId; stateSenateSeats?: number }>
): Record<string, number> {
  return Object.fromEntries(
    regions.map((region) => {
      if (!Number.isInteger(region.stateSenateSeats) || (region.stateSenateSeats ?? 0) <= 0) {
        throw new Error(`Invalid stateSenateSeats for ${region._id.toString()}`);
      }
      return [region._id.toString(), region.stateSenateSeats!];
    })
  );
}

const FR_SENATE_1953 = regionalSenateMap(frRegions1953);
const NG_SENATE_1953 = regionalSenateMap(ngRegions1953);

// Historical broken maps are deliberately frozen here. They let the migration
// distinguish a chamber that exactly matches the old bad apportionment from a
// genuinely vacant chamber, so it can add missing seats without inventing
// officeholders in regions whose shortfall has another cause.
const FR_SENATE_1953_LEGACY: Record<string, number> = {
  FR_IDF: 180,
  FR_NOR: 105,
  FR_EST: 86,
  FR_OUE: 115,
  FR_SOU: 80,
  FR_ARA: 103,
  FR_MED: 70,
  FR_CEN: 60,
};
const NG_SENATE_1953_LEGACY: Record<string, number> = {
  NORTH_WEST: 21,
  NORTH_EAST: 18,
  NORTH_CENTRAL: 21,
  SOUTH_WEST: 18,
  SOUTH_SOUTH: 18,
  SOUTH_EAST: 18,
};

type ElectionRow = {
  _id: ObjectId;
  countryId: string;
  electionType: string;
  state: string;
  chamberClass?: 1 | 2;
  status: "active" | "upcoming";
  totalSeats: number;
  updatedAt?: Date;
};

type StateRow = {
  _id: string;
  countryId: string;
  stateSenateSeats?: number;
};

type OfficialRow = {
  _id: ObjectId;
  countryId: string;
  officeType: string;
  state: string;
  chamberClass?: 1 | 2;
  characterId?: ObjectId | null;
  nppId?: ObjectId | null;
  party?: string;
  seatsHeld?: number;
  updatedAt?: Date;
};

type SeatFamily = {
  countryId: string;
  electionType: string;
  officeType: string;
  seats: Record<string, number>;
  legacySeats: Record<string, number>;
  chamberClass?: 1 | 2;
};

type OrphanCandidate = {
  _id: ObjectId;
  electionId: ObjectId;
  characterId?: ObjectId;
};

function familyKey(row: Pick<SeatFamily, "countryId" | "electionType" | "chamberClass">): string {
  return `${row.countryId}|${row.electionType}|${row.chamberClass ?? ""}`;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const useLive = args.has("--live");
  const apply = args.has("--apply");
  const uriKey = useLive ? "MONGODB_URI_LIVE" : "MONGODB_URI";
  const uri = process.env[uriKey];
  if (!uri) throw new Error(`${uriKey} is not set`);

  const client = new MongoClient(uri, { directConnection: !uri.startsWith("mongodb+srv://") });
  await client.connect();

  try {
    const db = client.db();
    const gameState = await db
      .collection<{ _id: string; preset?: string; isProcessing?: boolean }>("gameState")
      .findOne({ _id: "current" }, { projection: { preset: 1, isProcessing: 1 } });
    if (gameState?.preset !== "1953-default") {
      throw new Error(`Expected 1953-default, found ${gameState?.preset ?? "missing preset"}`);
    }

    const jpShugiin = getJpShugiinSeats(gameState.preset);
    const jpSangiinClass1 = Object.fromEntries(
      Object.keys(jpShugiin).map((state) => [
        state,
        getJpSangiinClassSeats(gameState.preset, state, 1),
      ])
    );
    const jpSangiinClass2 = Object.fromEntries(
      Object.keys(jpShugiin).map((state) => [
        state,
        getJpSangiinClassSeats(gameState.preset, state, 2),
      ])
    );
    const jpSangiinLegacy = getJpSangiinSeats(gameState.preset);
    const jpSangiinLegacyClassSeats = Object.fromEntries(
      Object.entries(jpSangiinLegacy).map(([state, seats]) => [state, Math.ceil(seats / 2)])
    );
    const families: SeatFamily[] = [
      {
        countryId: "FR",
        electionType: "senat",
        officeType: "senator",
        seats: FR_SENATE_1953,
        legacySeats: FR_SENATE_1953_LEGACY,
      },
      {
        countryId: "NG",
        electionType: "senate",
        officeType: "senate",
        seats: NG_SENATE_1953,
        legacySeats: NG_SENATE_1953_LEGACY,
      },
      {
        countryId: "JP",
        electionType: "shugiin",
        officeType: "shugiin",
        seats: jpShugiin,
        legacySeats: JP_SHUGIIN_SEATS,
      },
      {
        countryId: "JP",
        electionType: "sangiin",
        officeType: "sangiin",
        chamberClass: 1,
        seats: jpSangiinClass1,
        legacySeats: jpSangiinLegacyClassSeats,
      },
      {
        countryId: "JP",
        electionType: "sangiin",
        officeType: "sangiin",
        chamberClass: 2,
        seats: jpSangiinClass2,
        legacySeats: jpSangiinLegacyClassSeats,
      },
    ];
    const familyByKey = new Map(families.map((family) => [familyKey(family), family]));
    const repairBlockers: string[] = [];

    const stateFamilies = families.filter((family) => ["FR", "NG"].includes(family.countryId));
    const states = await db
      .collection<StateRow>("states")
      .find(
        { countryId: { $in: stateFamilies.map((family) => family.countryId) } },
        { projection: { countryId: 1, stateSenateSeats: 1 } }
      )
      .toArray();
    const stateById = new Map(states.map((state) => [state._id, state]));
    const stateRepairs = stateFamilies.flatMap((family) =>
      Object.entries(family.seats).flatMap(([state, expected]) => {
        const current = stateById.get(state);
        if (!current || current.countryId !== family.countryId) {
          repairBlockers.push(`${family.countryId}/${state} is missing from the states collection`);
          return [];
        }
        return current.stateSenateSeats !== expected ? [{ state: current, expected }] : [];
      })
    );
    const stateOps = stateRepairs.map(({ state, expected }) => ({
      updateOne: {
        filter: {
          _id: state._id,
          countryId: state.countryId,
          ...(state.stateSenateSeats === undefined
            ? { stateSenateSeats: { $exists: false } }
            : { stateSenateSeats: state.stateSenateSeats }),
        },
        update: { $set: { stateSenateSeats: expected } },
      },
    }));

    const liveElections = await db
      .collection<ElectionRow>("elections")
      .find(
        {
          $or: families.map((family) => ({
            countryId: family.countryId,
            electionType: family.electionType,
            ...(family.chamberClass ? { chamberClass: family.chamberClass } : {}),
          })),
          status: { $in: ["active", "upcoming"] },
        },
        {
          projection: {
            countryId: 1,
            electionType: 1,
            state: 1,
            chamberClass: 1,
            status: 1,
            totalSeats: 1,
          },
        }
      )
      .toArray();
    const electionRepairs = liveElections.flatMap((election) => {
      const family = familyByKey.get(familyKey(election));
      const expected = family?.seats[election.state];
      if (expected === undefined) {
        repairBlockers.push(
          `${election.countryId}/${election.electionType}/${election.state} has no authoritative seat map entry`
        );
        return [];
      }
      return election.totalSeats !== expected ? [{ election, expected }] : [];
    });

    const officials = await db
      .collection<OfficialRow>("electedOfficials")
      .find(
        {
          $or: families.map((family) => ({
            countryId: family.countryId,
            officeType: family.officeType,
            ...(family.chamberClass ? { chamberClass: family.chamberClass } : {}),
          })),
        },
        {
          projection: {
            countryId: 1,
            officeType: 1,
            state: 1,
            chamberClass: 1,
            characterId: 1,
            nppId: 1,
            party: 1,
            seatsHeld: 1,
          },
        }
      )
      .toArray();
    const officialRepairs: Array<{ official: OfficialRow; expected: number }> = [];
    const underfilledOfficialRegions: Array<{
      countryId: string;
      officeType: string;
      state: string;
      chamberClass?: 1 | 2;
      current: number;
      target: number;
    }> = [];
    for (const family of families) {
      for (const [state, target] of Object.entries(family.seats)) {
        const rows = officials.filter(
          (official) =>
            official.countryId === family.countryId &&
            official.officeType === family.officeType &&
            official.state === state &&
            (official.chamberClass ?? undefined) === family.chamberClass
        );
        const currentTotal = rows.reduce((sum, row) => sum + (row.seatsHeld ?? 1), 0);
        if (rows.length === 0) {
          underfilledOfficialRegions.push({
            countryId: family.countryId,
            officeType: family.officeType,
            state,
            chamberClass: family.chamberClass,
            current: 0,
            target,
          });
          continue;
        }
        if (currentTotal === target) continue;
        // Add seats only when the chamber still exactly matches the frozen broken
        // map. Any other shortfall may contain legitimate vacancies and is left
        // for the next election rather than manufacturing officeholders.
        const legacyTarget = family.legacySeats[state];
        if (currentTotal < target && currentTotal !== legacyTarget) {
          underfilledOfficialRegions.push({
            countryId: family.countryId,
            officeType: family.officeType,
            state,
            chamberClass: family.chamberClass,
            current: currentTotal,
            target,
          });
          continue;
        }
        const playerRows = rows.filter((row) => row.characterId);
        const playerSeats = playerRows.reduce((sum, row) => sum + (row.seatsHeld ?? 1), 0);
        if (playerSeats > target) {
          repairBlockers.push(
            `${family.countryId}/${family.officeType}/${state} has ${playerSeats} player-held seats but a target of ${target}`
          );
          continue;
        }
        const adjustableRows = rows.filter((row) => !row.characterId);
        if (adjustableRows.length === 0) {
          repairBlockers.push(
            `${family.countryId}/${family.officeType}/${state} has no adjustable NPP rows for ${currentTotal} -> ${target}`
          );
          continue;
        }
        const allocation = apportionSeats(
          Object.fromEntries(adjustableRows.map((row) => [row._id.toString(), row.seatsHeld ?? 1])),
          target - playerSeats
        );
        for (const row of adjustableRows) {
          const expected = allocation[row._id.toString()] ?? 0;
          if ((row.seatsHeld ?? 1) !== expected) officialRepairs.push({ official: row, expected });
        }
      }
    }

    const orphanCandidates = await db
      .collection<OrphanCandidate>("electionCandidates")
      .aggregate<OrphanCandidate>([
        {
          $lookup: {
            from: "elections",
            localField: "electionId",
            foreignField: "_id",
            as: "parent",
          },
        },
        { $match: { "parent.0": { $exists: false } } },
        { $project: { _id: 1, electionId: 1, characterId: 1 } },
      ])
      .toArray();
    const orphanCharacterIds = orphanCandidates.flatMap((candidate) =>
      candidate.characterId ? [candidate.characterId] : []
    );
    const playerCharacters =
      orphanCharacterIds.length === 0
        ? []
        : await db
            .collection<{ _id: ObjectId; userId?: ObjectId | string | null }>("characters")
            .find(
              { _id: { $in: orphanCharacterIds }, userId: { $ne: null } },
              { projection: { _id: 1 } }
            )
            .toArray();
    const playerCharacterIds = new Set(
      playerCharacters.map((character) => character._id.toString())
    );
    const playerOrphanCandidates = orphanCandidates.filter(
      (candidate) =>
        candidate.characterId && playerCharacterIds.has(candidate.characterId.toString())
    );
    const deletableOrphanCandidates = orphanCandidates.filter(
      (candidate) =>
        !candidate.characterId || !playerCharacterIds.has(candidate.characterId.toString())
    );
    if (playerOrphanCandidates.length > 0) {
      repairBlockers.push(
        `${playerOrphanCandidates.length} orphan candidate row(s) belong to player characters`
      );
    }
    const orphanTallies = await db
      .collection<{ _id: ObjectId; electionId: ObjectId }>("electionVoteTallies")
      .aggregate<{ _id: ObjectId; electionId: ObjectId }>([
        {
          $lookup: {
            from: "elections",
            localField: "electionId",
            foreignField: "_id",
            as: "parent",
          },
        },
        { $match: { "parent.0": { $exists: false } } },
        { $project: { _id: 1, electionId: 1 } },
      ])
      .toArray();

    console.log(
      JSON.stringify(
        {
          target: useLive ? "live" : "local",
          mode: apply ? "apply" : "dry-run",
          preset: gameState.preset,
          stateRepairs: stateRepairs.map(({ state, expected }) => ({
            countryId: state.countryId,
            state: state._id,
            from: state.stateSenateSeats ?? null,
            to: expected,
          })),
          electionRepairs: electionRepairs.map(({ election, expected }) => ({
            countryId: election.countryId,
            electionType: election.electionType,
            state: election.state,
            chamberClass: election.chamberClass ?? null,
            from: election.totalSeats,
            to: expected,
          })),
          officialRepairs: officialRepairs.map(({ official, expected }) => ({
            countryId: official.countryId,
            officeType: official.officeType,
            state: official.state,
            chamberClass: official.chamberClass ?? null,
            party: official.party ?? null,
            holderType: official.characterId ? "player" : official.nppId ? "npp" : "aggregate",
            from: official.seatsHeld ?? 1,
            to: expected,
          })),
          underfilledOfficialRegions,
          repairBlockers,
          orphanCandidatesToDelete: deletableOrphanCandidates.length,
          playerOrphanCandidatesBlocked: playerOrphanCandidates.length,
          orphanTalliesToDelete: orphanTallies.length,
        },
        null,
        2
      )
    );

    if (!apply) return;
    if (repairBlockers.length > 0) {
      throw new Error(
        `Repair blockers must be resolved before apply: ${repairBlockers.join("; ")}`
      );
    }
    const appliedAt = new Date();
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        // Re-read inside the transaction immediately before writes. Planning can
        // take long enough for a turn to start or the preset to change.
        const applyState = await db
          .collection<{ _id: string; preset?: string; isProcessing?: boolean }>("gameState")
          .findOne({ _id: "current" }, { projection: { preset: 1, isProcessing: 1 }, session });
        if (applyState?.preset !== gameState.preset) {
          throw new Error(
            `World preset changed during planning: ${gameState.preset} -> ${applyState?.preset ?? "missing preset"}`
          );
        }
        if (applyState?.isProcessing) {
          throw new Error("Turn processing is active; refusing to apply election repairs");
        }

        if (stateOps.length > 0) {
          const result = await db
            .collection<StateRow>("states")
            .bulkWrite(stateOps, { ordered: false, session });
          if (result.matchedCount !== stateOps.length) {
            throw new Error(`State repair race: matched ${result.matchedCount}/${stateOps.length}`);
          }
        }
        if (electionRepairs.length > 0) {
          const result = await db.collection<ElectionRow>("elections").bulkWrite(
            electionRepairs.map(({ election, expected }) => ({
              updateOne: {
                filter: {
                  _id: election._id,
                  status: election.status,
                  totalSeats: election.totalSeats,
                },
                update: { $set: { totalSeats: expected, updatedAt: appliedAt } },
              },
            })),
            { ordered: false, session }
          );
          if (result.matchedCount !== electionRepairs.length) {
            throw new Error(
              `Election repair race: matched ${result.matchedCount}/${electionRepairs.length}`
            );
          }
        }
        if (officialRepairs.length > 0) {
          const operations = officialRepairs.map(({ official, expected }) =>
            expected === 0
              ? {
                  deleteOne: {
                    filter: {
                      _id: official._id,
                      ...(official.seatsHeld === undefined
                        ? { seatsHeld: { $exists: false } }
                        : { seatsHeld: official.seatsHeld }),
                    },
                  },
                }
              : {
                  updateOne: {
                    filter: {
                      _id: official._id,
                      ...(official.seatsHeld === undefined
                        ? { seatsHeld: { $exists: false } }
                        : { seatsHeld: official.seatsHeld }),
                    },
                    update: { $set: { seatsHeld: expected, updatedAt: appliedAt } },
                  },
                }
          );
          const result = await db
            .collection<OfficialRow>("electedOfficials")
            .bulkWrite(operations, { ordered: false, session });
          if (result.matchedCount + result.deletedCount !== operations.length) {
            throw new Error(
              `Official repair race: matched ${result.matchedCount + result.deletedCount}/${operations.length}`
            );
          }
        }
        if (deletableOrphanCandidates.length > 0) {
          const result = await db
            .collection("electionCandidates")
            .deleteMany(
              { _id: { $in: deletableOrphanCandidates.map((candidate) => candidate._id) } },
              { session }
            );
          if (result.deletedCount !== deletableOrphanCandidates.length) {
            throw new Error(
              `Candidate repair race: deleted ${result.deletedCount}/${deletableOrphanCandidates.length}`
            );
          }
        }
        if (orphanTallies.length > 0) {
          const result = await db
            .collection("electionVoteTallies")
            .deleteMany({ _id: { $in: orphanTallies.map((tally) => tally._id) } }, { session });
          if (result.deletedCount !== orphanTallies.length) {
            throw new Error(
              `Tally repair race: deleted ${result.deletedCount}/${orphanTallies.length}`
            );
          }
        }
      });
    } finally {
      await session.endSession();
    }

    console.log("Applied election seat-integrity repairs. Rerun without --apply to verify.");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
