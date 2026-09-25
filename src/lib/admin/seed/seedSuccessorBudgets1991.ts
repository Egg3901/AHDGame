import type { Db } from "mongodb";
import type { State } from "@/lib/db/types";
import type { FederalBudget, StateBudget } from "@/lib/db/types/budget";
import type { CountryId } from "@/lib/constants/countries";
import {
  generateStateBudgets,
  getInitialNationalBudgetsForPreset,
} from "@/lib/seeds/reference/budgets";

const COUNTRY_IDS = [
  "RU",
  "PL",
  "CS",
  "HU",
  "RO",
  "BG",
  "YU",
] as const satisfies readonly CountryId[];

/** Seed the seven transition budgets after regional GDP reconciliation. */
export async function seedSuccessorBudgets1991(
  db: Db,
  reset: boolean,
  preset: string,
  log: (message: string) => void
): Promise<void> {
  if (preset !== "1991-default") return;
  if (reset) {
    await db
      .collection<FederalBudget>("federalBudget")
      .deleteMany({ countryId: { $in: [...COUNTRY_IDS] } });
    await db
      .collection<StateBudget>("stateBudgets")
      .deleteMany({ countryId: { $in: [...COUNTRY_IDS] } });
  }
  const budgets = getInitialNationalBudgetsForPreset(preset).filter((budget) =>
    (COUNTRY_IDS as readonly string[]).includes(budget.countryId)
  );
  if (budgets.length !== COUNTRY_IDS.length)
    throw new Error("Missing 1991 transition national budget");
  const now = new Date();
  await db.collection<FederalBudget>("federalBudget").bulkWrite(
    budgets.map(({ _id, ...budget }) => ({
      updateOne: { filter: { _id }, update: { $set: { ...budget, updatedAt: now } }, upsert: true },
    }))
  );
  const regions = await db
    .collection<State>("states")
    .find({ countryId: { $in: [...COUNTRY_IDS] } })
    .project({ _id: 1, countryId: 1, population: 1, gdp: 1 })
    .toArray();
  const stateBudgets = generateStateBudgets(
    regions.map((region) => ({
      id: region._id,
      population: region.population,
      gdp: region.gdp,
      countryId: region.countryId,
    })),
    1991
  );
  if (stateBudgets.length !== regions.length)
    throw new Error("Missing 1991 transition regional budget");
  await db.collection<StateBudget>("stateBudgets").bulkWrite(
    stateBudgets.map(({ _id, ...budget }) => ({
      updateOne: { filter: { _id }, update: { $set: budget }, upsert: true },
    }))
  );
  log(`Seeded ${budgets.length} transition national and ${stateBudgets.length} regional budgets`);
}
