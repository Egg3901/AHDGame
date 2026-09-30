/**
 * Bundestag holders see their direct and list mandates in one current office.
 * List-only winners gain an office; departing holders lose it. Parliamentary
 * executive roles survive reconciliation through preserveExecutiveOffice.
 */
import type { Db, AnyBulkWriteOperation } from "mongodb";
import type { Character, ElectedOfficial, NPP, OfficeType } from "@/lib/db/types";
import { getExecutiveOfficeKeys } from "@/lib/elections/executiveOffice";
import { preserveExecutiveOffice } from "@/lib/turn/election/generalResolutionHelpers";

export async function reconcileBundestagHolderOffices(db: Db, now: Date): Promise<void> {
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      { countryId: "DE", officeType: "bundestag" },
      { projection: { characterId: 1, nppId: 1, state: 1, seatsHeld: 1, party: 1 } }
    )
    .toArray();
  const characterIds = officials.flatMap((o) => (o.characterId ? [o.characterId] : []));
  const nppIds = officials.flatMap((o) => (o.nppId ? [o.nppId] : []));
  const [characters, npps] = await Promise.all([
    db
      .collection<Character>("characters")
      .find({ _id: { $in: characterIds } }, { projection: { _id: 1, currentOffice: 1 } })
      .toArray(),
    db
      .collection<NPP>("npps")
      .find({ _id: { $in: nppIds } }, { projection: { _id: 1, currentOffice: 1 } })
      .toArray(),
  ]);
  const characterWrites: AnyBulkWriteOperation<Character>[] = [];
  const nppWrites: AnyBulkWriteOperation<NPP>[] = [];
  const vacancyWrites: AnyBulkWriteOperation<ElectedOfficial>[] = [];
  for (const [actors, npp] of [
    [characters, false],
    [npps, true],
  ] as const) {
    for (const actor of actors) {
      const held = officials.filter((o) => (npp ? o.nppId : o.characterId)?.equals(actor._id));
      // NPP aggregate representatives can label list blocs in several Länder.
      // Keep their existing Land when possible; currentOffice describes that
      // Land, while electedOfficials remains the full chamber's source of truth.
      const priorState =
        actor.currentOffice && "state" in actor.currentOffice
          ? actor.currentOffice.state
          : undefined;
      const state = held.some((o) => o.state === priorState) ? priorState : held[0]?.state;
      if (!state) continue;
      const seatsHeld = held
        .filter((o) => o.state === state)
        .reduce((sum, o) => sum + (o.seatsHeld ?? 0), 0);
      const office: OfficeType = { type: "bundestag", state, seatsHeld };
      const nextOffice = preserveExecutiveOffice(office, actor.currentOffice ?? null);
      const identity = npp ? { nppId: actor._id } : { characterId: actor._id };
      vacancyWrites.push({
        updateMany: {
          filter: { ...identity, officeType: { $nin: [...getExecutiveOfficeKeys(), "bundestag"] } },
          update: {
            $set: { characterId: null, nppId: null, isNPP: false, updatedAt: now },
            $unset: { characterName: "", party: "", seatsHeld: "" },
          },
        },
      });
      const update = { $set: { currentOffice: nextOffice, updatedAt: now } };
      if (npp) nppWrites.push({ updateOne: { filter: { _id: actor._id }, update } });
      else characterWrites.push({ updateOne: { filter: { _id: actor._id }, update } });
    }
  }
  if (vacancyWrites.length)
    await db.collection<ElectedOfficial>("electedOfficials").bulkWrite(vacancyWrites);
  if (characterWrites.length)
    await db.collection<Character>("characters").bulkWrite(characterWrites);
  if (nppWrites.length) await db.collection<NPP>("npps").bulkWrite(nppWrites);
  await db
    .collection<Character>("characters")
    .updateMany(
      { countryId: "DE", "currentOffice.type": "bundestag", _id: { $nin: characterIds } },
      { $set: { currentOffice: null, updatedAt: now } }
    );
  await db
    .collection<NPP>("npps")
    .updateMany(
      { countryId: "DE", "currentOffice.type": "bundestag", _id: { $nin: nppIds } },
      { $set: { currentOffice: null, updatedAt: now } }
    );
}
