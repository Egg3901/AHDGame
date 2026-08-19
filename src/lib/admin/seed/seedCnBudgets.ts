import type { Db } from "mongodb";
import type { State } from "@/lib/db/types";
import type { FederalBudget, EnactedLaw, StateBudget } from "@/lib/db/types/budget";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { upsertCountryOwnedCorpEntries } from "./upsertCountryOwnedCorps";

export async function seedCnBudgets(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db.collection<FederalBudget>("federalBudget").deleteMany({ countryId: "CN" });
    const cnStateIds = (
      await db.collection("states").find({ countryId: "CN" }).project({ _id: 1 }).toArray()
    ).map((s) => s._id as string);
    if (cnStateIds.length > 0) {
      await db
        .collection<StateBudget>("stateBudgets")
        .deleteMany({ stateId: { $in: cnStateIds }, countryId: "CN" });
      // Belt-and-braces: clear any bare-_id docs left from the pre-rename CN
      // schema (NORTHEAST/EAST/…) so they don't linger after compound _id rollout.
      await db.collection<StateBudget>("stateBudgets").deleteMany({
        _id: {
          $in: ["NORTHEAST", "NORTH", "EAST", "CENTRAL", "SOUTH", "SOUTHWEST", "NORTHWEST"],
        } as never,
      });
    }
    await db.collection<EnactedLaw>("enactedLaws").deleteMany({ countryId: "CN" });
    log("Reset: deleted CN budget data");
  }

  const {
    getInitialNationalBudgetsForPreset,
    getNationalBudgetSeedConfigsForPreset,
    generateCountryOwnedSeedData,
    generateStateBudgets,
    generateDefaultEnactedLaws,
  } = await import("@/lib/seeds/reference/budgets");

  const presetBudgets = getInitialNationalBudgetsForPreset(preset);
  const cnFiscalYear =
    getNationalBudgetSeedConfigsForPreset(preset).find((c) => c.countryId === "CN")?.fiscalYear ??
    2023;
  const cnNationalBudget = presetBudgets.find((b) => b.countryId === "CN");
  if (cnNationalBudget) {
    const { _id, ...budgetData } = cnNationalBudget;
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id }, { $set: { ...budgetData, updatedAt: new Date() } }, { upsert: true });
    log("Seeded 1 CN national budget");
  }

  const allEnactedLaws = generateDefaultEnactedLaws(preset);
  const cnEnactedLaws = allEnactedLaws.filter((law) => law.countryId === "CN");
  for (const law of cnEnactedLaws) {
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
  log(`Seeded ${cnEnactedLaws.length} CN default enacted laws`);

  const states = await db.collection<State>("states").find({ countryId: "CN" }).toArray();
  const statesForBudgets = states.map((s) => ({
    id: s._id,
    population: s.population,
    gdp: s.gdp,
    countryId: s.countryId,
  }));
  const stateBudgets = generateStateBudgets(statesForBudgets, cnFiscalYear);
  for (const budget of stateBudgets) {
    const { _id, ...budgetData } = budget;
    await db
      .collection<StateBudget>("stateBudgets")
      .updateOne({ _id }, { $set: budgetData }, { upsert: true });
  }
  log(`Seeded ${stateBudgets.length} CN regional budgets`);

  // Command Economy v2 (#3496): when `commandEconomyEnabled` is on AND CN is in
  // its fully-command era (First-Five-Year-Plan band), the CN seed splits into
  // one SOE per commanding-height sector (see generateCountryOwnedSeedData).
  // Dual-track / market CN eras are unaffected, and flag-off is byte-identical.
  const gameConfig = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
  const commandEconomyEnabled = gameConfig?.commandEconomyEnabled === true;

  const countryOwnedSeedData = generateCountryOwnedSeedData(
    statesForBudgets,
    preset,
    commandEconomyEnabled
  );
  const cnCorpData = countryOwnedSeedData.filter(
    (entry) => entry.corporation.countryOwnerId === "CN"
  );
  await upsertCountryOwnedCorpEntries(db, "CN", cnCorpData);
  if (cnCorpData.length > 0) {
    const cnSectorCount = cnCorpData.reduce((n, e) => n + e.sectors.length, 0);
    const cnSoeCount = cnCorpData.filter((e) => e.corporation.soe).length;
    log(
      cnSoeCount > 0
        ? `Seeded 1 CN sovereign issuer + ${cnSoeCount} state enterprise(s) with ${cnSectorCount} owned producing sector(s)`
        : `Seeded ${cnCorpData.length} CN sovereign issuer setup(s)`
    );
  }
}
