import type { ParliamentaryGovernment } from "@/lib/db/types/parliamentaryGovernment";
import { unformGovernmentAndVacatePM } from "@/lib/turn/parliamentaryGovernment";
/** Reunification carries Northern Ireland's Commons delegation into the Dail in its existing region. */
import type { Db } from "mongodb";
import type { ElectedOfficial } from "@/lib/db/types/officials";

export async function carryNorthernIrelandMPs(
  db: Db,
  mps: ElectedOfficial[],
  now: Date
): Promise<void> {
  if (!mps.length) return;
  const holders = [
    { characterId: { $in: mps.flatMap((mp) => (mp.characterId ? [mp.characterId] : [])) } },
    { nppId: { $in: mps.flatMap((mp) => (mp.nppId ? [mp.nppId] : [])) } },
  ];
  const government = await db.collection<ParliamentaryGovernment>("governmentFormations").findOne({
    _id: "UK",
    $or: [{ pmCharacterId: holders[0].characterId }, { pmNppId: holders[1].nppId }],
  });
  if (government) await unformGovernmentAndVacatePM(db, "UK", now, { reason: "lost-seat" });
  await db.collection("electedOfficials").deleteMany({ countryId: "UK", $or: holders });
  await db.collection("cabinetMembers").deleteMany({ countryId: "UK", $or: holders });
  const parties = await db
    .collection("politicalParties")
    .find(
      { countryId: { $in: ["UK", "IE"] } },
      { projection: { countryId: 1, sequentialId: 1, abbreviation: 1 } }
    )
    .toArray();
  const source = new Map(
    parties
      .filter((row) => row.countryId === "UK")
      .map((row) => [String(row.sequentialId), row.abbreviation])
  );
  const target = new Map(
    parties
      .filter((row) => row.countryId === "IE")
      .map((row) => [row.abbreviation, String(row.sequentialId)])
  );
  const rows = mps.map((mp) => ({
    ...mp,
    countryId: "IE" as const,
    officeType: "dail",
    state: "NIR",
    party: target.get(source.get(mp.party ?? "")) ?? "independent",
    updatedAt: now,
  }));
  await db.collection<ElectedOfficial>("electedOfficials").insertMany(rows);
  await mirrorNorthernIrelandMPs(db, rows, now);
  const nppIds = rows.flatMap((mp) => (mp.nppId ? [mp.nppId] : []));
  if (nppIds.length)
    await db
      .collection("corporations")
      .updateMany(
        { ceoType: "npp", ceoId: { $in: nppIds } },
        { $set: { headquartersState: "NIR", countryId: "IE", updatedAt: now } }
      );
}

export async function mirrorNorthernIrelandMPs(
  db: Db,
  rows: ElectedOfficial[],
  now: Date
): Promise<void> {
  const playerOps = rows.flatMap((mp) =>
    mp.characterId
      ? [
          {
            updateOne: {
              filter: { _id: mp.characterId },
              update: {
                $set: {
                  countryId: "IE",
                  homeState: "NIR",
                  party: mp.party,
                  currentOffice: { type: "dail", state: "NIR", seatsHeld: mp.seatsHeld ?? 1 },
                  updatedAt: now,
                },
              },
            },
          },
        ]
      : []
  );
  const nppOps = rows.flatMap((mp) =>
    mp.nppId
      ? [
          {
            updateOne: {
              filter: { _id: mp.nppId },
              update: {
                $set: {
                  countryId: "IE",
                  homeState: "NIR",
                  party: mp.party,
                  currentOffice: { type: "dail", state: "NIR", seatsHeld: mp.seatsHeld ?? 1 },
                  updatedAt: now,
                },
              },
            },
          },
        ]
      : []
  );
  if (playerOps.length) await db.collection("characters").bulkWrite(playerOps);
  if (nppOps.length) await db.collection("npps").bulkWrite(nppOps);
}
