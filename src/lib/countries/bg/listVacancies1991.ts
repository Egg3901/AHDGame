/**
 * Grand Assembly list succession installs the next original nominee without
 * changing the party quota or term. Offices, owner mirrors, player notices
 * and the replacement journal commit together in advanceBg1991ListVacancies.
 */
import { createHash } from "node:crypto";
import { ObjectId, type Db, type ClientSession } from "mongodb";
import type { Character, ElectedOfficial, GameState, NPP } from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { BG_FOUNDING_COUNTS_COLLECTION, type BgFoundingAssemblyRecord } from "./foundingCount1990";
import { BG_FOUNDING_OFFICE_ARCHIVES_COLLECTION } from "./foundingSeating1990";
import { planBg1991ListReplacements, type Bg1991ListReplacement } from "./rules/listVacancies1991";

export const BG_1991_LIST_REPLACEMENTS_COLLECTION = "bg1991ListReplacements";
interface ReplacementReceipt {
  _id: string;
  parentReceiptId: string;
  countryId: "BG";
  turn: number;
  generation: number;
  replacement: Bg1991ListReplacement;
  officialId: ObjectId;
  createdAt: Date;
}
type Parent = BgFoundingAssemblyRecord & { listReplacementGeneration?: number };
type Owner = Pick<Character | NPP, "_id" | "party" | "currentOffice"> & { userId?: ObjectId };
function stableId(key: string) {
  return new ObjectId(createHash("sha256").update(key).digest("hex").slice(0, 24));
}

async function readParent(db: Db, turn: number, session?: ClientSession, full = false) {
  const country = await db
    .collection<{ _id: string; bgOrdinaryAssemblySinceTurn?: number; dissolvedTurn?: number }>(
      "countryGameStates"
    )
    .findOne(
      { _id: "BG" },
      { session, projection: { bgOrdinaryAssemblySinceTurn: 1, dissolvedTurn: 1 } }
    );
  if (!country || country.bgOrdinaryAssemblySinceTurn != null || country.dissolvedTurn != null)
    return null;
  const parent = await db.collection<Parent>(BG_FOUNDING_COUNTS_COLLECTION).findOne(
    { countryId: "BG", seatedAtTurn: { $exists: true } },
    {
      session,
      sort: { cycle: -1 },
      projection: full
        ? {
            cycle: 1,
            seatedAtTurn: 1,
            grandTermEndTurn: 1,
            listReplacementGeneration: 1,
            nominations: 1,
            settled: 1,
            "nominees.id": 1,
            "nominees.name": 1,
          }
        : { cycle: 1, seatedAtTurn: 1, grandTermEndTurn: 1 },
    }
  );
  if (!parent || parent.seatedAtTurn == null) return null;
  const endTurn = parent.grandTermEndTurn ?? (parent.cycle > 0 ? parent.seatedAtTurn + 192 : null);
  if (endTurn == null || turn < parent.seatedAtTurn || turn >= endTurn) return null;
  return { parent, endTurn };
}

export async function advanceBg1991ListVacancies(
  db: Db,
  game: Pick<GameState, "preset" | "preIteration">,
  turn: number,
  now: Date
): Promise<number> {
  if (game.preset !== "1991-default" || game.preIteration?.active) return 0;
  if (!Number.isSafeInteger(turn) || turn < 1 || !Number.isFinite(now.getTime()))
    throw new Error("Invalid Bulgarian list succession time");
  const ready = await readParent(db, turn);
  if (!ready) return 0;
  const officials = db.collection<ElectedOfficial>("electedOfficials");
  const heldList = await officials.countDocuments({
    countryId: "BG",
    officeType: "assemblyDeputy",
    "bulgarianFoundingMandate.receiptId": ready.parent._id,
    "bulgarianFoundingMandate.tier": "list",
    seatsHeld: 1,
    $or: [{ nppId: { $type: "objectId" } }, { characterId: { $type: "objectId" } }],
  });
  if (heldList === 200) return 0;
  if (heldList > 200) throw new Error("Bulgarian list mandates exceed original capacity");
  return runRequiredTransaction(async (session) => {
    const context = await readParent(db, turn, session, true);
    if (!context || context.parent._id !== ready.parent._id || !context.parent.settled) return 0;
    const { parent, endTurn } = context;
    const rows = await officials
      .find({ countryId: "BG", officeType: "assemblyDeputy" }, { session })
      .toArray();
    const occupied = rows.filter((row) => row.seatsHeld === 1 && (row.characterId || row.nppId));
    // Preserve alternate settlements rather than adding native mandates to them.
    if (occupied.some((row) => row.bulgarianFoundingMandate?.receiptId !== parent._id)) return 0;
    const history = await db
      .collection<ReplacementReceipt>(BG_1991_LIST_REPLACEMENTS_COLLECTION)
      .find(
        { parentReceiptId: parent._id },
        { session, projection: { replacement: 1, generation: 1 } }
      )
      .sort({ generation: 1, _id: 1 })
      .toArray();
    const npcIds = [
      ...new Set(parent.nominations.people.filter((row) => row.isNpc).map((row) => row.ownerId)),
    ].map((id) => new ObjectId(id));
    const playerIds = [
      ...new Set(parent.nominations.people.filter((row) => !row.isNpc).map((row) => row.ownerId)),
    ].map((id) => new ObjectId(id));
    const npcs = npcIds.length
      ? await db
          .collection<NPP>("npps")
          .find(
            { _id: { $in: npcIds }, countryId: "BG", retiredAt: null, isTechnocrat: { $ne: true } },
            { session, projection: { party: 1, currentOffice: 1 } }
          )
          .toArray()
      : [];
    const players = playerIds.length
      ? await db
          .collection<Character>("characters")
          .find(
            {
              _id: { $in: playerIds },
              countryId: "BG",
              federationPendingResidenceId: { $exists: false },
            },
            { session, projection: { party: 1, currentOffice: 1, userId: 1 } }
          )
          .toArray()
      : [];
    const owners = new Map<string, Owner>(
      [...npcs, ...players].map((row) => [row._id.toHexString(), row])
    );
    const unavailable = new Set(
      parent.nominations.people
        .filter((person) => {
          const owner = owners.get(person.ownerId),
            office = owner?.currentOffice;
          return (
            !owner ||
            owner.party !== person.partyId ||
            (office && !["assemblyDeputy", "primeMinister"].includes(office.type))
          );
        })
        .map((row) => row.id)
    );
    const placements = planBg1991ListReplacements({
      nominations: parent.nominations,
      settled: parent.settled!,
      replacements: history.map((row) => row.replacement),
      heldPersonIds: new Set(
        occupied.flatMap((row) =>
          row.bulgarianFoundingMandate ? [row.bulgarianFoundingMandate.personId] : []
        )
      ),
      heldPlayerOwnerIds: new Set(
        occupied.flatMap((row) => (row.characterId ? [row.characterId.toHexString()] : []))
      ),
      unavailablePersonIds: unavailable,
    });
    if (!placements.length) return 0;
    const chamber = await db
      .collection<{ _id: string; bg1991MandateGeneration?: number }>("governmentFormations")
      .updateOne({ _id: "BG" }, { $inc: { bg1991MandateGeneration: 1 } }, { session });
    if (chamber.matchedCount !== 1) throw new Error("Bulgarian chamber authority is missing");
    const lock = await db
      .collection<Parent>(BG_FOUNDING_COUNTS_COLLECTION)
      .updateOne(
        { _id: parent._id, seatedAtTurn: parent.seatedAtTurn },
        { $inc: { listReplacementGeneration: 1 } },
        { session }
      );
    if (lock.modifiedCount !== 1) throw new Error("Bulgarian list parent changed");
    const additions: ElectedOfficial[] = placements.map(({ slotId, mandate }) => {
      const id = stableId(`${parent._id}:person:${slotId}`),
        original = rows.find((row) => row._id.equals(id));
      if (original && occupied.includes(original))
        throw new Error("Bulgarian list slot is occupied");
      return {
        _id: id,
        countryId: "BG",
        officeType: "assemblyDeputy",
        state: mandate.regionId,
        characterId: mandate.isNpc ? null : new ObjectId(mandate.ownerId),
        nppId: mandate.isNpc ? new ObjectId(mandate.ownerId) : null,
        isNPP: mandate.isNpc,
        characterName: parent.nominees.find((row) => row.id === mandate.candidateId)?.name,
        party: mandate.partyId,
        seatsHeld: 1,
        constituencyId: mandate.districtId,
        seatSource: "list",
        electedAt: now,
        termEnds: original?.termEnds ?? new Date(now.getTime() + (endTurn - turn) * MS_PER_TURN),
        createdAt: now,
        updatedAt: now,
        bulgarianFoundingMandate: {
          receiptId: parent._id,
          personId: mandate.personId,
          tier: "list",
          districtId: mandate.districtId,
          rootCandidateId: mandate.candidateId,
        },
      };
    });
    const ids = additions.map((row) => row._id),
      stubs = rows.filter((row) => ids.some((id) => id.equals(row._id)));
    if (stubs.length) {
      await db
        .collection<{
          _id: string;
          countryId: string;
          receiptId: string;
          turn: number;
          official: ElectedOfficial;
        }>(BG_FOUNDING_OFFICE_ARCHIVES_COLLECTION)
        .insertMany(
          stubs.map((official) => ({
            _id: `${parent._id}:list:${turn}:${official._id}:departed`,
            countryId: "BG",
            receiptId: parent._id,
            turn,
            official,
          })),
          { session }
        );
      await officials.deleteMany({ _id: { $in: stubs.map((row) => row._id) } }, { session });
    }
    await officials.insertMany(additions, { session });
    const finalHeld = [...occupied, ...additions];
    const touched = new Map<string, { id: string; isNpc: boolean }>();
    for (const placement of placements) {
      for (const personId of [placement.previousPersonId, placement.mandate.personId]) {
        const person = parent.nominations.people.find((row) => row.id === personId);
        if (person)
          touched.set(`${person.isNpc}:${person.ownerId}`, {
            id: person.ownerId,
            isNpc: person.isNpc,
          });
      }
    }
    for (const isNpc of [true, false]) {
      const selected = [...touched.values()].filter(
        (row) => row.isNpc === isNpc && owners.has(row.id)
      );
      if (!selected.length) continue;
      const collection = isNpc
        ? db.collection<NPP>("npps")
        : db.collection<Character>("characters");
      await collection.bulkWrite(
        selected.map(({ id }) => {
          const owner = owners.get(id)!,
            held = finalHeld.filter(
              (row) => (isNpc ? row.nppId : row.characterId)?.toHexString() === id
            );
          const newlySeated = additions.find(
            (row) => (isNpc ? row.nppId : row.characterId)?.toHexString() === id
          );
          return {
            updateOne: {
              filter: { _id: new ObjectId(id), countryId: "BG" },
              update: {
                $set: {
                  ...(owner.currentOffice?.type === "primeMinister"
                    ? {}
                    : newlySeated || owner.currentOffice?.type === "assemblyDeputy"
                      ? {
                          currentOffice: held.length
                            ? {
                                type: "assemblyDeputy" as const,
                                state: held[0].state,
                                seatsHeld: held.length,
                              }
                            : null,
                        }
                      : {}),
                  ...(isNpc ? { seatsHeld: held.length } : {}),
                  updatedAt: now,
                },
                ...(!isNpc && newlySeated
                  ? {
                      $push: {
                        careerHistory: {
                          type: "elected" as const,
                          office: {
                            type: "assemblyDeputy" as const,
                            state: newlySeated.state,
                            seatsHeld: 1,
                          },
                          officeLabel: "Grand National Assembly Deputy",
                          party: newlySeated.party,
                          partyCountryId: "BG",
                          date: now,
                        },
                      },
                    }
                  : {}),
              },
            },
          };
        }),
        { session }
      );
    }
    const notices = additions
      .filter((row) => row.characterId && owners.get(row.characterId.toHexString())?.userId)
      .map((row) => ({
        _id: stableId(`${parent._id}:list:${row.bulgarianFoundingMandate!.personId}:notice`),
        userId: owners.get(row.characterId!.toHexString())!.userId,
        type: "general_win",
        title: "Grand Assembly List Mandate",
        message:
          "You are the next eligible nominee on your original Bulgarian list and take its vacant mandate for the remainder of this term.",
        metadata: { receiptId: parent._id, countryId: "BG", cycle: parent.cycle },
        read: false,
        createdAt: now,
      }));
    if (notices.length) await db.collection("notifications").insertMany(notices, { session });
    await db.collection<ReplacementReceipt>(BG_1991_LIST_REPLACEMENTS_COLLECTION).insertMany(
      placements.map((row, index) => ({
        _id: `${parent._id}:list:${row.slotId}:${row.mandate.personId}`,
        parentReceiptId: parent._id,
        countryId: "BG",
        turn,
        generation: (parent.listReplacementGeneration ?? 0) + 1,
        replacement: { slotId: row.slotId, personId: row.mandate.personId },
        officialId: additions[index]._id,
        createdAt: now,
      })),
      { session }
    );
    return additions.length;
  });
}
