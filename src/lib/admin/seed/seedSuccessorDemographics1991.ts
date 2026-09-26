import type { Db } from "mongodb";
import type { DemographicCategory, StateDemographics } from "@/lib/db/types";
import { buildModelRegionDemographics } from "@/lib/seeds/international";
import { deriveCountryGroupTurnout } from "@/lib/seeds/international/derive";
import {
  getSuccessor1991Model,
  type Successor1991CountryId,
} from "@/lib/seeds/international/successor1991";

const COUNTRY_IDS: Successor1991CountryId[] = ["RU", "PL", "CS", "HU", "RO", "BG", "YU"];
const GROUP_NAMES: Record<string, string> = {
  party_nomenklatura: "Public Sector Leadership",
  industrial_worker: "Industrial Workers",
  collective_farmer: "Rural Workers",
  intelligentsia: "Professionals and Academics",
  religious_traditional: "Traditional Communities",
  youth: "Young Adults",
};

/** Seed period-specific voter models before defaults and turnout snapshots. */
export async function seedSuccessorDemographics1991(
  db: Db,
  reset: boolean,
  preset: string,
  log: (message: string) => void
): Promise<void> {
  if (preset !== "1991-default") return;
  const models = COUNTRY_IDS.map(getSuccessor1991Model);
  const categoryIds = models.map((model) => model.categoryId);
  if (reset) {
    await db
      .collection<DemographicCategory>("demographicCategories")
      .deleteMany({ _id: { $in: categoryIds } });
    await db
      .collection<StateDemographics>("stateDemographics")
      .deleteMany({ countryId: { $in: COUNTRY_IDS } });
  }
  const categories: DemographicCategory[] = models.map((model) => ({
    _id: model.categoryId,
    name: `${model.countryId} 1991 voter groups`,
    defaultWeight: 100,
    groups: model.groupIds.map((id) => ({
      id,
      name: GROUP_NAMES[id],
      defaultEconomicLean: model.defaultLeans[id].economicLean,
      defaultSocialLean: model.defaultLeans[id].socialLean,
      defaultTurnout: deriveCountryGroupTurnout(model, id),
    })),
  }));
  await db.collection<DemographicCategory>("demographicCategories").bulkWrite(
    categories.map(({ _id, ...category }) => ({
      updateOne: { filter: { _id }, update: { $set: category }, upsert: true },
    }))
  );
  const rows = models.flatMap((model) => buildModelRegionDemographics(model));
  await db.collection<StateDemographics>("stateDemographics").bulkWrite(
    rows.map(({ _id, ...row }) => ({
      updateOne: { filter: { _id }, update: { $set: row }, upsert: true },
    }))
  );
  log(`Seeded ${rows.length} January 1991 transition demographic regions`);
}
