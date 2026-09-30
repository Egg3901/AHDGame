import { ObjectId, type Db } from "mongodb";
import type {
  DemographicCategory,
  PoliticalParty,
  State,
  StateDemographics,
  StatePartyOrg,
} from "@/lib/db/types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { resolveSeedPartyTier } from "@/lib/seeds/defaultPartyTiers";
import { prunePresetMismatchedDefaultParties } from "@/lib/seeds/ensureDefaultParties";
import { getCountryLayer1Model, buildModelRegionDemographics } from "@/lib/seeds/international";
import { getSuccessor1991Model } from "@/lib/seeds/international/successor1991";
import { deriveCountryGroupTurnout } from "@/lib/seeds/international/derive";
import { writeSplitMetricsBulk } from "@/lib/macroMetrics/split";
import { metricsToBaselines } from "./seedModernTransitionCountries";
import { PARTY_ROSTERS_2019 } from "@/lib/seeds/partyRosters2019";
import { modernMetrics2019 } from "@/lib/seeds/reference/modernMetrics2019";
import {
  modernRegions2019,
  type Modern2019CountryId,
} from "@/lib/seeds/reference/modernRegions2019";

const COUNTRY_IDS = [
  "RU",
  "PL",
  "HU",
  "RO",
  "BG",
] as const satisfies readonly Modern2019CountryId[];

/**
 * Post-Soviet democratic substrate for the 2019 world. The 1953/1979
 * one-party writers remain era-gated. This writer owns only the five countries
 * whose 2019 NPP registration previously had no regions, parties or metrics.
 * It runs before region-derived and election seed stages.
 */
export async function seedModern2019(
  db: Db,
  reset: boolean,
  log: (message: string) => void,
  preset: string
): Promise<void> {
  if (preset !== "2019-default") return;
  for (const countryId of COUNTRY_IDS) {
    const regions = modernRegions2019(countryId);
    const metrics = modernMetrics2019(countryId);
    const partySeeds = PARTY_ROSTERS_2019[countryId];
    if (!partySeeds?.length) throw new Error(`Missing 2019 ${countryId} party roster`);
    const now = new Date();

    if (reset) {
      await db.collection<State>("states").deleteMany({ countryId });
      await db.collection<StateDemographics>("stateDemographics").deleteMany({ countryId });
      await db.collection("stateDemographicTurnout").deleteMany({ countryId });
      await db.collection<StatePartyOrg>("statePartyOrg").deleteMany({ countryId });
      await db
        .collection<StateMetrics>("macroMetrics")
        .deleteMany({ _id: { $in: regions.map((r) => r._id) } });
      await db
        .collection<StateMetrics>("stateMetrics")
        .deleteMany({ _id: { $in: regions.map((r) => r._id) } });
      await db.collection<StateMetricBaseline>("stateBaselines").deleteMany({
        _id: { $in: regions.map((r) => String(r._id)) },
      });
    }

    await db.collection<State>("states").bulkWrite(
      regions.map(({ _id, ...data }) => ({
        updateOne: { filter: { _id }, update: { $set: data }, upsert: true },
      }))
    );
    await writeSplitMetricsBulk(db, metrics);
    const baselines = metricsToBaselines(metrics);
    await db.collection<StateMetricBaseline>("stateBaselines").bulkWrite(
      baselines.map(({ _id, ...data }) => ({
        updateOne: { filter: { _id }, update: { $set: data }, upsert: true },
      }))
    );

    // RU/PL/HU/RO use the modern democratic voter model. Bulgaria's
    // five-region geometry currently has only the 1991 transition model, which
    // is an explicit fallback rather than a reintroduced communist model.
    const model =
      countryId === "BG" ? getSuccessor1991Model("BG") : getCountryLayer1Model(countryId, "2027");
    if (!model) throw new Error(`Missing democratic voter model for ${countryId}`);
    const category: DemographicCategory = {
      _id: model.categoryId,
      name: `${countryId} 2019 voter groups`,
      defaultWeight: 100,
      groups: model.groupIds.map((id) => {
        const lean = model.defaultLeans[id];
        if (!lean) throw new Error(`Missing ${countryId} voter lean for ${id}`);
        return {
          id,
          name: id.replaceAll("_", " "),
          defaultEconomicLean: lean.economicLean,
          defaultSocialLean: lean.socialLean,
          defaultTurnout: deriveCountryGroupTurnout(model, id),
        };
      }),
    };
    const { _id: categoryId, ...categoryData } = category;
    await db
      .collection<DemographicCategory>("demographicCategories")
      .updateOne({ _id: categoryId }, { $set: categoryData }, { upsert: true });
    const demographics = buildModelRegionDemographics(model);
    if (demographics.length !== regions.length)
      throw new Error(`2019 ${countryId} demographic regions do not match seeded regions`);
    await db.collection<StateDemographics>("stateDemographics").bulkWrite(
      demographics.map(({ _id, ...data }) => ({
        updateOne: { filter: { _id }, update: { $set: data }, upsert: true },
      }))
    );

    await prunePresetMismatchedDefaultParties(db, partySeeds, preset);
    for (const seed of partySeeds) {
      const { seedOrder: _order, validForPresets: _presets, ...data } = seed;
      void _order;
      void _presets;
      const collection = db.collection<PoliticalParty>("politicalParties");
      const existing = await collection.findOne({ countryId, name: seed.name });
      if (existing && !existing.isDefault) continue;
      if (existing) {
        await collection.updateOne(
          { _id: existing._id },
          { $set: { ...data, tier: resolveSeedPartyTier(seed, preset), updatedAt: now } }
        );
      } else {
        await collection.insertOne({
          _id: new ObjectId(),
          sequentialId: await getNextSequentialId(db, "party", countryId),
          ...data,
          tier: resolveSeedPartyTier(seed, preset),
          transactionApprovalMode: data.transactionApprovalMode ?? "double",
          createdAt: now,
          updatedAt: now,
        } as PoliticalParty);
      }
    }
    const parties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId, isDefault: true })
      .toArray();
    for (const region of regions) {
      for (const party of parties) {
        const partyId = String(party.sequentialId);
        await db.collection<StatePartyOrg>("statePartyOrg").updateOne(
          { _id: `${region._id}_${partyId}` },
          {
            $set: { countryId, stateId: String(region._id), partyId, updatedAt: now },
            $setOnInsert: {
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
              createdAt: now,
            },
          },
          { upsert: true }
        );
      }
    }
    if (countryId !== "RU") {
      const totalSeats = regions.reduce((n, region) => n + region.houseDistricts, 0);
      const formation: Omit<GovernmentFormation, "createdAt" | "updatedAt"> = {
        _id: countryId,
        countryId,
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
        majorityThreshold: Math.floor(totalSeats / 2) + 1,
        seatsByParty: {},
        totalSeats,
        activeVoteId: null,
        formedAt: null,
        formedTurn: null,
        collapsedAt: null,
      };
      await db
        .collection<GovernmentFormation>("governmentFormations")
        .updateOne(
          { _id: countryId },
          { $set: { ...formation, updatedAt: now }, $setOnInsert: { createdAt: now } },
          { upsert: true }
        );
    }
    log(
      `[${countryId}] seeded ${regions.length} 2019 regions and ${partySeeds.length} democratic parties`
    );
  }
}
