import type { Db } from "mongodb";
import type { State } from "@/lib/db/types";
import type { FederalBudget, StateBudget } from "@/lib/db/types/budget";
import {
  generateCountryOwnedSeedData,
  generateStateBudgets,
  getInitialNationalBudgetsForPreset,
} from "@/lib/seeds/reference/budgets";
import { upsertCountryOwnedCorpEntries } from "./upsertCountryOwnedCorps";

const COUNTRY_IDS = ["RU", "PL", "HU", "RO", "BG"] as const;

/** Seed five 2019 national and regional fiscal books after GDP reconciliation. */
export async function seedModernBudgets2019(
  db: Db,
  reset: boolean,
  preset: string,
  log: (message: string) => void
): Promise<void> {
  if (preset !== "2019-default") return;
  const countries = [...COUNTRY_IDS];
  const budgets = getInitialNationalBudgetsForPreset(preset).filter((budget) =>
    countries.includes(budget.countryId as (typeof COUNTRY_IDS)[number])
  );
  if (budgets.length !== countries.length)
    throw new Error("Missing 2019 transition national budget");
  if (reset) {
    await db
      .collection<FederalBudget>("federalBudget")
      .deleteMany({ countryId: { $in: countries } });
    await db.collection<StateBudget>("stateBudgets").deleteMany({ countryId: { $in: countries } });
  }
  const now = new Date();
  await db.collection<FederalBudget>("federalBudget").bulkWrite(
    budgets.map(({ _id, ...budget }) => ({
      updateOne: { filter: { _id }, update: { $set: { ...budget, updatedAt: now } }, upsert: true },
    }))
  );
  const regions = await db
    .collection<State>("states")
    .find({ countryId: { $in: countries } })
    .project({ _id: 1, countryId: 1, population: 1, gdp: 1 })
    .toArray();
  if (regions.length === 0) throw new Error("Missing 2019 transition regions for budgets");
  const stateBudgets = generateStateBudgets(
    regions.map((region) => ({
      id: region._id,
      countryId: region.countryId,
      population: region.population,
      gdp: region.gdp,
    })),
    2019
  );
  await db.collection<StateBudget>("stateBudgets").bulkWrite(
    stateBudgets.map(({ _id, ...budget }) => ({
      updateOne: { filter: { _id }, update: { $set: budget }, upsert: true },
    }))
  );
  const ruRegions = regions.filter((region) => region.countryId === "RU");
  const issuer = generateCountryOwnedSeedData(
    ruRegions.map((region) => ({
      id: region._id,
      countryId: region.countryId,
      population: region.population,
      gdp: region.gdp,
    })),
    preset,
    false,
    log
  ).find(
    (entry) =>
      entry.corporation.countryOwnerId === "RU" && entry.corporation.isPrimaryNationalCorporation
  );
  if (!issuer) throw new Error("Missing 2019 RU sovereign issuer template");
  await upsertCountryOwnedCorpEntries(db, "RU", [
    {
      corporation: {
        ...issuer.corporation,
        name: "Russian Federation",
        description: "2019 Russian sovereign issuer; no Soviet command-economy production assets.",
        liquidCurrencyCode: "RUB",
      },
      sectors: [],
    },
  ]);
  log(
    `Seeded ${budgets.length} 2019 transition national and ${stateBudgets.length} regional budgets`
  );
}
