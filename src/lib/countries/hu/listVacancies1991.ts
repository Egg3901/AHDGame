/**
 * Hungarian parties designate replacements for departed list deputies from
 * their certified original slate. The office and receipt commit together,
 * retaining the term and party quota without creating a financial owner.
 */
import { createHash } from "node:crypto";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { Character, ElectedOfficial, GameState, NPP, PoliticalParty } from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { HU_1991_COUNTS_COLLECTION, type Hu1991AssemblyRecord } from "./assemblyCount1991";
import {
  designateHu1991ListReplacement,
  findHu1991ListVacancies,
  type Hu1991ListReplacement,
} from "./rules/listVacancies1991";

export const HU_1991_LIST_REPLACEMENTS_COLLECTION = "hu1991ListReplacements";
interface ReplacementReceipt {
  _id: string;
  parentReceiptId: string;
  countryId: "HU";
  turn: number;
  generation: number;
  actorId: ObjectId | null;
  reason: "party_designation" | "autonomous_original_list_order";
  replacement: Hu1991ListReplacement;
  officialId: ObjectId;
  createdAt: Date;
}
type Owner = Pick<Character | NPP, "_id" | "party" | "currentOffice"> & { userId?: ObjectId };
function stableId(key: string): ObjectId {
  return new ObjectId(createHash("sha256").update(key).digest("hex").slice(0, 24));
}

async function readContext(db: Db, turn: number, session?: ClientSession) {
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { session, projection: { preset: 1 } });
  if (game?.preset !== "1991-default") return null;
  const parent = await db.collection<Hu1991AssemblyRecord>(HU_1991_COUNTS_COLLECTION).findOne(
    { seatedAtTurn: { $exists: true } },
    {
      session,
      sort: { seatedAtTurn: -1 },
      projection: {
        nominations: 1,
        settled: 1,
        nominees: 1,
        seatedAt: 1,
        seatedAtTurn: 1,
        cycle: 1,
        listReplacementGeneration: 1,
      },
    }
  );
  if (!parent?.settled || parent.seatedAtTurn == null || turn >= parent.seatedAtTurn + 192)
    return null;
  const held = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      { countryId: "HU", officeType: "assemblyDelegate" },
      {
        session,
        projection: { hungarianAssemblyMandate: 1, characterId: 1, nppId: 1, termEnds: 1 },
      }
    )
    .toArray();
  const history = await db
    .collection<ReplacementReceipt>(HU_1991_LIST_REPLACEMENTS_COLLECTION)
    .find(
      { parentReceiptId: parent._id },
      { session, projection: { replacement: 1, generation: 1, reason: 1, turn: 1 } }
    )
    .sort({ generation: 1, _id: 1 })
    .toArray();
  const base = {
    nominations: parent.nominations,
    certifiedMandates: parent.settled.mandates,
    replacements: history.map((row) => row.replacement),
    heldPersonIds: new Set(
      held
        .filter((row) => row.characterId || row.nppId)
        .flatMap((row) =>
          row.hungarianAssemblyMandate ? [row.hungarianAssemblyMandate.personId] : []
        )
    ),
    heldPlayerOwnerIds: new Set(
      held.flatMap((row) => (row.characterId ? [row.characterId.toHexString()] : []))
    ),
    unavailablePersonIds: new Set<string>(),
  };
  const preliminary = findHu1991ListVacancies(base);
  if (!preliminary.length)
    return {
      parent,
      held,
      history,
      vacancies: preliminary,
      owners: new Map<string, Owner>(),
    };
  const eligible = new Set(preliminary.flatMap((row) => row.eligiblePersonIds));
  const people = parent.nominations.people.filter((row) => eligible.has(row.id));
  const npcs = await db
    .collection<NPP>("npps")
    .find(
      {
        _id: { $in: people.filter((row) => row.isNpc).map((row) => new ObjectId(row.ownerId)) },
        countryId: "HU",
        retiredAt: null,
      },
      { session, projection: { party: 1, currentOffice: 1 } }
    )
    .toArray();
  const players = await db
    .collection<Character>("characters")
    .find(
      {
        _id: { $in: people.filter((row) => !row.isNpc).map((row) => new ObjectId(row.ownerId)) },
        countryId: "HU",
        federationPendingResidenceId: { $exists: false },
      },
      { session, projection: { party: 1, currentOffice: 1, userId: 1 } }
    )
    .toArray();
  const owners = new Map<string, Owner>(
    [...npcs, ...players].map((row) => [row._id.toHexString(), row])
  );
  for (const person of people) {
    const owner = owners.get(person.ownerId);
    if (
      !owner ||
      owner.party !== person.partyId ||
      (owner.currentOffice &&
        !["assemblyDelegate", "assemblyDeputy", "primeMinister"].includes(owner.currentOffice.type))
    )
      base.unavailablePersonIds.add(person.id);
  }
  return { parent, held, history, owners, vacancies: findHu1991ListVacancies(base) };
}

export async function loadHu1991ListVacancies(db: Db, turn: number) {
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error("Invalid Hungarian vacancy turn");
  const context = await readContext(db, turn);
  return (
    context?.vacancies.map((row) => ({
      receiptId: context.parent._id,
      slotPersonId: row.slotPersonId,
      partyId: row.mandate.partyId,
      tier: row.mandate.tier,
      districtId: row.mandate.districtId,
      candidates: row.eligiblePersonIds.map((id) => {
        const person = context.parent.nominations.people.find((person) => person.id === id)!;
        return {
          personId: id,
          isNpc: person.isNpc,
          listPosition:
            (row.mandate.tier === "national"
              ? context.parent.nominations.national.find(
                  (list) => list.partyId === row.mandate.partyId
                )!
              : context.parent.nominations.territorial
                  .find((list) => list.id === row.mandate.districtId)!
                  .lists.find((list) => list.partyId === row.mandate.partyId)!
            ).candidateIds.indexOf(id) + 1,
          name:
            context.parent.nominees.find((nominee) => nominee.id === person.candidateId)?.name ??
            "Filed deputy",
        };
      }),
    })) ?? []
  );
}

export class Hu1991ListVacancyConflict extends Error {}

export async function designateHu1991ListDeputy(input: {
  db: Db;
  turn: number;
  now: Date;
  receiptId: string;
  slotPersonId: string;
  personId: string;
  actor: { characterId: ObjectId | null; isAdmin: boolean } | "autonomous";
}): Promise<boolean> {
  const { db, turn, now } = input;
  if (!Number.isSafeInteger(turn) || turn < 1 || !Number.isFinite(now.getTime()))
    throw new Error("Invalid Hungarian designation time");
  return runRequiredTransaction(async (session) => {
    const context = await readContext(db, turn, session);
    const vacancy = context?.vacancies.find((row) => row.slotPersonId === input.slotPersonId);
    if (!context || context.parent._id !== input.receiptId || !vacancy) return false;
    const party = await db.collection<PoliticalParty>("politicalParties").findOne(
      {
        countryId: "HU",
        $expr: { $eq: [{ $toString: "$sequentialId" }, vacancy.mandate.partyId] },
      },
      { session, projection: { chairId: 1 } }
    );
    if (input.actor === "autonomous") {
      if (
        !party ||
        party.chairId ||
        input.personId !== vacancy.eligiblePersonIds[0] ||
        context.history.some(
          (row) => row.reason === "autonomous_original_list_order" && row.turn === turn
        )
      )
        return false;
    } else if (
      !input.actor.isAdmin &&
      (!party?.chairId ||
        !input.actor.characterId ||
        !party.chairId.equals(input.actor.characterId))
    ) {
      throw new Hu1991ListVacancyConflict("Only this party's chair can designate its list deputy");
    }
    let mandate;
    try {
      mandate = designateHu1991ListReplacement(vacancy, context.parent.nominations, input.personId);
    } catch {
      throw new Hu1991ListVacancyConflict(
        "Choose an available nominee from this original party list"
      );
    }
    // Handover writes this same chamber document. A concurrent new Assembly
    // therefore forces this transaction to retry against its latest receipt.
    const chamberLock = await db
      .collection<{ _id: string; hu1991MandateGeneration?: number }>("governmentFormations")
      .updateOne({ _id: "HU" }, { $inc: { hu1991MandateGeneration: 1 } }, { session });
    if (chamberLock.matchedCount !== 1) throw new Error("Hungarian chamber authority is missing");
    // The shared parent write serializes different vacancies claiming one person.
    const lock = await db
      .collection<Hu1991AssemblyRecord>(HU_1991_COUNTS_COLLECTION)
      .updateOne(
        { _id: context.parent._id, seatedAtTurn: context.parent.seatedAtTurn },
        { $inc: { listReplacementGeneration: 1 } },
        { session }
      );
    if (lock.modifiedCount !== 1) throw new Error("Hungarian replacement parent changed");
    const id = `${context.parent._id}:list:${vacancy.slotPersonId}:${mandate.personId}`;
    const officialId = stableId(`${context.parent._id}:person:${vacancy.slotPersonId}`);
    const original = await db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ _id: officialId }, { session });
    if (original?.characterId || original?.nppId)
      throw new Error("Hungarian list vacancy is occupied");
    if (original) {
      await db
        .collection<{
          _id: string;
          countryId: "HU";
          receiptId: string;
          turn: number;
          official: ElectedOfficial;
        }>("hu1991AssemblyOfficeArchives")
        .insertOne(
          { _id: `${id}:departed`, countryId: "HU", receiptId: id, turn, official: original },
          { session }
        );
      await db
        .collection<ElectedOfficial>("electedOfficials")
        .deleteOne({ _id: officialId, characterId: null, nppId: null }, { session });
    }
    const official: ElectedOfficial = {
      _id: officialId,
      countryId: "HU",
      officeType: "assemblyDelegate",
      state: mandate.regionId,
      characterId: mandate.isNpc ? null : new ObjectId(mandate.ownerId),
      nppId: mandate.isNpc ? new ObjectId(mandate.ownerId) : null,
      isNPP: mandate.isNpc,
      characterName: context.parent.nominees.find((row) => row.id === mandate.candidateId)?.name,
      party: mandate.partyId,
      seatsHeld: 1,
      constituencyId: mandate.districtId,
      seatSource: "list",
      electedAt: now,
      termEnds:
        original?.termEnds ??
        context.held.find((row) => row.hungarianAssemblyMandate?.receiptId === context.parent._id)
          ?.termEnds ??
        new Date(context.parent.seatedAt!.getTime() + 192 * MS_PER_TURN),
      createdAt: now,
      updatedAt: now,
      hungarianAssemblyMandate: {
        receiptId: context.parent._id,
        personId: mandate.personId,
        tier: mandate.tier,
        districtId: mandate.districtId,
        rootCandidateId: mandate.candidateId,
      },
    };
    await db.collection<ElectedOfficial>("electedOfficials").insertOne(official, { session });
    const owner = context.owners.get(mandate.ownerId)!;
    const seats =
      context.held.filter(
        (row) => (mandate.isNpc ? row.nppId : row.characterId)?.toHexString() === mandate.ownerId
      ).length + 1;
    await db.collection(mandate.isNpc ? "npps" : "characters").updateOne(
      { _id: new ObjectId(mandate.ownerId), countryId: "HU" },
      {
        $set: {
          ...(owner.currentOffice?.type === "primeMinister"
            ? {}
            : {
                currentOffice: {
                  type: "assemblyDelegate",
                  state: mandate.regionId,
                  seatsHeld: seats,
                },
              }),
          ...(mandate.isNpc ? { seatsHeld: seats } : {}),
          updatedAt: now,
        },
      },
      { session }
    );
    if (!mandate.isNpc)
      await db.collection<Character>("characters").updateOne(
        { _id: new ObjectId(mandate.ownerId) },
        {
          $push: {
            careerHistory: {
              type: "elected",
              office: { type: "assemblyDelegate", state: mandate.regionId, seatsHeld: 1 },
              officeLabel: "National Assembly Deputy",
              party: mandate.partyId,
              partyCountryId: "HU",
              date: now,
            },
          },
        },
        { session }
      );
    if (!mandate.isNpc && owner.userId)
      await db.collection("notifications").insertOne(
        {
          _id: stableId(`${id}:notice:${mandate.ownerId}`),
          userId: owner.userId,
          type: "general_win",
          title: "National Assembly List Mandate",
          message:
            "Your party designated you to fill its vacant Hungarian Assembly list mandate for the remainder of this term.",
          metadata: { receiptId: id, countryId: "HU", cycle: context.parent.cycle },
          read: false,
          createdAt: now,
        },
        { session }
      );
    await db.collection<ReplacementReceipt>(HU_1991_LIST_REPLACEMENTS_COLLECTION).insertOne(
      {
        _id: id,
        parentReceiptId: context.parent._id,
        countryId: "HU",
        turn,
        generation: (context.parent.listReplacementGeneration ?? 0) + 1,
        actorId: input.actor === "autonomous" ? null : input.actor.characterId,
        reason:
          input.actor === "autonomous" ? "autonomous_original_list_order" : "party_designation",
        replacement: { slotPersonId: vacancy.slotPersonId, personId: mandate.personId },
        officialId,
        createdAt: now,
      },
      { session }
    );
    return true;
  });
}

/** One bounded autonomous designation per turn; human chairs retain their choice. */
export async function advanceHu1991ListVacancy(db: Db, turn: number, now: Date): Promise<boolean> {
  const context = await readContext(db, turn);
  if (
    !context?.vacancies.length ||
    context.history.some(
      (row) => row.reason === "autonomous_original_list_order" && row.turn === turn
    )
  )
    return false;
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find(
      {
        countryId: "HU",
        chairId: null,
        $expr: {
          $in: [
            { $toString: "$sequentialId" },
            context.vacancies.map((row) => row.mandate.partyId),
          ],
        },
      },
      { projection: { sequentialId: 1 } }
    )
    .toArray();
  const autonomous = new Set(parties.map((row) => String(row.sequentialId)));
  const vacancy = context.vacancies.find(
    (row) => autonomous.has(row.mandate.partyId) && row.eligiblePersonIds.length
  );
  if (!vacancy) return false;
  return designateHu1991ListDeputy({
    db,
    turn,
    now,
    receiptId: context.parent._id,
    slotPersonId: vacancy.slotPersonId,
    personId: vacancy.eligiblePersonIds[0],
    actor: "autonomous",
  });
}

export async function loadHu1991ListReplacementHistory(db: Db) {
  return db
    .collection<ReplacementReceipt>(HU_1991_LIST_REPLACEMENTS_COLLECTION)
    .find(
      {},
      {
        projection: {
          _id: 1,
          parentReceiptId: 1,
          turn: 1,
          generation: 1,
          reason: 1,
          replacement: 1,
        },
      }
    )
    .sort({ createdAt: -1, generation: -1 })
    .limit(50)
    .toArray();
}
