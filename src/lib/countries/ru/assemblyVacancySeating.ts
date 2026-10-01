/**
 * Assembly repeat winners fill vacancies within the original chamber terms.
 * materializeRussianAssemblyVacancySeating preserves held offices and accounts,
 * commits list transfers atomically and journals unavailable winners for retry.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { Character, NPP, ElectedOfficial, CountryGameState } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import {
  RUSSIAN_ASSEMBLY_SEATINGS_COLLECTION,
  RUSSIAN_ASSEMBLY_ARCHIVES_COLLECTION,
  type RussianAssemblySeatingRecord,
  type RussianAssemblyOfficeArchive,
} from "./assemblySeating";
import { RUSSIAN_DUMA_RESULTS_COLLECTION } from "./dumaElectionResult";
import { RUSSIAN_COUNCIL_RESULTS_COLLECTION } from "./councilElectionResult";
import { loadRussianAssemblySeatingInputs } from "./assemblySeatingInputs";
import { russianAssemblyOfficialId } from "./assemblyOfficialIdentity";
import { planRussianAssemblyVacancySeating } from "./rules/assemblyVacancySeating";
import type { RussianAssemblySeat } from "./rules/assemblySeating";

export async function materializeRussianAssemblyVacancySeating(input: {
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
    throw new Error("Assembly vacancy seating needs a transaction, turn and time");
  const preview = await db.collection<CountryGameState>("countryGameStates").findOne(
    { _id: "RU" },
    {
      session,
      projection: {
        ruFederalAssemblySinceTurn: 1,
        ruFirstDumaElectionCohortId: 1,
        ruFirstCouncilElectionCohortId: 1,
      },
    }
  );
  if (
    preview?.ruFederalAssemblySinceTurn == null ||
    !preview.ruFirstDumaElectionCohortId ||
    !preview.ruFirstCouncilElectionCohortId
  )
    return false;
  const previewRoot = preview.ruFirstDumaElectionCohortId,
    previewCouncil = preview.ruFirstCouncilElectionCohortId;
  const previewJournal = (
    await db
      .collection<RussianAssemblySeatingRecord>(RUSSIAN_ASSEMBLY_SEATINGS_COLLECTION)
      .find(
        {
          countryId: "RU",
          preset: "1991-default",
          dumaRootCohortId: previewRoot,
          councilRootCohortId: previewCouncil,
        },
        {
          session,
          projection: {
            revision: 1,
            dumaResultId: 1,
            councilResultId: 1,
            unavailableWinners: 1,
            dumaTermEndTurn: 1,
            councilTermEndTurn: 1,
          },
        }
      )
      .sort({ revision: -1 })
      .limit(1)
      .toArray()
  )[0];
  if (!previewJournal) throw new Error("Active Assembly has no seating journal");
  if (turn >= Math.max(previewJournal.dumaTermEndTurn, previewJournal.councilTermEndTurn))
    return false;
  if (!previewJournal.unavailableWinners.some((row) => row.reason !== "ended-mandate")) {
    const ids: string[] = [];
    for (const [collection, root] of [
      [RUSSIAN_DUMA_RESULTS_COLLECTION, previewRoot],
      [RUSSIAN_COUNCIL_RESULTS_COLLECTION, previewCouncil],
    ] as const) {
      const receipt = await db.collection(collection).findOne(
        {
          countryId: "RU",
          preset: "1991-default",
          $or: [{ cohortId: root }, { rootCohortId: root }],
        },
        {
          session,
          projection: { _id: 1 },
          sort: { generation: -1 },
        }
      );
      if (!receipt) throw new Error("Active Assembly has no certified family");
      ids.push(String(receipt._id));
    }
    if (ids[0] === previewJournal.dumaResultId && ids[1] === previewJournal.councilResultId)
      return false;
  }
  const loaded = await loadRussianAssemblySeatingInputs(db, session, turn, {
    activeAssembly: true,
  });
  if (!loaded) return false;
  const {
    country,
    duma,
    council,
    dumaRoot,
    councilRoot,
    certified,
    plan: eligibility,
    governmentOffices,
  } = loaded;
  const rootId = `${dumaRoot.toHexString()}:${councilRoot.toHexString()}`;
  const journals = db.collection<RussianAssemblySeatingRecord>(
    RUSSIAN_ASSEMBLY_SEATINGS_COLLECTION
  );
  const root = await journals.findOne({ _id: rootId }, { session });
  const latest = (
    await journals
      .find(
        {
          countryId: "RU",
          preset: "1991-default",
          dumaRootCohortId: dumaRoot,
          councilRootCohortId: councilRoot,
        },
        { session, batchSize: 1000 }
      )
      .sort({ revision: -1 })
      .limit(1)
      .toArray()
  )[0];
  if (
    !root ||
    !latest ||
    root.seatedOnTurn !== country.ruFederalAssemblySinceTurn ||
    root.dumaTermEndTurn !== loaded.dumaTermEndTurn ||
    root.councilTermEndTurn !== loaded.councilTermEndTurn ||
    latest.dumaTermEndTurn !== root.dumaTermEndTurn ||
    latest.councilTermEndTurn !== root.councilTermEndTurn ||
    !Number.isSafeInteger(latest.revision ?? 0) ||
    (latest.revision ?? 0) < 0 ||
    latest.seatedOnTurn > turn
  )
    throw new Error(
      "Assembly vacancy seating needs its immutable original term and latest journal"
    );
  const nominees = [...duma.nominees, ...council.nominees];
  const byOfficialId = new Map(
    nominees.map((row) => [
      russianAssemblyOfficialId(rootId, row.candidateId.toHexString()).toHexString(),
      row,
    ])
  );
  const ballots = [...duma.ballots!, ...council.ballots];
  const physical = loaded.offices.filter(
    (row) =>
      row.countryId === "RU" && ["dumaDeputy", "federationCouncilMember"].includes(row.officeType)
  );
  const ever = new Set(latest.officialIds.map((id) => id.toHexString()));
  const current: Array<RussianAssemblySeat & { nominationParty: string }> = [];
  for (const office of physical) {
    const nominee = byOfficialId.get(office._id.toHexString());
    const ballot = ballots.find(
      (row) =>
        row.seatId === office.constituencyId &&
        row.candidates.some((candidate) => candidate.id === nominee?.candidateId.toHexString())
    );
    if (
      !nominee ||
      !ballot ||
      !ever.has(office._id.toHexString()) ||
      office.isNPP !== nominee.isNpc ||
      String(nominee.isNpc ? office.nppId : office.characterId) !== nominee.ownerId.toHexString()
    )
      throw new Error("Assembly vacancy seating cannot overwrite unjournaled or changed offices");
    current.push({
      candidateId: nominee.candidateId.toHexString(),
      ownerId: nominee.ownerId.toHexString(),
      isNpc: nominee.isNpc,
      name: office.characterName ?? nominee.name,
      party: office.party,
      nominationParty: nominee.party,
      officeType: office.officeType as RussianAssemblySeat["officeType"],
      state: office.state!,
      seatId: office.constituencyId!,
      electionId: ballot.id,
      seatsHeld: office.seatsHeld ?? 1,
      seatSource: office.seatSource!,
    });
  }
  const unavailableOwners = [
    ...new Map(
      eligibility.vacancies.map((row) => [
        `${row.isNpc ? "npc" : "player"}:${row.ownerId}`,
        { ownerId: row.ownerId, isNpc: row.isNpc, reason: row.reason },
      ])
    ).values(),
  ];
  const expired = (row: RussianAssemblySeat) =>
    turn >= (row.officeType === "dumaDeputy" ? root.dumaTermEndTurn : root.councilTermEndTurn);
  const currentByCandidate = new Map(current.map((row) => [row.candidateId, row]));
  const delta = planRussianAssemblyVacancySeating({
    certified: certified.seats.map((row) =>
      expired(row) && currentByCandidate.has(row.candidateId)
        ? { ...row, seatsHeld: currentByCandidate.get(row.candidateId)!.seatsHeld }
        : row
    ),
    current,
    previouslySeatedCandidateIds: [
      ...certified.seats.filter(expired).map((row) => row.candidateId),
      ...nominees
        .filter((row) =>
          ever.has(russianAssemblyOfficialId(rootId, row.candidateId.toHexString()).toHexString())
        )
        .map((row) => row.candidateId.toHexString()),
    ],
    deferredListIncreases: latest.deferredListIncreases,
    unavailableOwners,
  });
  if (
    [...delta.insert, ...delta.update, ...delta.retire].some(
      (row) =>
        turn >= (row.officeType === "dumaDeputy" ? root.dumaTermEndTurn : root.councilTermEndTurn)
    )
  )
    throw new Error("Assembly vacancy seating cannot renew an expired chamber term");
  const newReceipt = duma._id !== latest.dumaResultId || council._id !== latest.councilResultId;
  if (!newReceipt && !delta.insert.length && !delta.update.length && !delta.retire.length)
    return false;
  const revision = (latest.revision ?? 0) + 1;
  if (!Number.isSafeInteger(revision))
    throw new Error("Assembly seating revision exceeds precision");
  const seatingId = `${rootId}:revision:${revision}`;
  const officials = db.collection<ElectedOfficial>("electedOfficials");
  if (delta.retire.length) {
    const retireIds = delta.retire.map((row) => russianAssemblyOfficialId(rootId, row.candidateId));
    await db
      .collection<RussianAssemblyOfficeArchive>(RUSSIAN_ASSEMBLY_ARCHIVES_COLLECTION)
      .insertMany(
        physical
          .filter((row) => retireIds.some((id) => id.equals(row._id)))
          .map((official) => ({
            _id: `${seatingId}:${official._id.toHexString()}`,
            preset: "1991-default",
            seatingId,
            turn,
            official,
          })),
        { session }
      );
    const removed = await officials.deleteMany(
      { _id: { $in: retireIds }, countryId: "RU", officeType: "dumaDeputy" },
      { session }
    );
    if (removed.deletedCount !== retireIds.length)
      throw new Error("Assembly list transfer changed during seating");
  }
  if (delta.update.length) {
    const changed = await officials.bulkWrite(
      delta.update.map((row) => ({
        updateOne: {
          filter: {
            _id: russianAssemblyOfficialId(rootId, row.candidateId),
            countryId: "RU" as const,
          },
          update: { $set: { seatsHeld: row.seatsHeld, updatedAt: now } },
        },
      })),
      { session }
    );
    if (changed.matchedCount !== delta.update.length)
      throw new Error("Assembly list allocation changed during seating");
  }
  const added: ElectedOfficial[] = delta.insert.map((row) => ({
    _id: russianAssemblyOfficialId(rootId, row.candidateId),
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
        ((row.officeType === "dumaDeputy" ? root.dumaTermEndTurn : root.councilTermEndTurn) -
          turn) *
          MS_PER_TURN
    ),
  }));
  if (added.length) await officials.insertMany(added, { session });
  const changedOwners = new Set(
    [...delta.insert, ...delta.update, ...delta.retire].map(
      (row) => `${row.isNpc ? "npc" : "player"}:${row.ownerId}`
    )
  );
  const owners = new Map<string, RussianAssemblySeat>();
  for (const row of delta.seated) {
    const key = `${row.isNpc ? "npc" : "player"}:${row.ownerId}`;
    if (!changedOwners.has(key)) continue;
    const before = owners.get(key);
    owners.set(key, { ...row, seatsHeld: (before?.seatsHeld ?? 0) + row.seatsHeld });
  }
  const clearMirrors = delta.retire.filter(
    (row) => !owners.has(`player:${row.ownerId}`) && !governmentOffices.has(`player:${row.ownerId}`)
  );
  if (clearMirrors.length)
    await db.collection<Character>("characters").updateMany(
      {
        _id: { $in: clearMirrors.map((row) => new ObjectId(row.ownerId)) },
        "currentOffice.type": "dumaDeputy",
      },
      { $set: { currentOffice: null, updatedAt: now } },
      { session }
    );
  for (const isNpc of [false, true]) {
    const selected = [...owners.values()].filter((row) => row.isNpc === isNpc);
    if (!selected.length) continue;
    const operations = selected.map((row) => ({
      updateOne: {
        filter: { _id: new ObjectId(row.ownerId), countryId: "RU" as const },
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
          ...(!isNpc && delta.insert.some((added) => !added.isNpc && added.ownerId === row.ownerId)
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
      throw new Error("Assembly vacancy owner changed during seating");
  }
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
    const totalSeatsSupporting = Object.entries(delta.seatsByParty).reduce(
      (sum, [party, count]) => sum + (supporting.has(party) ? count : 0),
      0
    );
    await formations.updateOne(
      { _id: "RU" },
      {
        $set: {
          totalSeats: 450,
          majorityThreshold: 226,
          seatsByParty: delta.seatsByParty,
          totalSeatsSupporting,
          lostMajority: totalSeatsSupporting < 226,
          updatedAt: now,
        },
      },
      { session }
    );
  }
  for (const [collection, _receipt, rootCohortId] of [
    [RUSSIAN_DUMA_RESULTS_COLLECTION, duma, dumaRoot],
    [RUSSIAN_COUNCIL_RESULTS_COLLECTION, council, councilRoot],
  ] as const)
    await db.collection(collection).updateMany(
      {
        countryId: "RU",
        seatedOnTurn: { $exists: false },
        $or: [{ cohortId: rootCohortId }, { rootCohortId }],
      },
      { $set: { seatedOnTurn: turn } },
      { session }
    );
  const bound = await db.collection<CountryGameState>("countryGameStates").updateOne(
    {
      _id: "RU",
      ruFirstDumaElectionCohortId: dumaRoot,
      ruFirstCouncilElectionCohortId: councilRoot,
      ruFederalAssemblySinceTurn: root.seatedOnTurn,
      ruFederalAssemblyMandateSinceTurn: country.ruFederalAssemblyMandateSinceTurn,
    },
    { $set: { updatedAt: now } },
    { session }
  );
  if (bound.matchedCount !== 1) throw new Error("Assembly vacancy mandate changed during seating");
  await journals.insertOne(
    {
      _id: seatingId,
      revision,
      countryId: "RU",
      preset: "1991-default",
      dumaRootCohortId: dumaRoot,
      councilRootCohortId: councilRoot,
      dumaResultId: duma._id,
      councilResultId: council._id,
      seatedOnTurn: turn,
      termEndTurn: root.termEndTurn,
      dumaTermEndTurn: root.dumaTermEndTurn,
      councilTermEndTurn: root.councilTermEndTurn,
      createdAt: now,
      officialIds: [
        ...new Map(
          [...latest.officialIds, ...added.map((row) => row._id)].map((id) => [
            id.toHexString(),
            id,
          ])
        ).values(),
      ],
      dumaSeats: delta.dumaSeats,
      councilSeats: delta.councilSeats,
      dumaVacancies: delta.dumaVacancies,
      councilVacancies: delta.councilVacancies,
      unavailableWinners: delta.vacancies,
      deferredListIncreases: delta.deferredListIncreases,
    },
    { session }
  );
  return true;
}
