import type { Db } from "mongodb";
import type { State } from "@/lib/db/types";
import type { FederalBudget, EnactedLaw, StateBudget } from "@/lib/db/types/budget";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { upsertCountryOwnedCorpEntries } from "./upsertCountryOwnedCorps";

/**
 * Seeds East Germany's FY1979 national budget, default enacted laws (from the dd_*
 * legislation defaults), per-region state budgets, and the sovereign issuer.
 */
export async function seedDdBudgets(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection<FederalBudget>("federalBudget").deleteMany({ countryId: "DD" });
    const ddStateIds = (
      await db.collection("states").find({ countryId: "DD" }).project({ _id: 1 }).toArray()
    ).map((s) => s._id as string);
    if (ddStateIds.length > 0) {
      await db
        .collection<StateBudget>("stateBudgets")
        .deleteMany({ stateId: { $in: ddStateIds }, countryId: "DD" });
    }
    await db.collection<EnactedLaw>("enactedLaws").deleteMany({ countryId: "DD" });
    log("Reset: deleted DD budget data");
  }

  const {
    getInitialNationalBudgetsForPreset,
    getNationalBudgetSeedConfigsForPreset,
    generateCountryOwnedSeedData,
    generateStateBudgets,
    generateDefaultEnactedLaws,
  } = await import("@/lib/seeds/reference/budgets");

  const presetBudgets = getInitialNationalBudgetsForPreset(preset);
  const ddFiscalYear =
    getNationalBudgetSeedConfigsForPreset(preset).find((c) => c.countryId === "DD")?.fiscalYear ??
    1979;
  const ddNationalBudget = presetBudgets.find((b) => b.countryId === "DD");
  if (!ddNationalBudget) {
    log(`[DD] no national budget config for preset ${preset} — skipping`);
    return;
  }
  {
    const { _id, ...budgetData } = ddNationalBudget;
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id }, { $set: { ...budgetData, updatedAt: new Date() } }, { upsert: true });
    log("Seeded 1 DD national budget");
  }

  const ddEnactedLaws = generateDefaultEnactedLaws(preset).filter((law) => law.countryId === "DD");
  for (const law of ddEnactedLaws) {
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
  log(`Seeded ${ddEnactedLaws.length} DD default enacted laws`);

  const states = await db.collection<State>("states").find({ countryId: "DD" }).toArray();
  const statesForBudgets = states.map((s) => ({
    id: s._id,
    population: s.population,
    gdp: s.gdp,
    countryId: s.countryId,
  }));
  const stateBudgets = generateStateBudgets(statesForBudgets, ddFiscalYear);
  for (const budget of stateBudgets) {
    const { _id, ...budgetData } = budget;
    await db
      .collection<StateBudget>("stateBudgets")
      .updateOne({ _id }, { $set: budgetData }, { upsert: true });
  }
  log(`Seeded ${stateBudgets.length} DD regional budgets`);

  // DD is a command economy, so it needs the same two arguments RU passes
  // (seedRuBudgets). Without them the generator defaults to preset
  // "2019-default" and commandEconomyEnabled false, which excludes DD from the
  // per-commanding-height SOE split by construction and prices its seed data
  // off the modern era table.
  const ddGameConfig = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
  const countryOwnedSeedData = generateCountryOwnedSeedData(
    statesForBudgets,
    preset,
    ddGameConfig?.commandEconomyEnabled === true
  );
  const ddCorpData = countryOwnedSeedData.filter(
    (entry) => entry.corporation.countryOwnerId === "DD"
  );
  const ddUpsert = await upsertCountryOwnedCorpEntries(db, "DD", ddCorpData);
  if (ddCorpData.length > 0) {
    log(
      `Seeded ${ddCorpData.length} DD sovereign issuer setup(s)` +
        (ddUpsert.repointed > 0
          ? `, re-pointed ${ddUpsert.repointed} sector(s) off a stale state-enterprise id`
          : "")
    );
  }
}
