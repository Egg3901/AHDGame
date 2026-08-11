import type { Db } from "mongodb";
import type { Corporation, CorporateSector, State } from "@/lib/db/types";
import type { FederalBudget, EnactedLaw, StateBudget } from "@/lib/db/types/budget";

/**
 * Seeds Sweden's FY1979 national budget, default enacted laws (from the se_*
 * legislation defaults), per-region state budgets, and the sovereign issuer.
 */
export async function seedSeBudgets(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection<FederalBudget>("federalBudget").deleteMany({ countryId: "SE" });
    const seStateIds = (
      await db.collection("states").find({ countryId: "SE" }).project({ _id: 1 }).toArray()
    ).map((s) => s._id as string);
    if (seStateIds.length > 0) {
      await db
        .collection<StateBudget>("stateBudgets")
        .deleteMany({ stateId: { $in: seStateIds }, countryId: "SE" });
    }
    await db.collection<EnactedLaw>("enactedLaws").deleteMany({ countryId: "SE" });
    log("Reset: deleted SE budget data");
  }

  const {
    getInitialNationalBudgetsForPreset,
    getNationalBudgetSeedConfigsForPreset,
    generateCountryOwnedSeedData,
    generateStateBudgets,
    generateDefaultEnactedLaws,
  } = await import("@/lib/seeds/reference/budgets");

  const presetBudgets = getInitialNationalBudgetsForPreset(preset);
  const seFiscalYear =
    getNationalBudgetSeedConfigsForPreset(preset).find((c) => c.countryId === "SE")?.fiscalYear ??
    1979;
  const seNationalBudget = presetBudgets.find((b) => b.countryId === "SE");
  if (!seNationalBudget) {
    log(`[SE] no national budget config for preset ${preset} — skipping`);
    return;
  }
  {
    const { _id, ...budgetData } = seNationalBudget;
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id }, { $set: { ...budgetData, updatedAt: new Date() } }, { upsert: true });
    log("Seeded 1 SE national budget");
  }

  const seEnactedLaws = generateDefaultEnactedLaws(preset).filter((law) => law.countryId === "SE");
  for (const law of seEnactedLaws) {
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
  log(`Seeded ${seEnactedLaws.length} SE default enacted laws`);

  const states = await db.collection<State>("states").find({ countryId: "SE" }).toArray();
  const statesForBudgets = states.map((s) => ({
    id: s._id,
    population: s.population,
    gdp: s.gdp,
    countryId: s.countryId,
  }));
  const stateBudgets = generateStateBudgets(statesForBudgets, seFiscalYear);
  for (const budget of stateBudgets) {
    const { _id, ...budgetData } = budget;
    await db
      .collection<StateBudget>("stateBudgets")
      .updateOne({ _id }, { $set: budgetData }, { upsert: true });
  }
  log(`Seeded ${stateBudgets.length} SE regional budgets`);

  const countryOwnedSeedData = generateCountryOwnedSeedData(statesForBudgets, preset);
  const seCorpData = countryOwnedSeedData.filter(
    (entry) => entry.corporation.countryOwnerId === "SE"
  );
  for (const entry of seCorpData) {
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
  if (seCorpData.length > 0) log(`Seeded ${seCorpData.length} SE sovereign issuer setup(s)`);
}
