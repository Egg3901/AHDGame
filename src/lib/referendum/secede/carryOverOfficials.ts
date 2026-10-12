/** Independence retains the First Minister as caretaker and retires departing UK mandates. */
import {
  ensureParliamentaryGovernmentFormation,
  unformGovernmentAndVacatePM,
} from "@/lib/turn/parliamentaryGovernment";
import type { Db } from "mongodb";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import type { ElectedOfficial } from "@/lib/db/types/officials";
import type { ParliamentaryGovernment } from "@/lib/db/types/parliamentaryGovernment";
import { CAPITAL_SUBREGION, type SecedingCountryId } from "./subRegions";

export interface CarryOverOfficialsResult {
  msps: number;
  headOfGov: 0 | 1;
}

export async function carryOverOfficials(
  db: Db,
  regionId: string,
  fromCountryId: CountryId,
  toCountryId: SecedingCountryId,
  idMap: Record<number, number>
): Promise<CarryOverOfficialsResult> {
  const now = new Date();
  const officials = db.collection<ElectedOfficial>("electedOfficials");
  const fm = await officials.findOne({
    countryId: fromCountryId,
    officeType: "governor",
    state: regionId,
  });
  const residents = await db
    .collection("characters")
    .find({ countryId: toCountryId }, { projection: { _id: 1 } })
    .toArray();
  const npps = await db
    .collection("npps")
    .find({ countryId: toCountryId }, { projection: { _id: 1 } })
    .toArray();
  const departing = await officials.find({ countryId: fromCountryId, state: regionId }).toArray();
  const characterIds = [
    ...residents.map((row) => row._id),
    ...departing.flatMap((row) => (row.characterId ? [row.characterId] : [])),
  ];
  const nppIds = [
    ...npps.map((row) => row._id),
    ...departing.flatMap((row) => (row.nppId ? [row.nppId] : [])),
  ];
  const holders = [{ characterId: { $in: characterIds } }, { nppId: { $in: nppIds } }];
  const government = await db.collection<ParliamentaryGovernment>("governmentFormations").findOne({
    _id: fromCountryId,
    $or: [{ pmCharacterId: { $in: characterIds } }, { pmNppId: { $in: nppIds } }],
  });
  if (government)
    await unformGovernmentAndVacatePM(db, fromCountryId, now, { reason: "lost-seat" });
  await officials.deleteMany({ countryId: fromCountryId, $or: [{ state: regionId }, ...holders] });
  await db.collection("cabinetMembers").deleteMany({ countryId: fromCountryId, $or: holders });
  await db.collection("seats").deleteMany({ countryId: fromCountryId, state: regionId });
  await db
    .collection("characters")
    .updateMany(
      { _id: { $in: characterIds } },
      { $set: { currentOffice: null, updatedAt: now }, $unset: { cabinetPosition: "" } }
    );
  await db
    .collection("npps")
    .updateMany({ _id: { $in: nppIds } }, { $set: { currentOffice: null, updatedAt: now } });
  if (!fm || (!fm.characterId && !fm.nppId)) {
    await ensureParliamentaryGovernmentFormation(db, toCountryId);
    return { msps: 0, headOfGov: 0 };
  }
  const party = idMap[Number(fm.party)] != null ? String(idMap[Number(fm.party)]) : "independent";
  const state = CAPITAL_SUBREGION[toCountryId];
  await officials.insertOne({
    ...fm,
    countryId: toCountryId,
    officeType: "firstMinister",
    state,
    party,
    updatedAt: now,
  });
  const collection = fm.characterId ? "characters" : "npps";
  await db.collection(collection).updateOne(
    { _id: (fm.characterId ?? fm.nppId)! },
    {
      $set: {
        countryId: toCountryId,
        homeState: state,
        party,
        currentOffice: { type: "firstMinister" },
        updatedAt: now,
      },
    }
  );
  const seats = getCountryConfig(toCountryId).legislature.lowerChamber.seats;
  await db.collection<ParliamentaryGovernment>("governmentFormations").updateOne(
    { _id: toCountryId },
    {
      $set: {
        countryId: toCountryId,
        cycle: 1,
        status: "formed",
        formationType: "minority",
        pmCharacterId: fm.characterId ?? null,
        ...(fm.nppId ? { pmNppId: fm.nppId } : {}),
        pmName: fm.characterName,
        governingPartyId: party,
        totalSeatsSupporting: 0,
        majorityThreshold: Math.floor(seats / 2) + 1,
        isMinority: true,
        seatsByParty: {},
        totalSeats: seats,
        formedAt: now,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
      $unset: { headOfGovernmentCharacterId: "", ...(fm.nppId ? {} : { pmNppId: "" }) },
    },
    { upsert: true }
  );
  return { msps: 0, headOfGov: 1 };
}
