/**
 * Russia replaces Congress only with both certified, viable Assembly chambers.
 * materializeRussianAssemblySeating archives Congress and commits offices,
 * owner mirrors, chamber totals and its handover receipt in one transaction.
 */
import { createHash } from "node:crypto";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { Character, NPP, CountryGameState, ElectedOfficial, State } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import {
  RUSSIAN_DUMA_RESULTS_COLLECTION,
  type RussianDumaResultRecord,
} from "./dumaElectionResult";
import {
  RUSSIAN_COUNCIL_RESULTS_COLLECTION,
  type RussianCouncilResultRecord,
} from "./councilElectionResult";
import { loadRussianAssemblySeatingInputs } from "./assemblySeatingInputs";
import type { RussianAssemblySeat } from "./rules/assemblySeating";
import type { RussianAssemblyVacancyReason } from "./rules/assemblyOwnerEligibility";
export const RUSSIAN_ASSEMBLY_SEATINGS_COLLECTION = "russianAssemblySeatings";
export const RUSSIAN_ASSEMBLY_ARCHIVES_COLLECTION = "russianAssemblyOfficeArchives";
export interface RussianAssemblySeatingRecord {
  _id: string;
  countryId: "RU";
  preset: "1991-default";
  dumaRootCohortId: ObjectId;
  councilRootCohortId: ObjectId;
  dumaResultId: string;
  councilResultId: string;
  seatedOnTurn: number;
  termEndTurn: number;
  dumaTermEndTurn: number;
  councilTermEndTurn: number;
  createdAt: Date;
  officialIds: ObjectId[];
  dumaSeats: number;
  councilSeats: number;
  dumaVacancies: number;
  councilVacancies: number;
  unavailableWinners: Array<RussianAssemblySeat & { reason: RussianAssemblyVacancyReason }>;
}
interface Archive {
  _id: string;
  preset: "1991-default";
  seatingId: string;
  turn: number;
  official: ElectedOfficial;
}
export async function materializeRussianAssemblySeating(input: {
  db: Db;
  session: ClientSession;
  turn: number;
  now: Date;
}): Promise<boolean> {
  const { db, session, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Assembly seating needs an active transaction, turn and time");
  const loaded = await loadRussianAssemblySeatingInputs(db, session, turn);
  if (!loaded) return false;
  const {
    country,
    duma,
    council,
    dumaRoot,
    councilRoot,
    plan,
    allocation,
    regions,
    congress,
    governmentOffices,
    termEndTurn,
    dumaTermEndTurn,
    councilTermEndTurn,
  } = loaded;
  const seatingId = `${dumaRoot.toHexString()}:${councilRoot.toHexString()}`;
  if (
    await db
      .collection<RussianAssemblySeatingRecord>(RUSSIAN_ASSEMBLY_SEATINGS_COLLECTION)
      .findOne({ _id: seatingId }, { session, projection: { _id: 1 } })
  )
    throw new Error("Assembly seating receipt exists without its activation marker");
  const rows: ElectedOfficial[] = plan.seats.map((row) => ({
    _id: new ObjectId(
      createHash("sha256").update(`${seatingId}:${row.candidateId}`).digest("hex").slice(0, 24)
    ),
    countryId: "RU",
    officeType: row.officeType,
    characterId: row.isNpc ? null : new ObjectId(row.ownerId),
    nppId: row.isNpc ? new ObjectId(row.ownerId) : null,
    isNPP: row.isNpc,
    characterName: row.name,
    party: row.party,
    state: row.state,
    constituencyId: row.seatId,
    seatsHeld: row.seatsHeld,
    seatSource: row.seatSource,
    electedAt: now,
    createdAt: now,
    updatedAt: now,
    termEnds: new Date(
      now.getTime() +
        ((row.officeType === "dumaDeputy" ? dumaTermEndTurn : councilTermEndTurn) - turn) *
          MS_PER_TURN
    ),
  }));
  if (congress.length) {
    await db.collection<Archive>(RUSSIAN_ASSEMBLY_ARCHIVES_COLLECTION).insertMany(
      congress.map((official) => ({
        _id: `${seatingId}:${official._id.toHexString()}`,
        preset: "1991-default",
        seatingId,
        turn,
        official,
      })),
      { session }
    );
    await db.collection<ElectedOfficial>("electedOfficials").deleteMany(
      {
        _id: { $in: congress.map((row) => row._id) },
        countryId: "RU",
        officeType: "congressDeputy",
      },
      { session }
    );
  }
  await db
    .collection<Character>("characters")
    .updateMany(
      { countryId: "RU", "currentOffice.type": "congressDeputy" },
      { $set: { currentOffice: null, updatedAt: now } },
      { session }
    );
  await db
    .collection<NPP>("npps")
    .updateMany(
      { countryId: "RU", "currentOffice.type": "congressDeputy" },
      { $set: { currentOffice: null, updatedAt: now }, $unset: { seatsHeld: "" } },
      { session }
    );
  await db.collection<ElectedOfficial>("electedOfficials").insertMany(rows, { session });
  const owners = new Map<
    string,
    {
      ownerId: string;
      isNpc: boolean;
      officeType: RussianAssemblySeat["officeType"];
      seatsHeld: number;
      seatId: string;
      state: string;
      party: string;
      electionId: string;
    }
  >();
  for (const row of plan.seats) {
    const key = `${row.isNpc ? "npc" : "player"}:${row.ownerId}`;
    const old = owners.get(key);
    owners.set(key, {
      ownerId: row.ownerId,
      isNpc: row.isNpc,
      officeType: row.officeType,
      seatsHeld: (old?.seatsHeld ?? 0) + row.seatsHeld,
      seatId: row.seatId,
      state: row.state,
      party: row.party,
      electionId: row.electionId,
    });
  }
  for (const isNpc of [false, true]) {
    const selected = [...owners.values()].filter((row) => row.isNpc === isNpc);
    if (!selected.length) continue;
    const operations = selected.map((row) => ({
      updateOne: {
        filter: { _id: new ObjectId(row.ownerId), countryId: "RU" },
        update: {
          $set: {
            currentOffice: governmentOffices.get(`${isNpc ? "npc" : "player"}:${row.ownerId}`) ?? {
              type: row.officeType,
              state: isNpc ? "RU" : row.state,
              ...(!isNpc ? { constituencyId: row.seatId } : {}),
              seatsHeld: row.seatsHeld,
            },
            updatedAt: now,
            ...(isNpc ? { seatsHeld: row.seatsHeld } : {}),
          },
          ...(!isNpc
            ? {
                $push: {
                  careerHistory: {
                    type: "elected" as const,
                    office: { type: row.officeType },
                    officeLabel:
                      row.officeType === "dumaDeputy"
                        ? "State Duma Deputy"
                        : "Federation Council Member",
                    party: row.party,
                    partyCountryId: "RU" as const,
                    electionId: row.electionId,
                    date: now,
                  },
                },
              }
            : {}),
        },
      },
    }));
    const updated = isNpc
      ? await db.collection<NPP>("npps").bulkWrite(operations, { session })
      : await db.collection<Character>("characters").bulkWrite(operations, { session });
    if (updated.matchedCount !== selected.length)
      throw new Error("Assembly owner changed during handover");
  }
  await db.collection<State>("states").bulkWrite(
    regions.map((row) => ({
      updateOne: {
        filter: { _id: row._id, countryId: "RU" },
        update: { $set: { houseDistricts: allocation[row._id], stateSenateSeats: 0 } },
      },
    })),
    { session }
  );
  const formations = db.collection<GovernmentFormation>("governmentFormations");
  const formation = await formations.findOne(
    { _id: "RU" },
    { session, projection: { coalitionPartyIds: 1, governingPartyId: 1 } }
  );
  if (formation) {
    const supporting = new Set(
      formation.coalitionPartyIds?.length
        ? formation.coalitionPartyIds
        : formation.governingPartyId
          ? [formation.governingPartyId]
          : []
    );
    const totalSeatsSupporting = Object.entries(plan.seatsByParty).reduce(
      (sum, [party, count]) => sum + (supporting.has(party) ? count : 0),
      0
    );
    await formations.updateOne(
      { _id: "RU" },
      {
        $set: {
          totalSeats: 450,
          majorityThreshold: 226,
          seatsByParty: plan.seatsByParty,
          totalSeatsSupporting,
          lostMajority: totalSeatsSupporting < 226,
          updatedAt: now,
        },
      },
      { session }
    );
  }
  // Mark every predecessor as seated, so an unseated-only lookup cannot fall
  // back to an obsolete generation after the latest receipt has been seated.
  await db
    .collection<RussianDumaResultRecord>(RUSSIAN_DUMA_RESULTS_COLLECTION)
    .updateMany(
      { countryId: "RU", $or: [{ cohortId: dumaRoot }, { rootCohortId: dumaRoot }] },
      { $set: { seatedOnTurn: turn } },
      { session }
    );
  await db
    .collection<RussianCouncilResultRecord>(RUSSIAN_COUNCIL_RESULTS_COLLECTION)
    .updateMany(
      { countryId: "RU", $or: [{ cohortId: councilRoot }, { rootCohortId: councilRoot }] },
      { $set: { seatedOnTurn: turn } },
      { session }
    );
  const activated = await db.collection<CountryGameState>("countryGameStates").updateOne(
    {
      _id: "RU",
      ruFederalAssemblySinceTurn: { $exists: false },
      ruFederalAssemblyMandateSinceTurn: country.ruFederalAssemblyMandateSinceTurn,
      ruFirstDumaElectionCohortId: dumaRoot,
      ruFirstCouncilElectionCohortId: councilRoot,
    },
    {
      $set: {
        ruFederalAssemblySinceTurn: turn,
        ruCongressDissolvedSinceTurn: turn,
        ruFederalAssemblyElectionCertifiedSinceTurn: Math.max(
          duma.resolvedOnTurn,
          council.resolvedOnTurn
        ),
        updatedAt: now,
      },
    },
    { session }
  );
  if (activated.matchedCount !== 1) throw new Error("Assembly handover mandate changed");
  await db.collection<RussianAssemblySeatingRecord>(RUSSIAN_ASSEMBLY_SEATINGS_COLLECTION).insertOne(
    {
      _id: seatingId,
      countryId: "RU",
      preset: "1991-default",
      dumaRootCohortId: dumaRoot,
      councilRootCohortId: councilRoot,
      dumaResultId: duma._id,
      councilResultId: council._id,
      seatedOnTurn: turn,
      termEndTurn,
      dumaTermEndTurn,
      councilTermEndTurn,
      createdAt: now,
      officialIds: rows.map((row) => row._id),
      dumaSeats: plan.dumaSeats,
      councilSeats: plan.councilSeats,
      dumaVacancies: plan.dumaVacancies,
      councilVacancies: plan.councilVacancies,
      unavailableWinners: plan.vacancies,
    },
    { session }
  );
  return true;
}
