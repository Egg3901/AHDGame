import type { AnyBulkWriteOperation, Db } from "mongodb";
import type {
  DemographicCategory,
  StateDemographics,
  StateDemographicTurnout,
  State,
} from "@/lib/db/types";
import { demographicCategories } from "@/lib/seeds/demographicCategories";
import { stateDemographics } from "@/lib/seeds/stateDemographics";
import { calculateStateLean } from "@/lib/utils/demographics";
import { STATE_IDS } from "@/lib/constants/states";
import { DEMOGRAPHIC_TURNOUT_RATES } from "@/lib/seeds/demographicCategories";

export async function seedDemographics(db: Db, reset: boolean, log: (msg: string) => void) {
  if (reset) {
    await db
      .collection<DemographicCategory>("demographicCategories")
      .deleteMany({ _id: "voterGroups" });
    const usIds = [...STATE_IDS];
    await db.collection<StateDemographics>("stateDemographics").deleteMany({ _id: { $in: usIds } });
    await db
      .collection<StateDemographics>("demographicDefaults")
      .deleteMany({ _id: { $in: usIds } });
    await db
      .collection<StateDemographicTurnout>("stateDemographicTurnout")
      .deleteMany({ _id: { $in: usIds } });
  }

  const categoryOps: AnyBulkWriteOperation<DemographicCategory>[] = demographicCategories.map(
    (category) => {
      const { _id, ...categoryData } = category;
      return {
        updateOne: {
          filter: { _id },
          update: { $set: categoryData },
          upsert: true,
        },
      };
    }
  );
  if (categoryOps.length > 0) {
    await db.collection<DemographicCategory>("demographicCategories").bulkWrite(categoryOps, {
      ordered: false,
    });
  }

  const demoTime = new Date();
  const stateDemoUpserts: AnyBulkWriteOperation<StateDemographics>[] = stateDemographics.map(
    (sd) => {
      const { _id, ...sdData } = sd;
      return {
        updateOne: {
          filter: { _id },
          update: { $set: sdData },
          upsert: true,
        },
      };
    }
  );
  const stateLeanOps: AnyBulkWriteOperation<State>[] = stateDemographics.map((sd) => {
    const calculatedLean = calculateStateLean(sd, demographicCategories);
    return {
      updateOne: {
        filter: { _id: sd._id },
        update: {
          $set: {
            cachedEconomicLean: calculatedLean.economicLean,
            cachedSocialLean: calculatedLean.socialLean,
            demographicsLastUpdated: demoTime,
          },
        },
      },
    };
  });
  if (stateDemoUpserts.length > 0) {
    await db
      .collection<StateDemographics>("stateDemographics")
      .bulkWrite(stateDemoUpserts, { ordered: false });
    await db
      .collection<StateDemographics>("demographicDefaults")
      .bulkWrite(stateDemoUpserts, { ordered: false });
    await db.collection<State>("states").bulkWrite(stateLeanOps, { ordered: false });
  }

  // US stateDemographicTurnout (required for Turnout tab; not dropped for UK)
  const usStateIds = [...STATE_IDS];
  const now = new Date();
  const emptyModifiers: Record<string, Record<string, number>> = {
    race: Object.fromEntries(
      (Object.keys(DEMOGRAPHIC_TURNOUT_RATES.race) as string[]).map((k) => [k, 0])
    ),
    age: Object.fromEntries(
      (Object.keys(DEMOGRAPHIC_TURNOUT_RATES.age) as string[]).map((k) => [k, 0])
    ),
    education: Object.fromEntries(
      (Object.keys(DEMOGRAPHIC_TURNOUT_RATES.education) as string[]).map((k) => [k, 0])
    ),
    wealth: Object.fromEntries(
      (Object.keys(DEMOGRAPHIC_TURNOUT_RATES.wealth) as string[]).map((k) => [k, 0])
    ),
    ideology: Object.fromEntries(
      (Object.keys(DEMOGRAPHIC_TURNOUT_RATES.ideology) as string[]).map((k) => [k, 0])
    ),
  };
  const turnoutOps: AnyBulkWriteOperation<StateDemographicTurnout>[] = usStateIds.map(
    (stateId) => ({
      updateOne: {
        filter: { _id: stateId },
        update: {
          $set: {
            countryId: "US" as const,
            modifiers: emptyModifiers,
            lastDecayApplied: now,
            lastUpdated: now,
          },
        },
        upsert: true,
      },
    })
  );
  if (turnoutOps.length > 0) {
    await db
      .collection<StateDemographicTurnout>("stateDemographicTurnout")
      .bulkWrite(turnoutOps, { ordered: false });
  }
  log(
    `Seeded ${demographicCategories.length} demographic categories, ${stateDemographics.length} state demographics, ${usStateIds.length} US turnout docs`
  );
}
