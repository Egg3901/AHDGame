/**
 * Ordinary Duma handover replaces only the lower chamber after certification.
 * materializeRussianDumaConvocationSeating preserves Council and money records,
 * then fills later vacancies through receipt-backed deltas inside the same term.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  Character,
  CountryGameState,
  ElectedOfficial,
  Election,
  NPP,
  GameState,
} from "@/lib/db/types";
import type { UnifiedCabinetMember } from "@/lib/db/types/unifiedCabinetMember";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import {
  RUSSIAN_DUMA_AUTHORITY_PROJECTION,
  RUSSIAN_DUMA_CONVOCATIONS_COLLECTION,
  loadRussianDumaAuthority,
  type RussianDumaConvocationRecord,
} from "./dumaConvocationAuthority";
import {
  RUSSIAN_DUMA_RESULTS_COLLECTION,
  type RussianDumaResultRecord,
} from "./dumaElectionResult";
import {
  RUSSIAN_ASSEMBLY_SEATINGS_COLLECTION,
  RUSSIAN_ASSEMBLY_ARCHIVES_COLLECTION,
  type RussianAssemblySeatingRecord,
  type RussianAssemblyOfficeArchive,
} from "./assemblySeating";
import { russianAssemblyOfficialId } from "./assemblyOfficialIdentity";
import { planRussianDumaSeating, type RussianAssemblySeat } from "./rules/assemblySeating";
import { applyRussianAssemblyOwnerEligibility } from "./rules/assemblyOwnerEligibility";
import { russianDumaConvocationOfficeCompatible } from "./rules/dumaConvocation";
import { planRussianAssemblyVacancySeating } from "./rules/assemblyVacancySeating";
import type { RussianCouncilCompositionSeating } from "./councilCompositionSeating";

export async function materializeRussianDumaConvocationSeating(input: {
  db: Db;
  session: ClientSession;
  turn: number;
  now: Date;
}) {
  const { db, session, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Ordinary Duma seating needs an active transaction, turn and time");
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { session, projection: { preset: 1 } });
  if (game?.preset !== "1991-default") return false;
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne(
      { _id: "RU" },
      { session, projection: { ...RUSSIAN_DUMA_AUTHORITY_PROJECTION, ruCouncilComposition: 1 } }
    );
  if (!country?.ruDumaConvocationCohortId) return false;
  const root = country.ruDumaConvocationCohortId;
  const authority = await loadRussianDumaAuthority({ db, session, country, root, turn });
  if (!authority?.record) throw new Error("Ordinary Duma seating lacks its bound authority");
  const opening = authority.record;
  if (turn >= opening.termEndTurn) return false;
  const journals = db.collection<RussianAssemblySeatingRecord>(
    RUSSIAN_ASSEMBLY_SEATINGS_COLLECTION
  );
  const latest = (
    await journals
      .find(
        { countryId: "RU" as const, preset: "1991-default", dumaRootCohortId: root },
        {
          session,
          projection: {
            revision: 1,
            dumaResultId: 1,
            officialIds: 1,
            unavailableWinners: 1,
            deferredListIncreases: 1,
            seatedOnTurn: 1,
            dumaTermEndTurn: 1,
          },
        }
      )
      .sort({ revision: -1 })
      .limit(1)
      .toArray()
  )[0];
  const receipts = db.collection<RussianDumaResultRecord>(RUSSIAN_DUMA_RESULTS_COLLECTION);
  const preview = (
    await receipts
      .find(
        {
          countryId: "RU" as const,
          preset: "1991-default",
          $or: [{ cohortId: root }, { rootCohortId: root }],
        },
        { session, projection: { _id: 1 } }
      )
      .sort({ generation: -1 })
      .limit(1)
      .toArray()
  )[0];
  if (!preview) return false;
  if (
    latest &&
    latest.dumaResultId === preview._id &&
    !latest.unavailableWinners.some((row) => row.reason !== "ended-mandate")
  )
    return false;
  if (
    (opening.seatedOnTurn != null) !== !!latest ||
    (latest && (latest.dumaTermEndTurn !== opening.termEndTurn || latest.seatedOnTurn > turn))
  )
    throw new Error("Duma seating marker and current journal disagree");
  const receipt = await receipts.findOne({ _id: preview._id }, { session });
  if (
    !receipt?.ballots ||
    receipt._id !== receipt.cohortId.toHexString() ||
    !(receipt.rootCohortId ?? receipt.cohortId).equals(root) ||
    receipt.mandateSinceTurn !== opening.mandateSinceTurn ||
    receipt.resolvedOnTurn > turn ||
    receipt.resolvedOnTurn < opening.originalPollEndTurn
  )
    throw new Error("Ordinary Duma seating needs its actual certified family");
  const planned = planRussianDumaSeating({
    generation: receipt.generation,
    ballots: receipt.ballots,
    nominees: receipt.nominees.map((row) => ({
      ...row,
      candidateId: row.candidateId.toHexString(),
      ownerId: row.ownerId.toHexString(),
    })),
  });
  const polls = await db
    .collection<Election>("elections")
    .find(
      {
        countryId: "RU" as const,
        $or: [
          { _id: { $in: receipt.ballots.map((row) => new ObjectId(row.id)) } },
          { "russianDumaRound.cohortId": root },
        ],
      },
      {
        session,
        batchSize: 1000,
        projection: {
          status: 1,
          state: 1,
          seatId: 1,
          electionType: 1,
          endTurn: 1,
          russianDumaRound: 1,
        },
      }
    )
    .toArray();
  const first = polls.filter((row) => row.russianDumaRound?.cohortId.equals(root));
  if (
    first.length !== 226 ||
    first.some((row) => row.status !== "resolved" || row.endTurn !== opening.originalPollEndTurn) ||
    opening.electionIds.some((id) => !first.some((row) => row._id.equals(id)))
  )
    throw new Error("Ordinary Duma needs its complete original resolved polls");
  const byPoll = new Map(polls.map((row) => [row._id.toHexString(), row]));
  for (const ballot of receipt.ballots) {
    const poll = byPoll.get(ballot.id),
      round = poll?.russianDumaRound;
    if (
      !poll ||
      !round ||
      poll.electionType !== "dumaDeputy" ||
      poll.status !== "resolved" ||
      !(round.rootCohortId ?? round.cohortId).equals(root) ||
      round.mandateSinceTurn !== opening.mandateSinceTurn ||
      poll.endTurn == null ||
      poll.endTurn > turn ||
      poll.state !== ballot.regionId ||
      poll.seatId !== ballot.seatId ||
      round.tier !== ballot.tier ||
      round.registeredVoters !== ballot.registeredVoters
    )
      throw new Error("Ordinary Duma receipt disagrees with its resolved ballots");
  }
  const retainedCouncil = await db.collection("russianCouncilElectionResults").findOne(
    {
      countryId: "RU",
      preset: "1991-default",
      $or: [{ cohortId: opening.firstCouncilRoot }, { rootCohortId: opening.firstCouncilRoot }],
    },
    { session, sort: { generation: -1 }, projection: { _id: 1 } }
  );
  if (!retainedCouncil) throw new Error("Duma handover lacks the retained Council certificate");
  if (country.ruCouncilComposition) {
    const composition = await db
      .collection<RussianCouncilCompositionSeating>("russianCouncilCompositionSeatings")
      .findOne(
        {
          _id: country.ruCouncilComposition.receiptId,
          countryId: "RU",
          preset: "1991-default",
          mode: country.ruCouncilComposition.mode,
          proposalId: country.ruCouncilComposition.proposalId,
          formationRevision: country.ruCouncilComposition.revision,
        },
        { session, projection: { seatedOnTurn: 1 } }
      );
    if (
      !composition ||
      !Number.isSafeInteger(composition.seatedOnTurn) ||
      composition.seatedOnTurn > turn
    )
      throw new Error("Duma handover lacks its actual appointed Council custody");
  }
  const firstAssembly = await journals.findOne(
    { _id: `${opening.firstDumaRoot.toHexString()}:${opening.firstCouncilRoot.toHexString()}` },
    { session, projection: { councilTermEndTurn: 1 } }
  );
  if (!firstAssembly) throw new Error("Ordinary Duma cannot discard its first Council term proof");
  const npcIds = [
    ...new Set(planned.seats.filter((row) => row.isNpc).map((row) => row.ownerId)),
  ].map((id) => new ObjectId(id));
  const playerIds = [
    ...new Set(planned.seats.filter((row) => !row.isNpc).map((row) => row.ownerId)),
  ].map((id) => new ObjectId(id));
  const characters = playerIds.length
    ? await db
        .collection<Character>("characters")
        .find(
          { _id: { $in: playerIds } },
          {
            session,
            batchSize: 1000,
            projection: { countryId: 1, federationPendingResidenceId: 1, currentOffice: 1 },
          }
        )
        .toArray()
    : [];
  const profiles = npcIds.length
    ? await db
        .collection<NPP>("npps")
        .find(
          { _id: { $in: npcIds } },
          {
            session,
            batchSize: 1000,
            projection: { countryId: 1, retiredAt: 1, isTechnocrat: 1, currentOffice: 1 },
          }
        )
        .toArray()
    : [];
  const identities = [
    ...(playerIds.length ? [{ characterId: { $in: playerIds } }] : []),
    ...(npcIds.length ? [{ nppId: { $in: npcIds } }] : []),
  ];
  const physical = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ $or: [{ countryId: "RU" }, ...identities] }, { session, batchSize: 10000 })
    .toArray();
  const cabinet = identities.length
    ? await db
        .collection<UnifiedCabinetMember>("cabinetMembers")
        .find(
          { $or: identities },
          { session, batchSize: 1000, projection: { characterId: 1, nppId: 1, countryId: 1 } }
        )
        .toArray()
    : [];
  const incompatible = new Set<string>();
  for (const office of [
    ...physical,
    ...cabinet.map((row) => ({ ...row, officeType: "parliamentaryCabinet" })),
  ])
    if (
      !russianDumaConvocationOfficeCompatible(opening.number, office.officeType, office.countryId)
    )
      for (const [kind, id] of [
        ["player", office.characterId],
        ["npc", office.nppId],
      ] as const)
        if (id) incompatible.add(`${kind}:${id.toHexString()}`);
  const eligibility = applyRussianAssemblyOwnerEligibility(planned.seats, [
    ...characters.map((row) => ({
      ownerId: row._id.toHexString(),
      isNpc: false,
      countryId: row.countryId,
      pendingRelocation: row.federationPendingResidenceId !== undefined,
      retired: false,
      isTechnocrat: false,
      incompatibleOffice:
        incompatible.has(`player:${row._id}`) ||
        !russianDumaConvocationOfficeCompatible(
          opening.number,
          row.currentOffice?.type,
          row.countryId
        ),
    })),
    ...profiles.map((row) => ({
      ownerId: row._id.toHexString(),
      isNpc: true,
      countryId: row.countryId,
      pendingRelocation: false,
      retired: row.retiredAt != null,
      isTechnocrat: row.isTechnocrat === true,
      incompatibleOffice:
        incompatible.has(`npc:${row._id}`) ||
        !russianDumaConvocationOfficeCompatible(
          opening.number,
          typeof row.currentOffice === "string" ? row.currentOffice : row.currentOffice?.type,
          row.countryId
        ),
    })),
  ]);
  if (!latest && eligibility.dumaSeats < 226) return false;
  const idPrefix = `${root.toHexString()}:duma`;
  const currentDuma = physical.filter(
    (row) => row.countryId === "RU" && row.officeType === "dumaDeputy"
  );
  if (!latest) {
    const predecessor = (
      await journals
        .find(
          {
            countryId: "RU",
            preset: "1991-default",
            dumaRootCohortId: opening.predecessorCohortId,
          },
          { session, projection: { officialIds: 1, dumaTermEndTurn: 1 } }
        )
        .sort({ revision: -1 })
        .limit(1)
        .toArray()
    )[0];
    if (
      !predecessor ||
      predecessor.dumaTermEndTurn !== opening.predecessorTermEndTurn ||
      currentDuma.some((row) => !predecessor.officialIds.some((id) => id.equals(row._id)))
    )
      throw new Error("Outgoing Duma contains offices outside its actual seated authority");
  }
  let current: Array<RussianAssemblySeat & { nominationParty: string }> = [];
  if (latest) {
    const nominees = new Map(
      receipt.nominees.map((row) => [
        russianAssemblyOfficialId(idPrefix, row.candidateId.toHexString()).toHexString(),
        row,
      ])
    );
    const ever = new Set(latest.officialIds.map((id) => id.toHexString()));
    current = currentDuma.map((row) => {
      const nominee = nominees.get(row._id.toHexString());
      const ballot = receipt.ballots!.find(
        (ballot) =>
          ballot.seatId === row.constituencyId &&
          ballot.candidates.some((candidate) => candidate.id === nominee?.candidateId.toHexString())
      );
      if (
        !nominee ||
        !ballot ||
        !ever.has(row._id.toHexString()) ||
        row.isNPP !== nominee.isNpc ||
        String(nominee.isNpc ? row.nppId : row.characterId) !== nominee.ownerId.toHexString() ||
        !row.party ||
        !row.characterName ||
        !row.state ||
        row.state !== ballot.regionId ||
        !row.seatSource
      )
        throw new Error("Current Duma office is outside its seated certified family");
      return {
        candidateId: nominee.candidateId.toHexString(),
        ownerId: nominee.ownerId.toHexString(),
        isNpc: nominee.isNpc,
        name: row.characterName,
        party: row.party,
        nominationParty: nominee.party,
        officeType: "dumaDeputy" as const,
        state: row.state,
        seatId: row.constituencyId!,
        electionId: ballot.id,
        seatsHeld: row.seatsHeld ?? 1,
        seatSource: row.seatSource,
      };
    });
  }
  const delta = latest
    ? planRussianAssemblyVacancySeating({
        certified: planned.seats,
        current,
        previouslySeatedCandidateIds: receipt.nominees
          .filter((row) =>
            latest.officialIds.some((id) =>
              id.equals(russianAssemblyOfficialId(idPrefix, row.candidateId.toHexString()))
            )
          )
          .map((row) => row.candidateId.toHexString()),
        deferredListIncreases: latest.deferredListIncreases,
        unavailableOwners: [
          ...new Map(
            eligibility.vacancies.map((row) => [
              `${row.isNpc ? "npc" : "player"}:${row.ownerId}`,
              { ownerId: row.ownerId, isNpc: row.isNpc, reason: row.reason },
            ])
          ).values(),
        ],
      })
    : {
        insert: eligibility.seats,
        update: [] as RussianAssemblySeat[],
        retire: [] as RussianAssemblySeat[],
        seated: eligibility.seats,
        vacancies: eligibility.vacancies,
        deferredListIncreases: {},
        seatsByParty: eligibility.seatsByParty,
        dumaSeats: eligibility.dumaSeats,
        dumaVacancies: eligibility.dumaVacancies,
      };
  if (
    latest &&
    preview._id === latest.dumaResultId &&
    !delta.insert.length &&
    !delta.update.length &&
    !delta.retire.length
  )
    return false;
  const revision = (latest?.revision ?? -1) + 1;
  if (!Number.isSafeInteger(revision)) throw new Error("Duma seating revision exceeds precision");
  const seatingId = revision ? `${idPrefix}:revision:${revision}` : idPrefix;
  const retireIds = latest
    ? delta.retire.map((row) => russianAssemblyOfficialId(idPrefix, row.candidateId))
    : currentDuma.map((row) => row._id);
  const retired = physical.filter((row) => retireIds.some((id) => id.equals(row._id)));
  const officials = db.collection<ElectedOfficial>("electedOfficials");
  if (retired.length) {
    await db
      .collection<RussianAssemblyOfficeArchive>(RUSSIAN_ASSEMBLY_ARCHIVES_COLLECTION)
      .insertMany(
        retired.map((official) => ({
          _id: `${seatingId}:${official._id.toHexString()}`,
          preset: "1991-default",
          seatingId,
          turn,
          official,
        })),
        { session }
      );
    const deleted = await officials.deleteMany(
      { countryId: "RU" as const, officeType: "dumaDeputy" as const, _id: { $in: retireIds } },
      { session }
    );
    if (deleted.deletedCount !== retireIds.length)
      throw new Error("Duma custody changed before handover");
    const oldPlayerIds = retired
      .filter((row) => !row.isNPP && row.characterId)
      .map((row) => row.characterId!);
    if (oldPlayerIds.length)
      await db
        .collection<Character>("characters")
        .updateMany(
          { _id: { $in: oldPlayerIds }, "currentOffice.type": "dumaDeputy" },
          { $set: { currentOffice: null, updatedAt: now } },
          { session }
        );
    const oldNpcIds = retired.filter((row) => row.isNPP && row.nppId).map((row) => row.nppId!);
    if (!latest && oldNpcIds.length) {
      await db
        .collection<NPP>("npps")
        .updateMany(
          { _id: { $in: oldNpcIds }, "currentOffice.type": "dumaDeputy" },
          { $set: { currentOffice: null, updatedAt: now } },
          { session }
        );
      await db
        .collection<NPP>("npps")
        .updateMany(
          { _id: { $in: oldNpcIds } },
          { $set: { seatsHeld: 0, updatedAt: now } },
          { session }
        );
    }
  }
  if (delta.update.length) {
    const updated = await officials.bulkWrite(
      delta.update.map((row) => ({
        updateOne: {
          filter: { _id: russianAssemblyOfficialId(idPrefix, row.candidateId), countryId: "RU" },
          update: { $set: { seatsHeld: row.seatsHeld, updatedAt: now } },
        },
      })),
      { session }
    );
    if (updated.matchedCount !== delta.update.length)
      throw new Error("Duma list allocation changed");
  }
  const added: ElectedOfficial[] = delta.insert.map((row) => ({
    _id: russianAssemblyOfficialId(idPrefix, row.candidateId),
    countryId: "RU" as const,
    officeType: "dumaDeputy" as const,
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
    termEnds: new Date(now.getTime() + (opening.termEndTurn - turn) * MS_PER_TURN),
  }));
  if (added.length) await officials.insertMany(added, { session });
  const changed = new Set(
    [...delta.insert, ...delta.update, ...delta.retire].map(
      (row) => `${row.isNpc ? "npc" : "player"}:${row.ownerId}`
    )
  );
  const owners = new Map<string, RussianAssemblySeat>();
  for (const row of delta.seated)
    if (changed.has(`${row.isNpc ? "npc" : "player"}:${row.ownerId}`)) {
      const key = `${row.isNpc ? "npc" : "player"}:${row.ownerId}`;
      owners.set(key, { ...row, seatsHeld: (owners.get(key)?.seatsHeld ?? 0) + row.seatsHeld });
    }
  for (const isNpc of [false, true]) {
    const selected = [...owners.values()].filter((row) => row.isNpc === isNpc);
    if (!selected.length) continue;
    const operations = selected.map((row) => ({
      updateOne: {
        filter: { _id: new ObjectId(row.ownerId), countryId: "RU" as const },
        update: {
          $set: {
            currentOffice: {
              type: "dumaDeputy" as const,
              state: isNpc ? "RU" : row.state,
              seatsHeld: row.seatsHeld,
              ...(!isNpc ? { constituencyId: row.seatId } : {}),
            },
            updatedAt: now,
            ...(isNpc ? { seatsHeld: row.seatsHeld } : {}),
          },
          ...(!isNpc && delta.insert.some((added) => !added.isNpc && added.ownerId === row.ownerId)
            ? {
                $push: {
                  careerHistory: {
                    type: "elected" as const,
                    office: { type: "dumaDeputy" as const },
                    officeLabel: "State Duma Deputy",
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
    const result = isNpc
      ? await db.collection<NPP>("npps").bulkWrite(operations, { session })
      : await db.collection<Character>("characters").bulkWrite(operations, { session });
    if (result.matchedCount !== selected.length)
      throw new Error("Duma owner changed during seating");
  }
  const formation = await db
    .collection<GovernmentFormation>("governmentFormations")
    .findOne({ _id: "RU" }, { session, projection: { coalitionPartyIds: 1, governingPartyId: 1 } });
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
    await db.collection<GovernmentFormation>("governmentFormations").updateOne(
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
  await receipts.updateMany(
    { countryId: "RU" as const, $or: [{ cohortId: root }, { rootCohortId: root }] },
    { $set: { seatedOnTurn: turn } },
    { session }
  );
  const claimed = await db.collection<CountryGameState>("countryGameStates").updateOne(
    {
      _id: "RU",
      ruDumaConvocationCohortId: root,
      ruDumaCurrentConvocationCohortId: country.ruDumaCurrentConvocationCohortId ?? {
        $exists: false,
      },
      ruFederalAssemblyMandateSinceTurn: opening.mandateSinceTurn,
      ruFederalAssemblySinceTurn: country.ruFederalAssemblySinceTurn,
    },
    { $set: { ruDumaCurrentConvocationCohortId: root, updatedAt: now } },
    { session }
  );
  if (claimed.matchedCount !== 1) throw new Error("Duma authority changed during seating");
  await journals.insertOne(
    {
      _id: seatingId,
      revision,
      countryId: "RU" as const,
      preset: "1991-default",
      dumaRootCohortId: root,
      councilRootCohortId: opening.firstCouncilRoot,
      dumaResultId: receipt._id,
      councilResultId: String(retainedCouncil._id),
      seatedOnTurn: turn,
      termEndTurn: opening.termEndTurn,
      dumaTermEndTurn: opening.termEndTurn,
      councilTermEndTurn: firstAssembly.councilTermEndTurn,
      ...(country.ruCouncilComposition
        ? { councilCompositionReceiptId: country.ruCouncilComposition.receiptId }
        : {}),
      createdAt: now,
      officialIds: [...(latest?.officialIds ?? []), ...added.map((row) => row._id)],
      dumaSeats: delta.dumaSeats,
      councilSeats: physical.filter(
        (row) => row.countryId === "RU" && row.officeType === "federationCouncilMember"
      ).length,
      dumaVacancies: delta.dumaVacancies,
      councilVacancies:
        178 -
        physical.filter(
          (row) => row.countryId === "RU" && row.officeType === "federationCouncilMember"
        ).length,
      unavailableWinners: delta.vacancies,
      deferredListIncreases: delta.deferredListIncreases,
    },
    { session }
  );
  const bound = await db
    .collection<RussianDumaConvocationRecord>(RUSSIAN_DUMA_CONVOCATIONS_COLLECTION)
    .updateOne(
      { _id: opening._id, revision: opening.revision ?? { $exists: false } },
      {
        $set: {
          ...(opening.seatedOnTurn == null ? { seatedOnTurn: turn } : {}),
          resultId: receipt._id,
          revision,
        },
      },
      { session }
    );
  if (bound.matchedCount !== 1) throw new Error("Duma seating journal changed at final receipt");
  return true;
}
