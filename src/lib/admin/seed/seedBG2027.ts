import { ObjectId, type Db } from "mongodb";
import type { PoliticalParty, State, StatePartyOrg } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { resolveSeedPartyTier } from "@/lib/seeds/defaultPartyTiers";
import {
  selectPartyRosterForPreset,
  prunePresetMismatchedDefaultParties,
} from "@/lib/seeds/ensureDefaultParties";
import { bgRegions2027 } from "@/lib/countries/bg/data/bgRegions2027";
import { bgParties } from "@/lib/countries/bg/data/bgParties";

/** Political substrate only: economic metrics, demographic shares and fiscal
 * budget are not inferred from Soviet-era data or invented for this preset. */
export async function seedBG2027(
  db: Db,
  reset: boolean,
  log: (message: string) => void,
  preset: string
): Promise<void> {
  if (preset !== "2027-default") return;
  if (reset) {
    await db.collection("states").deleteMany({ countryId: "BG" });
    await db.collection("statePartyOrg").deleteMany({ countryId: "BG" });
    await db.collection("stateDemographics").deleteMany({ countryId: "BG" });
    await db.collection("stateDemographicTurnout").deleteMany({ countryId: "BG" });
    await db.collection("demographicCategories").deleteMany({ _id: "bg_voterGroups" as never });
    await db.collection("macroMetrics").deleteMany({ countryId: "BG" });
    await db
      .collection("stateBaselines")
      .deleteMany({
        _id: {
          $in: [
            "BG_SOF",
            "BG_NOR",
            "BG_COA",
            "BG_THR",
            "BG_SW",
            ...bgRegions2027.map((r) => r._id),
          ],
        } as never,
      });
  }
  const ops = bgRegions2027.map(({ _id, ...data }) => ({
    updateOne: { filter: { _id }, update: { $set: data }, upsert: true },
  }));
  await db.collection<State>("states").bulkWrite(ops, { ordered: false });
  await prunePresetMismatchedDefaultParties(db, bgParties, preset);
  const seeds = selectPartyRosterForPreset(bgParties, preset);
  const now = new Date();
  for (const seed of seeds) {
    const { seedOrder: _order, validForPresets: _presets, ...data } = seed;
    void _order;
    void _presets;
    const collection = db.collection<PoliticalParty>("politicalParties");
    const existing = await collection.findOne({ name: seed.name, countryId: "BG" });
    if (existing)
      await collection.updateOne({ _id: existing._id }, { $set: { ...data, updatedAt: now } });
    else
      await collection.insertOne({
        _id: new ObjectId(),
        sequentialId: await getNextSequentialId(db, "party", "BG"),
        ...data,
        tier: resolveSeedPartyTier(seed, preset),
        transactionApprovalMode: "double",
        createdAt: now,
        updatedAt: now,
      } as PoliticalParty);
  }
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: "BG", isDefault: true })
    .toArray();
  for (const region of bgRegions2027)
    for (const party of parties) {
      const partyId = String(party.sequentialId);
      const _id = `${region._id}_${partyId}`;
      const data: Omit<StatePartyOrg, "_id" | "createdAt" | "updatedAt"> = {
        countryId: "BG",
        stateId: region._id,
        partyId,
        organization: 50,
        registration: 50,
        chairId: null,
        viceChairId: null,
        treasurerId: null,
        treasury: 0,
        stateTaxRate: 0,
        politicalStrength: 0,
        hasPresence: true,
        consecutiveLosses: 0,
      };
      await db
        .collection<StatePartyOrg>("statePartyOrg")
        .updateOne(
          { _id },
          { $set: { ...data, updatedAt: now }, $setOnInsert: { createdAt: now } },
          { upsert: true }
        );
    }
  const formation: Omit<GovernmentFormation, "createdAt" | "updatedAt"> = {
    _id: "BG",
    countryId: "BG",
    cycle: 1,
    status: "pending",
    formationType: null,
    lostMajority: false,
    pmCharacterId: null,
    pmNppId: null,
    pmName: null,
    governingPartyId: null,
    coalitionId: null,
    coalitionPartyIds: null,
    totalSeatsSupporting: 0,
    majorityThreshold: 121,
    seatsByParty: {},
    totalSeats: 240,
    activeVoteId: null,
    formedAt: null,
    formedTurn: null,
    collapsedAt: null,
  };
  await db
    .collection<GovernmentFormation>("governmentFormations")
    .updateOne(
      { _id: "BG" },
      { $set: { ...formation, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );
  log(
    `Seeded BG 2027 political substrate: ${bgRegions2027.length} regions, ${seeds.length} parties, ${parties.length * bgRegions2027.length} orgs`
  );
}
