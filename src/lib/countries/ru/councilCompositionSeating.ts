/**
 * Regional Council handover keeps the Duma, government and private accounts intact.
 * materializeRussianCouncilCompositionSeating replaces receipt-proven Council
 * members and their mirrors atomically, finishing with a bound composition receipt.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { Character, CountryGameState, ElectedOfficial, GameState, NPP } from "@/lib/db/types";
import type { UnifiedCabinetMember } from "@/lib/db/types/unifiedCabinetMember";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { loadEnactedRussianCouncilFormation } from "./councilFormationProposals";
import {
  loadCurrentRussianDumaClock,
  RUSSIAN_DUMA_AUTHORITY_PROJECTION,
} from "./dumaConvocationAuthority";
import {
  loadRussianRegionalNpcProfiles,
  type RussianRegionalAuthorityRecord,
  type RussianRegionalCouncilSeatingInputs,
  RUSSIAN_REGIONAL_AUTHORITIES_COLLECTION,
} from "./regionalCouncilAuthorities";
import {
  planRussianCouncilComposition,
  russianRegionalCouncilOfficeCompatible,
  type RussianCouncilCompositionMode,
} from "./rules/councilComposition";
import {
  planRussianCouncilCompositionDelta,
  type RussianRegionalCouncilSeat,
} from "./rules/councilCompositionDelta";
import { russianAssemblyOfficialId } from "./assemblyOfficialIdentity";
import type { RussianAssemblySeatingRecord, RussianAssemblyOfficeArchive } from "./assemblySeating";

export const RUSSIAN_COUNCIL_COMPOSITION_SEATINGS_COLLECTION = "russianCouncilCompositionSeatings";
export interface RussianCouncilCompositionSeating {
  _id: string;
  countryId: "RU";
  preset: "1991-default";
  mode: RussianCouncilCompositionMode;
  proposalId: string;
  formationRevision: number;
  revision: number;
  seatedOnTurn: number;
  previousReceiptId?: string;
  seats: Array<RussianRegionalCouncilSeat & { officialId: ObjectId }>;
  endedPersonIds: string[];
  vacancies: number;
  seatsByParty: Record<string, number>;
  createdAt: Date;
}

export async function materializeRussianCouncilCompositionSeating(input: {
  db: Db;
  session: ClientSession;
  turn: number;
  now: Date;
  /** Same-transaction regional settlement inputs avoid reloading every authority and NPC group. */
  seatingInputs?: RussianRegionalCouncilSeatingInputs;
}) {
  const { db, session, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Council composition seating needs a transaction, turn and time");
  const game = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { session, projection: { preset: 1, preIteration: 1, preIterationTurns: 1 } }
    );
  if (game?.preset !== "1991-default") return false;
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne(
    { _id: "RU" },
    {
      session,
      projection: {
        ...RUSSIAN_DUMA_AUTHORITY_PROJECTION,
        ruCouncilFormationMandate: 1,
        ruCouncilComposition: 1,
      },
    }
  );
  if (!country) return false;
  const mandate = await loadEnactedRussianCouncilFormation({ db, session, country, game, turn });
  if (!mandate) return false;
  if (!(await loadCurrentRussianDumaClock({ db, session, country, turn }))) return false;
  const journals = db.collection<RussianCouncilCompositionSeating>(
    RUSSIAN_COUNCIL_COMPOSITION_SEATINGS_COLLECTION
  );
  const prior = country.ruCouncilComposition
    ? await journals.findOne({ _id: country.ruCouncilComposition.receiptId }, { session })
    : null;
  if (
    country.ruCouncilComposition &&
    (!prior ||
      prior.countryId !== "RU" ||
      prior.preset !== "1991-default" ||
      prior.mode !== country.ruCouncilComposition.mode ||
      prior.proposalId !== country.ruCouncilComposition.proposalId ||
      prior.formationRevision !== country.ruCouncilComposition.revision ||
      !Number.isSafeInteger(prior.revision) ||
      prior.revision < 1 ||
      prior.seatedOnTurn > turn)
  )
    throw new Error("Installed Council needs its actual predecessor receipt");
  const newLaw =
    !prior ||
    prior.proposalId !== mandate.proposalId ||
    prior.formationRevision !== mandate.revision;
  const authorities =
    input.seatingInputs?.authorities ??
    (await db
      .collection<RussianRegionalAuthorityRecord>(RUSSIAN_REGIONAL_AUTHORITIES_COLLECTION)
      .find({ countryId: "RU", preset: "1991-default" }, { session, batchSize: 1000 })
      .toArray());
  if (!authorities.length) return false;
  const npcProfiles =
    input.seatingInputs?.profiles ?? (await loadRussianRegionalNpcProfiles(db, session));
  const eligibleNpc = new Set(npcProfiles.filter((row) => row.eligible).map((row) => row.ownerId));
  const playerIds = [
    ...new Set(
      authorities
        .flatMap((row) => [row.head, ...(row.delegate ? [row.delegate] : [])])
        .filter((person) => !person.isNpc)
        .map((person) => person.ownerId)
    ),
  ].map((id) => new ObjectId(id));
  const players = playerIds.length
    ? await db
        .collection<Character>("characters")
        .find(
          { _id: { $in: playerIds } },
          {
            session,
            projection: { countryId: 1, federationPendingResidenceId: 1, currentOffice: 1 },
            batchSize: 1000,
          }
        )
        .toArray()
    : [];
  const playerById = new Map(players.map((row) => [row._id.toHexString(), row]));
  const physical = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      {
        $or: [
          { countryId: "RU", officeType: "federationCouncilMember" },
          ...(playerIds.length ? [{ characterId: { $in: playerIds } }] : []),
        ],
      },
      { session, batchSize: 1000 }
    )
    .toArray();
  const cabinet = playerIds.length
    ? await db
        .collection<UnifiedCabinetMember>("cabinetMembers")
        .find(
          { characterId: { $in: playerIds } },
          { session, projection: { characterId: 1 }, batchSize: 1000 }
        )
        .toArray()
    : [];
  const incompatiblePlayers = new Set(
    cabinet.filter((row) => row.characterId).map((row) => row.characterId!.toHexString())
  );
  for (const row of physical)
    if (
      row.characterId &&
      !russianRegionalCouncilOfficeCompatible({
        officeType: row.officeType,
        countryId: row.countryId,
        isNpc: false,
      })
    )
      incompatiblePlayers.add(row.characterId.toHexString());
  const eligiblePlayers = new Set(
    players
      .filter(
        (row) =>
          row.countryId === "RU" &&
          row.federationPendingResidenceId === undefined &&
          !incompatiblePlayers.has(row._id.toHexString()) &&
          russianRegionalCouncilOfficeCompatible({
            officeType: row.currentOffice?.type,
            countryId: row.countryId,
            isNpc: false,
          })
      )
      .map((row) => row._id.toHexString())
  );
  const status = (person: RussianRegionalAuthorityRecord["head"]) => ({
    ...person,
    eligible: person.eligible && (person.isNpc ? eligibleNpc : eligiblePlayers).has(person.ownerId),
  });
  const desired = planRussianCouncilComposition({
    mode: mandate.mode,
    turn,
    authorities: authorities.map((row) => ({
      ...row,
      head: status(row.head),
      ...(row.delegate ? { delegate: { ...row.delegate, ...status(row.delegate) } } : {}),
    })),
  });
  const council = physical.filter(
    (row) => row.countryId === "RU" && row.officeType === "federationCouncilMember"
  );
  const previousSeats = prior?.seats ?? [];
  const proofById = new Map(previousSeats.map((row) => [row.officialId.toHexString(), row]));
  const held: RussianRegionalCouncilSeat[] = [];
  if (prior)
    for (const office of council) {
      const proof = proofById.get(office._id.toHexString());
      if (
        !proof ||
        String(proof.isNpc ? office.nppId : office.characterId) !== proof.ownerId ||
        !!office.isNPP !== proof.isNpc ||
        office.seatsHeld !== 1 ||
        office.state !== proof.regionId ||
        office.constituencyId !== `${proof.subjectId}:${proof.branch}` ||
        !office.party
      )
        throw new Error("Current Council member disagrees with its predecessor receipt");
      held.push({ ...proof, party: office.party });
    }
  else {
    const first = (
      await db
        .collection<RussianAssemblySeatingRecord>("russianAssemblySeatings")
        .find(
          {
            countryId: "RU",
            preset: "1991-default",
            dumaRootCohortId: country.ruFirstDumaElectionCohortId,
            councilRootCohortId: country.ruFirstCouncilElectionCohortId,
          },
          { session, projection: { officialIds: 1, revision: 1 } }
        )
        .sort({ revision: -1 })
        .limit(1)
        .toArray()
    )[0];
    if (!first) throw new Error("Regional Council cannot discard the first elected handover proof");
    const proven = new Set(first.officialIds.map((id) => id.toHexString()));
    if (council.some((row) => !proven.has(row._id.toHexString())))
      throw new Error("First Council contains an unproven office");
  }
  const delta = planRussianCouncilCompositionDelta({
    desired: desired.seats,
    previous: previousSeats,
    held,
    endedPersonIds: prior?.endedPersonIds ?? [],
    newLaw,
  });
  if (newLaw && !delta.viable) return false;
  if (
    !newLaw &&
    !delta.insert.length &&
    !delta.retire.length &&
    JSON.stringify(prior!.endedPersonIds) === JSON.stringify(delta.endedPersonIds)
  )
    return false;
  const revision = (prior?.revision ?? 0) + 1;
  if (!Number.isSafeInteger(revision))
    throw new Error("Council composition revision exceeds precision");
  const receiptId = `${mandate.proposalId}:${mandate.revision}:seating:${revision}`;
  const prefix = `${mandate.proposalId}:${mandate.revision}`;
  const retiring = !prior
    ? council
    : council.filter((row) =>
        delta.retire.some(
          (retired) => proofById.get(row._id.toHexString())?.personId === retired.personId
        )
      );
  if (retiring.length) {
    await db.collection<RussianAssemblyOfficeArchive>("russianAssemblyOfficeArchives").insertMany(
      retiring.map((official) => ({
        _id: `${receiptId}:${official._id.toHexString()}`,
        preset: "1991-default",
        seatingId: receiptId,
        turn,
        official,
      })),
      { session }
    );
    const deleted = await db.collection<ElectedOfficial>("electedOfficials").deleteMany(
      {
        _id: { $in: retiring.map((row) => row._id) },
        countryId: "RU",
        officeType: "federationCouncilMember",
      },
      { session }
    );
    if (deleted.deletedCount !== retiring.length)
      throw new Error("Council predecessor changed during handover");
  }
  const added: ElectedOfficial[] = delta.insert.map((row) => ({
    _id: russianAssemblyOfficialId(prefix, row.personId),
    countryId: "RU",
    officeType: "federationCouncilMember",
    characterId: row.isNpc ? null : new ObjectId(row.ownerId),
    nppId: row.isNpc ? new ObjectId(row.ownerId) : null,
    isNPP: row.isNpc,
    characterName: row.name,
    party: row.party,
    state: row.regionId,
    constituencyId: `${row.subjectId}:${row.branch}`,
    seatsHeld: 1,
    isAppointment: true,
    electedAt: now,
    createdAt: now,
    updatedAt: now,
    ...(row.termEndTurn != null
      ? { termEnds: new Date(now.getTime() + (row.termEndTurn - turn) * MS_PER_TURN) }
      : {}),
  }));
  if (added.length)
    await db.collection<ElectedOfficial>("electedOfficials").insertMany(added, { session });
  const affected = new Set(
    [...retiring, ...added].map(
      (row) => `${row.isNPP ? "npc" : "player"}:${row.isNPP ? row.nppId : row.characterId}`
    )
  );
  for (const isNpc of [false, true]) {
    const owners = new Map<string, { count: number; state: string; slot: string }>();
    for (const row of delta.seated)
      if (row.isNpc === isNpc && affected.has(`${isNpc ? "npc" : "player"}:${row.ownerId}`)) {
        const existing = owners.get(row.ownerId);
        owners.set(row.ownerId, {
          count: (existing?.count ?? 0) + 1,
          state: row.regionId,
          slot: `${row.subjectId}:${row.branch}`,
        });
      }
    const clearedIds = [...affected]
      .filter(
        (key) => key.startsWith(`${isNpc ? "npc" : "player"}:`) && !owners.has(key.split(":")[1])
      )
      .map((key) => new ObjectId(key.split(":")[1]));
    if (clearedIds.length) {
      const filter = {
        _id: { $in: clearedIds },
        countryId: "RU" as const,
        "currentOffice.type": "federationCouncilMember",
      };
      const update = {
        $set: { currentOffice: null, updatedAt: now },
        ...(isNpc ? { $unset: { seatsHeld: "" as const } } : {}),
      };
      if (isNpc) await db.collection<NPP>("npps").updateMany(filter, update, { session });
      else await db.collection<Character>("characters").updateMany(filter, update, { session });
    }
    if (owners.size) {
      const operations = [...owners].map(([ownerId, row]) => ({
        updateOne: {
          filter: { _id: new ObjectId(ownerId), countryId: "RU" as const },
          update: {
            $set: {
              currentOffice:
                !isNpc &&
                playerById.get(ownerId)?.currentOffice &&
                ["governor", "regionalCouncil"].includes(
                  playerById.get(ownerId)!.currentOffice!.type
                )
                  ? playerById.get(ownerId)!.currentOffice
                  : {
                      type: "federationCouncilMember" as const,
                      state: isNpc ? "RU" : row.state,
                      seatsHeld: row.count,
                      ...(!isNpc ? { constituencyId: row.slot } : {}),
                    },
              updatedAt: now,
              ...(isNpc ? { seatsHeld: row.count } : {}),
            },
            ...(!isNpc && delta.insert.some((added) => !added.isNpc && added.ownerId === ownerId)
              ? {
                  $push: {
                    careerHistory: {
                      type: "appointed" as const,
                      office: { type: "federationCouncilMember" as const },
                      officeLabel: "Federation Council Member",
                      partyCountryId: "RU" as const,
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
      if (updated.matchedCount !== owners.size)
        throw new Error("Regional Council owner changed during handover");
    }
  }
  const composed = {
    mode: mandate.mode,
    proposalId: mandate.proposalId,
    revision: mandate.revision,
    sinceTurn: newLaw ? turn : country.ruCouncilComposition!.sinceTurn,
    receiptId,
  };
  const changed = await countries.updateOne(
    {
      _id: "RU",
      ruCouncilFormationMandate: mandate,
      ruCouncilComposition: country.ruCouncilComposition ?? { $exists: false },
    },
    { $set: { ruCouncilComposition: composed, updatedAt: now } },
    { session }
  );
  if (changed.matchedCount !== 1)
    throw new Error("Council composition authority changed before handover");
  // This final receipt is deliberately last so a failure rolls every earlier office write back.
  await journals.insertOne(
    {
      _id: receiptId,
      countryId: "RU",
      preset: "1991-default",
      mode: mandate.mode,
      proposalId: mandate.proposalId,
      formationRevision: mandate.revision,
      revision,
      seatedOnTurn: turn,
      ...(prior ? { previousReceiptId: prior._id } : {}),
      seats: delta.seated.map((row) => ({
        ...row,
        officialId: russianAssemblyOfficialId(prefix, row.personId),
      })),
      endedPersonIds: delta.endedPersonIds,
      vacancies: delta.vacancies,
      seatsByParty: delta.seatsByParty,
      createdAt: now,
    },
    { session }
  );
  return true;
}
