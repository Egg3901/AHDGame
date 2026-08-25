import type { Db } from "mongodb";
import type { State } from "@/lib/db/types";
import type { FederalBudget, EnactedLaw, StateBudget } from "@/lib/db/types/budget";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { upsertCountryOwnedCorpEntries } from "./upsertCountryOwnedCorps";

/**
 * Seeds the USSR FY1979 national budget, default enacted laws (from the su_*
 * legislation defaults), per-region state budgets, and the sovereign issuer.
 * The USSR is 1979-only; the national budget config + policy defaults live in
 * reference/budgets.ts + basePolicies.ts.
 */
export async function seedRuBudgets(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection<FederalBudget>("federalBudget").deleteMany({ countryId: "RU" });
    const suStateIds = (
      await db.collection("states").find({ countryId: "RU" }).project({ _id: 1 }).toArray()
    ).map((s) => s._id as string);
    if (suStateIds.length > 0) {
      await db
        .collection<StateBudget>("stateBudgets")
        .deleteMany({ stateId: { $in: suStateIds }, countryId: "RU" });
    }
    await db.collection<EnactedLaw>("enactedLaws").deleteMany({ countryId: "RU" });
    log("Reset: deleted SU budget data");
  }

  const {
    getInitialNationalBudgetsForPreset,
    getNationalBudgetSeedConfigsForPreset,
    generateCountryOwnedSeedData,
    generateStateBudgets,
    generateDefaultEnactedLaws,
  } = await import("@/lib/seeds/reference/budgets");

  const presetBudgets = getInitialNationalBudgetsForPreset(preset);
  const suFiscalYear =
    getNationalBudgetSeedConfigsForPreset(preset).find((c) => c.countryId === "RU")?.fiscalYear ??
    1979;
  const suNationalBudget = presetBudgets.find((b) => b.countryId === "RU");
  if (!suNationalBudget) {
    log(`[SU] no national budget config for preset ${preset} — skipping`);
    return;
  }
  {
    const { _id, ...budgetData } = suNationalBudget;
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id }, { $set: { ...budgetData, updatedAt: new Date() } }, { upsert: true });
    log("Seeded 1 SU national budget");
  }

  const suEnactedLaws = generateDefaultEnactedLaws(preset).filter((law) => law.countryId === "RU");
  for (const law of suEnactedLaws) {
    const { _id, ...lawWithoutId } = law;
    const unsetFields: Record<string, ""> = {};
    if (law.gdpPerCapitaMultiplier === undefined) unsetFields.gdpPerCapitaMultiplier = "";
    if (law.annualCostPerCapita === undefined) unsetFields.annualCostPerCapita = "";
    if (law.annualCostUsd === undefined) unsetFields.annualCostUsd = "";
    if (law.gdpCostFraction === undefined) unsetFields.gdpCostFraction = "";
    if (law.incomeCostFraction === undefined) unsetFields.incomeCostFraction = "";
    const update: Record<string, unknown> = { $set: lawWithoutId, $setOnInsert: { _id } };
    if (Object.keys(unsetFields).length > 0) update.$unset = unsetFields;
    await db.collection<EnactedLaw>("enactedLaws").updateOne(
      {
        legislationTypeId: law.legislationTypeId,
        scope: law.scope,
        countryId: law.countryId,
        repealedAt: { $exists: false },
      },
      update,
      { upsert: true }
    );
  }
  log(`Seeded ${suEnactedLaws.length} SU default enacted laws`);

  const states = await db.collection<State>("states").find({ countryId: "RU" }).toArray();
  const statesForBudgets = states.map((s) => ({
    id: s._id,
    population: s.population,
    gdp: s.gdp,
    countryId: s.countryId,
  }));
  const stateBudgets = generateStateBudgets(statesForBudgets, suFiscalYear);
  for (const budget of stateBudgets) {
    const { _id, ...budgetData } = budget;
    await db
      .collection<StateBudget>("stateBudgets")
      .updateOne({ _id }, { $set: budgetData }, { upsert: true });
  }
  log(`Seeded ${stateBudgets.length} SU regional budgets`);

  // Command Economy v2 (P0): when `commandEconomyEnabled` is on, the RU seed
  // splits into one SOE per commanding-height sector (see generateCountryOwnedSeedData).
  const gameConfig = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
  const commandEconomyEnabled = gameConfig?.commandEconomyEnabled === true;

  const countryOwnedSeedData = generateCountryOwnedSeedData(
    statesForBudgets,
    preset,
    commandEconomyEnabled,
    log
  );
  const suCorpData = countryOwnedSeedData.filter(
    (entry) => entry.corporation.countryOwnerId === "RU"
  );
  await upsertCountryOwnedCorpEntries(db, "RU", suCorpData);
  const suSectorCount = suCorpData.reduce((n, e) => n + e.sectors.length, 0);
  if (suCorpData.length > 0)
    log(
      `Seeded ${suCorpData.length} SU state enterprise(s) with ${suSectorCount} owned producing sector(s)`
    );
}
