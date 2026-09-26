import type { Db } from "mongodb";
import type { State } from "@/lib/db/types";
import type { FederalBudget, StateBudget } from "@/lib/db/types/budget";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { CountryId } from "@/lib/constants/countries";
import {
  generateCountryOwnedSeedData,
  generateStateBudgets,
  getInitialNationalBudgetsForPreset,
} from "@/lib/seeds/reference/budgets";
import { upsertCountryOwnedCorpEntries } from "./upsertCountryOwnedCorps";

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
  // RU ownership (issue #2316): seedRuBudgets returns on 1991, so without
  // this RU gets budgets but no owned producing SOEs. Reuse the RU
  // generateCountryOwnedSeedData + upsertCountryOwnedCorpEntries path,
  // limited to RU states and gated on gameConfig.commandEconomyEnabled,
  // exactly like the RU seeder. Upserts only, so repeat seeding is stable.
  const gameConfig = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
  const commandEconomyEnabled = gameConfig?.commandEconomyEnabled === true;
  const ruStatesForCorps = regions
    .filter((region) => region.countryId === "RU")
    .map((region) => ({
      id: region._id,
      population: region.population,
      gdp: region.gdp,
      countryId: region.countryId,
    }));
  const ruCorpData = generateCountryOwnedSeedData(
    ruStatesForCorps,
    preset,
    commandEconomyEnabled,
    log
  ).filter((entry) => entry.corporation.countryOwnerId === "RU");
  await upsertCountryOwnedCorpEntries(db, "RU", ruCorpData);
  const ruSectorCount = ruCorpData.reduce((n, e) => n + e.sectors.length, 0);
  if (ruCorpData.length > 0)
    log(
      `Seeded ${ruCorpData.length} RU state enterprise(s) with ${ruSectorCount} owned producing sector(s)`
    );
  log(`Seeded ${budgets.length} transition national and ${stateBudgets.length} regional budgets`);
}
