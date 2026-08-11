import type { Db } from "mongodb";
import { logWarning } from "@/lib/utils/errorLog";
import type { Corporation, CorporateSector, State } from "@/lib/db/types";
import type { FederalBudget, EnactedLaw, StateBudget, FormulaGrant } from "@/lib/db/types/budget";

/**
 * Seeds US-only budget data: federal budget, US enacted laws, US state budgets,
 * US country-owned corporation, and formula grants. UK data is handled by seedUkBudgets.
 *
 * `preset` selects 2019-default vs 1991-default fiscal-year configs. Defaults
 * to 2019 for back-compat with callers that don't yet thread the preset
 * through.
 */
export async function seedBudgets(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    // Only delete US-specific budget data, not UK/JP
    await db.collection<FederalBudget>("federalBudget").deleteMany({ countryId: "US" });
    const usStateIds = (
      await db.collection("states").find({ countryId: "US" }).project({ _id: 1 }).toArray()
    ).map((s) => s._id as string);
    if (usStateIds.length > 0) {
      await db
        .collection<StateBudget>("stateBudgets")
        .deleteMany({ stateId: { $in: usStateIds }, countryId: "US" });
    }
    // ⚠️ Only on presets where this function actually rebuilds the US law book.
    //
    // On a political-legislation preset (1953) the authored US baseline comes
    // from `seedPoliticalLegislationBaseline`, because
    // `POLITICAL_LEGISLATION_EXCLUDED_SCOPES` strips the legacy US catalog out
    // of the budget-derived defaults below. That seeder lives in the
    // orchestrators, NOT in `runSeed` — so on `POST /api/seed?reset=true` and
    // `scripts/seed/seed.ts --reset` this delete removed the US law book with nothing
    // to restore it. MEASURED as enactedLaws 742 -> 642, exactly the 100 US rows.
    //
    // Scoping the delete to the US does not help; the US is who loses them.
    // Calling `seedPoliticalLegislationBaseline` from here would be worse — it
    // prices every LAW_COUNTRY_ID against `countryFiscalBase`, and on the
    // standalone path only US budgets exist, so it would silently MISPRICE
    // UK/RU/DD to fix a US omission. Deleting only what we rebuild is the fix.
    const { isPoliticalLegislationPreset } = await import("./seedPoliticalLegislation");
    if (!isPoliticalLegislationPreset(preset)) {
      await db.collection<EnactedLaw>("enactedLaws").deleteMany({ countryId: "US" });
    }
    // Formula grants are US-only, safe to drop
    await db
      .collection("formulaGrants")
      .drop()
      .catch(() => {
        /* collection may not exist */
      });
    log("Reset: deleted US budget data");
  }
  const {
    getInitialNationalBudgetsForPreset,
    getNationalBudgetSeedConfigsForPreset,
    generateCountryOwnedSeedData,
    generateStateBudgets,
    generateDefaultEnactedLaws,
  } = await import("@/lib/seeds/reference/budgets");
  const { formulaGrants } = await import("@/lib/seeds/reference/formulaGrants");

  const presetBudgets = getInitialNationalBudgetsForPreset(preset);
  const usFiscalYear =
    getNationalBudgetSeedConfigsForPreset(preset).find((c) => c.countryId === "US")?.fiscalYear ??
    2020;

  // Seed US national budget only (UK is handled by seedUkBudgets)
  const usNationalBudgets = presetBudgets.filter((b) => b.countryId === "US");
  for (const nationalBudget of usNationalBudgets) {
    const { _id, ...budgetData } = nationalBudget;
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id }, { $set: { ...budgetData, updatedAt: new Date() } }, { upsert: true });
  }
  log(`Seeded ${usNationalBudgets.length} US national budget(s)`);

  // Seed US default enacted laws so runtime spending calculation has data.
  // $unset stale cost fields to prevent priority conflicts in calculateEnactedLawAnnualCost
  // (which checks gdpPerCapitaMultiplier before annualCostPerCapita — a stale gdpPerCapitaMultiplier: 0
  // from a previous seed would shadow a correct annualCostPerCapita from the current seed).
  const allDefaultEnactedLaws = generateDefaultEnactedLaws(preset);
  const defaultEnactedLaws = allDefaultEnactedLaws.filter((law) => law.countryId === "US");
  for (const law of defaultEnactedLaws) {
    const { _id, ...lawWithoutId } = law;

    // Determine which cost fields to unset (those NOT in the current law)
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
  log(`Seeded ${defaultEnactedLaws.length} US default enacted laws`);

  // Get US states for generating state budgets (UK handled by seedUkBudgets, JP by seedJpBudgets)
  const states = await db.collection<State>("states").find({ countryId: "US" }).toArray();
  const statesForBudgets = states.map((s) => ({
    id: s._id,
    population: s.population,
    gdp: s.gdp,
    countryId: s.countryId,
  }));
  const stateBudgets = generateStateBudgets(statesForBudgets, usFiscalYear);
  for (const budget of stateBudgets) {
    const { _id, ...budgetData } = budget;
    await db
      .collection<StateBudget>("stateBudgets")
      .updateOne({ _id }, { $set: budgetData }, { upsert: true });
  }
  log(`Seeded ${stateBudgets.length} US state budgets`);

  // Seed US country-owned public corporation (UK NHS handled by seedUkBudgets, JP by seedJpBudgets)
  const countryOwnedSeedData = generateCountryOwnedSeedData(statesForBudgets, preset);
  const usCorpData = countryOwnedSeedData.filter(
    (entry) => entry.corporation.countryOwnerId === "US"
  );
  for (const entry of usCorpData) {
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
  if (usCorpData.length > 0) {
    log(`Seeded ${usCorpData.length} US country-owned public corporation setup(s)`);
  }

  // Seed formula grants
  const validGrantIds = formulaGrants.map((g) => g.programId);
  for (const grant of formulaGrants) {
    await db
      .collection<FormulaGrant>("formulaGrants")
      .updateOne({ programId: grant.programId }, { $set: grant }, { upsert: true });
  }

  // Remove stale formula grants that no longer exist
  const grantDeleteResult = await db.collection("formulaGrants").deleteMany({
    programId: { $nin: validGrantIds },
  });
  const staleGrantsRemoved = grantDeleteResult.deletedCount || 0;

  log(
    `Seeded ${formulaGrants.length} formula grants${staleGrantsRemoved > 0 ? `, removed ${staleGrantsRemoved} stale entries` : ""}`
  );

  // Budget indexes
  await db
    .collection("stateBudgets")
    .createIndex({ stateId: 1 })
    .catch((error) => {
      logWarning("Index creation failed (may already exist)", {
        component: "AdminSeedRoute",
        action: "createIndex",
        metadata: { index: "stateId", error: String(error) },
      });
    });
  await db
    .collection("enactedLaws")
    .createIndex({ scope: 1, stateId: 1 })
    .catch((error) => {
      logWarning("Index creation failed (may already exist)", {
        component: "AdminSeedRoute",
        action: "createIndex",
        metadata: { index: "scope_stateId", error: String(error) },
      });
    });
  await db
    .collection("enactedLaws")
    .createIndex({ legislationTypeId: 1 })
    .catch((error) => {
      logWarning("Index creation failed (may already exist)", {
        component: "AdminSeedRoute",
        action: "createIndex",
        metadata: { index: "legislationTypeId", error: String(error) },
      });
    });
  log("Budget indexes created");
}
