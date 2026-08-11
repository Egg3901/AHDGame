import type { Db } from "mongodb";
import type { Corporation, CorporateSector, State } from "@/lib/db/types";
import type { FederalBudget, EnactedLaw, StateBudget } from "@/lib/db/types/budget";

/**
 * Seeds only DE budget data: national budget, enacted laws, and Länder budgets.
 */
export async function seedDeBudgets(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection<FederalBudget>("federalBudget").deleteMany({ countryId: "DE" });
    const deStateIds = (
      await db.collection("states").find({ countryId: "DE" }).project({ _id: 1 }).toArray()
    ).map((state) => state._id as string);
    if (deStateIds.length > 0) {
      await db.collection<StateBudget>("stateBudgets").deleteMany({ stateId: { $in: deStateIds } });
    }
    await db.collection<EnactedLaw>("enactedLaws").deleteMany({ countryId: "DE" });
    log("Reset: deleted DE budget data");
  }

  const {
    getInitialNationalBudgetsForPreset,
    getNationalBudgetSeedConfigsForPreset,
    generateCountryOwnedSeedData,
    generateStateBudgets,
    generateDefaultEnactedLaws,
  } = await import("@/lib/seeds/reference/budgets");

  const presetBudgets = getInitialNationalBudgetsForPreset(preset);
  const deFiscalYear =
    getNationalBudgetSeedConfigsForPreset(preset).find((c) => c.countryId === "DE")?.fiscalYear ??
    2020;
  const deNationalBudget = presetBudgets.find((budget) => budget.countryId === "DE");
  if (deNationalBudget) {
    const { _id, ...budgetData } = deNationalBudget;
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id }, { $set: { ...budgetData, updatedAt: new Date() } }, { upsert: true });
    log("Seeded 1 DE national budget");
  }

  const allEnactedLaws = generateDefaultEnactedLaws(preset);
  const deEnactedLaws = allEnactedLaws.filter((law) => law.countryId === "DE");
  for (const law of deEnactedLaws) {
    const { _id, ...lawWithoutId } = law;

    const unsetFields: Record<string, ""> = {};
    if (law.gdpPerCapitaMultiplier === undefined) unsetFields.gdpPerCapitaMultiplier = "";
    if (law.annualCostPerCapita === undefined) unsetFields.annualCostPerCapita = "";
    if (law.annualCostUsd === undefined) unsetFields.annualCostUsd = "";
    if (law.gdpCostFraction === undefined) unsetFields.gdpCostFraction = "";
    if (law.incomeCostFraction === undefined) unsetFields.incomeCostFraction = "";

    const update: Record<string, unknown> = {
      $set: lawWithoutId,
      $setOnInsert: { _id },
    };
    if (Object.keys(unsetFields).length > 0) {
      update.$unset = unsetFields;
    }

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
  log(`Seeded ${deEnactedLaws.length} DE default enacted laws`);

  const states = await db.collection<State>("states").find({ countryId: "DE" }).toArray();
  const statesForBudgets = states.map((state) => ({
    id: state._id,
    population: state.population,
    gdp: state.gdp,
    countryId: state.countryId,
  }));

  const stateBudgets = generateStateBudgets(statesForBudgets, deFiscalYear);
  for (const budget of stateBudgets) {
    const { _id, ...budgetData } = budget;
    await db
      .collection<StateBudget>("stateBudgets")
      .updateOne({ _id }, { $set: budgetData }, { upsert: true });
  }
  log(`Seeded ${stateBudgets.length} DE regional budgets`);

  const countryOwnedSeedData = generateCountryOwnedSeedData(statesForBudgets, preset);
  const deCorpData = countryOwnedSeedData.filter(
    (entry) => entry.corporation.countryOwnerId === "DE"
  );
  for (const entry of deCorpData) {
    const { _id: corpId, ...corpData } = entry.corporation;
    await db
      .collection<Corporation>("corporations")
      .updateOne({ _id: corpId }, { $set: corpData }, { upsert: true });

    for (const sector of entry.sectors) {
      const { _id: _sectorId, ...sectorData } = sector;
      await db.collection<CorporateSector>("corporateSectors").updateOne(
        {
          corporationId: corpId,
          stateId: sector.stateId,
          sectorType: sector.sectorType,
        },
        { $set: sectorData },
        { upsert: true }
      );
    }
  }
  if (deCorpData.length > 0) {
    log(`Seeded ${deCorpData.length} DE country-owned public corporation setup(s)`);
  }
}
