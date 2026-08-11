import type { Db } from "mongodb";
import type { Corporation, CorporateSector, State } from "@/lib/db/types";
import type { FederalBudget, EnactedLaw, StateBudget } from "@/lib/db/types/budget";
import { getInitialRates } from "@/lib/constants/currencies";

export async function seedNgBudgets(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection<FederalBudget>("federalBudget").deleteMany({ countryId: "NG" });
    const ngStateIds = (
      await db.collection("states").find({ countryId: "NG" }).project({ _id: 1 }).toArray()
    ).map((s) => s._id as string);
    if (ngStateIds.length > 0) {
      await db
        .collection<StateBudget>("stateBudgets")
        .deleteMany({ stateId: { $in: ngStateIds }, countryId: "NG" });
    }
    await db.collection<EnactedLaw>("enactedLaws").deleteMany({ countryId: "NG" });
    log("Reset: deleted NG budget data");
  }

  const {
    getInitialNationalBudgetsForPreset,
    getNationalBudgetSeedConfigsForPreset,
    generateCountryOwnedSeedData,
    generateStateBudgets,
    generateDefaultEnactedLaws,
  } = await import("@/lib/seeds/reference/budgets");

  const presetBudgets = getInitialNationalBudgetsForPreset(preset);
  const ngFiscalYear =
    getNationalBudgetSeedConfigsForPreset(preset).find((c) => c.countryId === "NG")?.fiscalYear ??
    2023;
  const ngNationalBudget = presetBudgets.find((b) => b.countryId === "NG");
  if (ngNationalBudget) {
    const { _id, ...budgetData } = ngNationalBudget;
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id }, { $set: { ...budgetData, updatedAt: new Date() } }, { upsert: true });
    log("Seeded 1 NG national budget");
  }

  // Seed NGN exchange rate so the commodity price turn can normalize NG state
  // budgets (stored in local NGN) to anchor USD. Use the era-appropriate rate for
  // the active preset (e.g. 1953 colonial West African pound ~0.357, not the
  // modern ~1550 naira) so a historical reseed isn't anachronistic. NG IS
  // forex-active, so seedForex/seedExchangeRates also seeds this row era-aware;
  // this writer just runs first in bootstrap ordering. $setOnInsert keeps any
  // live rate that may have been set via admin tooling.
  const ngnRate = getInitialRates(preset)["NG"] ?? 1550;
  await db.collection("exchangeRates").updateOne(
    { _id: "NG" as never },
    {
      $setOnInsert: {
        _id: "NG",
        countryId: "NG",
        currencyCode: "NGN",
        rate: ngnRate,
        baseRate: ngnRate,
        macroTarget: ngnRate,
        rateHistory: [],
        buyVolume24: 0,
        sellVolume24: 0,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
  log(`Seeded NGN exchange rate (${ngnRate} NGN/USD)`);

  const allEnactedLaws = generateDefaultEnactedLaws(preset);
  const ngEnactedLaws = allEnactedLaws.filter((law) => law.countryId === "NG");
  for (const law of ngEnactedLaws) {
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
  log(`Seeded ${ngEnactedLaws.length} NG default enacted laws`);

  const states = await db.collection<State>("states").find({ countryId: "NG" }).toArray();
  const statesForBudgets = states.map((s) => ({
    id: s._id,
    population: s.population,
    gdp: s.gdp,
    countryId: s.countryId,
  }));
  const stateBudgets = generateStateBudgets(statesForBudgets, ngFiscalYear);
  for (const budget of stateBudgets) {
    const { _id, ...budgetData } = budget;
    await db
      .collection<StateBudget>("stateBudgets")
      .updateOne({ _id }, { $set: budgetData }, { upsert: true });
  }
  log(`Seeded ${stateBudgets.length} NG regional budgets`);

  const countryOwnedSeedData = generateCountryOwnedSeedData(statesForBudgets, preset);
  const ngCorpData = countryOwnedSeedData.filter(
    (entry) => entry.corporation.countryOwnerId === "NG"
  );
  for (const entry of ngCorpData) {
    const { _id: corpId, ...corpData } = entry.corporation;
    await db
      .collection<Corporation>("corporations")
      .updateOne({ _id: corpId }, { $set: corpData }, { upsert: true });
    for (const sector of entry.sectors) {
      const { _id: _sectorId, ...sectorData } = sector;
      await db
        .collection<CorporateSector>("corporateSectors")
        .updateOne(
          { corporationId: corpId, stateId: sector.stateId, sectorType: sector.sectorType },
          { $set: sectorData },
          { upsert: true }
        );
    }
  }
  if (ngCorpData.length > 0) log(`Seeded ${ngCorpData.length} NG sovereign issuer setup(s)`);
}
