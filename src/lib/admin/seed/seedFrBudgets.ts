import type { Db } from "mongodb";
import type { Corporation, CorporateSector, State } from "@/lib/db/types";
import type { FederalBudget, EnactedLaw, StateBudget } from "@/lib/db/types/budget";

/**
 * Seeds France's FY1979 national budget, default enacted laws (from the fr_*
 * legislation defaults), per-region state budgets, and the sovereign issuer.
 */
export async function seedFrBudgets(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection<FederalBudget>("federalBudget").deleteMany({ countryId: "FR" });
    const frStateIds = (
      await db.collection("states").find({ countryId: "FR" }).project({ _id: 1 }).toArray()
    ).map((s) => s._id as string);
    if (frStateIds.length > 0) {
      await db
        .collection<StateBudget>("stateBudgets")
        .deleteMany({ stateId: { $in: frStateIds }, countryId: "FR" });
    }
    await db.collection<EnactedLaw>("enactedLaws").deleteMany({ countryId: "FR" });
    log("Reset: deleted FR budget data");
  }

  const {
    getInitialNationalBudgetsForPreset,
    getNationalBudgetSeedConfigsForPreset,
    generateCountryOwnedSeedData,
    generateStateBudgets,
    generateDefaultEnactedLaws,
  } = await import("@/lib/seeds/reference/budgets");

  const presetBudgets = getInitialNationalBudgetsForPreset(preset);
  const frFiscalYear =
    getNationalBudgetSeedConfigsForPreset(preset).find((c) => c.countryId === "FR")?.fiscalYear ??
    1979;
  const frNationalBudget = presetBudgets.find((b) => b.countryId === "FR");
  if (!frNationalBudget) {
    log(`[FR] no national budget config for preset ${preset} — skipping`);
    return;
  }
  {
    const { _id, ...budgetData } = frNationalBudget;
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id }, { $set: { ...budgetData, updatedAt: new Date() } }, { upsert: true });
    log("Seeded 1 FR national budget");
  }

  const frEnactedLaws = generateDefaultEnactedLaws(preset).filter((law) => law.countryId === "FR");
  for (const law of frEnactedLaws) {
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
  log(`Seeded ${frEnactedLaws.length} FR default enacted laws`);

  const states = await db.collection<State>("states").find({ countryId: "FR" }).toArray();
  const statesForBudgets = states.map((s) => ({
    id: s._id,
    population: s.population,
    gdp: s.gdp,
    countryId: s.countryId,
  }));
  const stateBudgets = generateStateBudgets(statesForBudgets, frFiscalYear);
  for (const budget of stateBudgets) {
    const { _id, ...budgetData } = budget;
    await db
      .collection<StateBudget>("stateBudgets")
      .updateOne({ _id }, { $set: budgetData }, { upsert: true });
  }
  log(`Seeded ${stateBudgets.length} FR regional budgets`);

  const countryOwnedSeedData = generateCountryOwnedSeedData(statesForBudgets, preset);
  const frCorpData = countryOwnedSeedData.filter(
    (entry) => entry.corporation.countryOwnerId === "FR"
  );
  for (const entry of frCorpData) {
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
  if (frCorpData.length > 0) log(`Seeded ${frCorpData.length} FR sovereign issuer setup(s)`);
}
