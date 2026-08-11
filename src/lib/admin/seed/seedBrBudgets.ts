import type { Db } from "mongodb";
import type { Corporation, CorporateSector, State } from "@/lib/db/types";
import type { FederalBudget, EnactedLaw, StateBudget } from "@/lib/db/types/budget";

export async function seedBrBudgets(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection<FederalBudget>("federalBudget").deleteMany({ countryId: "BR" });
    const brStateIds = (
      await db.collection("states").find({ countryId: "BR" }).project({ _id: 1 }).toArray()
    ).map((s) => s._id as string);
    if (brStateIds.length > 0) {
      await db
        .collection<StateBudget>("stateBudgets")
        .deleteMany({ stateId: { $in: brStateIds }, countryId: "BR" });
    }
    await db.collection<EnactedLaw>("enactedLaws").deleteMany({ countryId: "BR" });
    log("Reset: deleted BR budget data");
  }

  const {
    getInitialNationalBudgetsForPreset,
    getNationalBudgetSeedConfigsForPreset,
    generateCountryOwnedSeedData,
    generateStateBudgets,
    generateDefaultEnactedLaws,
  } = await import("@/lib/seeds/reference/budgets");

  const presetBudgets = getInitialNationalBudgetsForPreset(preset);
  const brFiscalYear =
    getNationalBudgetSeedConfigsForPreset(preset).find((c) => c.countryId === "BR")?.fiscalYear ??
    2023;
  const brNationalBudget = presetBudgets.find((b) => b.countryId === "BR");
  if (brNationalBudget) {
    const { _id, ...budgetData } = brNationalBudget;
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id }, { $set: { ...budgetData, updatedAt: new Date() } }, { upsert: true });
    log("Seeded 1 BR national budget");
  }

  const allEnactedLaws = generateDefaultEnactedLaws(preset);
  const brEnactedLaws = allEnactedLaws.filter((law) => law.countryId === "BR");
  for (const law of brEnactedLaws) {
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
  log(`Seeded ${brEnactedLaws.length} BR default enacted laws`);

  const states = await db.collection<State>("states").find({ countryId: "BR" }).toArray();
  const statesForBudgets = states.map((s) => ({
    id: s._id,
    population: s.population,
    gdp: s.gdp,
    countryId: s.countryId,
  }));
  const stateBudgets = generateStateBudgets(statesForBudgets, brFiscalYear);
  for (const budget of stateBudgets) {
    const { _id, ...budgetData } = budget;
    await db
      .collection<StateBudget>("stateBudgets")
      .updateOne({ _id }, { $set: budgetData }, { upsert: true });
  }
  log(`Seeded ${stateBudgets.length} BR regional budgets`);

  const countryOwnedSeedData = generateCountryOwnedSeedData(statesForBudgets, preset);
  const brCorpData = countryOwnedSeedData.filter(
    (entry) => entry.corporation.countryOwnerId === "BR"
  );
  for (const entry of brCorpData) {
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
  if (brCorpData.length > 0) log(`Seeded ${brCorpData.length} BR sovereign issuer setup(s)`);
}
