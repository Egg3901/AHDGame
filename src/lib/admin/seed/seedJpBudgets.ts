import type { AnyBulkWriteOperation, Db, Document } from "mongodb";
import type { Corporation, CorporateSector, State } from "@/lib/db/types";
import type { FederalBudget, EnactedLaw, StateBudget } from "@/lib/db/types/budget";

/**
 * Seeds only JP budget data: national budget, enacted laws, regional budgets,
 * and the JP country-owned sovereign issuer corporation. Leaves US/UK data untouched.
 */
export async function seedJpBudgets(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    // Only delete JP-specific budget data, not US/UK
    await db.collection<FederalBudget>("federalBudget").deleteMany({ countryId: "JP" });
    const jpStateIds = (
      await db.collection("states").find({ countryId: "JP" }).project({ _id: 1 }).toArray()
    ).map((s) => s._id as string);
    if (jpStateIds.length > 0) {
      await db
        .collection<StateBudget>("stateBudgets")
        .deleteMany({ stateId: { $in: jpStateIds }, countryId: "JP" });
    }
    await db.collection<EnactedLaw>("enactedLaws").deleteMany({ countryId: "JP" });
    log("Reset: deleted JP budget data");
  }

  const {
    getInitialNationalBudgetsForPreset,
    getNationalBudgetSeedConfigsForPreset,
    generateCountryOwnedSeedData,
    generateStateBudgets,
    generateDefaultEnactedLaws,
  } = await import("@/lib/seeds/reference/budgets");

  const presetBudgets = getInitialNationalBudgetsForPreset(preset);
  const jpFiscalYear =
    getNationalBudgetSeedConfigsForPreset(preset).find((c) => c.countryId === "JP")?.fiscalYear ??
    2020;

  // Seed JP national budget
  const jpNationalBudget = presetBudgets.find((b) => b.countryId === "JP");
  if (jpNationalBudget) {
    const { _id, ...budgetData } = jpNationalBudget;
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id }, { $set: { ...budgetData, updatedAt: new Date() } }, { upsert: true });
    log("Seeded 1 JP national budget");
  }

  // Seed JP default enacted laws
  const allEnactedLaws = generateDefaultEnactedLaws(preset);
  const jpEnactedLaws = allEnactedLaws.filter((law) => law.countryId === "JP");
  for (const law of jpEnactedLaws) {
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
  log(`Seeded ${jpEnactedLaws.length} JP default enacted laws`);

  // Seed JP regional budgets
  const states = await db.collection<State>("states").find({ countryId: "JP" }).toArray();
  const statesForBudgets = states.map((s) => ({
    id: s._id,
    population: s.population,
    gdp: s.gdp,
    countryId: s.countryId,
  }));
  const stateBudgets = generateStateBudgets(statesForBudgets, jpFiscalYear);
  for (const budget of stateBudgets) {
    const { _id, ...budgetData } = budget;
    await db
      .collection<StateBudget>("stateBudgets")
      .updateOne({ _id }, { $set: budgetData }, { upsert: true });
  }
  log(`Seeded ${stateBudgets.length} JP regional budgets`);

  // Seed JP country-owned sovereign issuer corporation
  const countryOwnedSeedData = generateCountryOwnedSeedData(statesForBudgets, preset);
  const jpCorpData = countryOwnedSeedData.filter(
    (entry) => entry.corporation.countryOwnerId === "JP"
  );
  for (const entry of jpCorpData) {
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
  if (jpCorpData.length > 0) {
    log(`Seeded ${jpCorpData.length} JP country-owned sovereign issuer setup(s)`);
  }

  // Seed JP regional state policies so the budget processor can resolve tax rates.
  // JP types don't use allowedScope — regional types are identified by
  // effectTarget.scope === "state" or taxRateChange.scope === "state".
  const { legislationTypes } = await import("@/lib/seeds/reference/legislationTypes");
  const jpRegionalTypes = legislationTypes.filter(
    (lt: {
      countryScope?: string;
      effectTarget?: { scope?: string };
      taxRateChange?: { scope?: string };
    }) =>
      lt.countryScope === "jp" &&
      (lt.effectTarget?.scope === "state" || lt.taxRateChange?.scope === "state")
  );
  let regionalPoliciesSeeded = 0;
  const policyOps: AnyBulkWriteOperation<Document>[] = [];
  for (const state of states) {
    for (const lt of jpRegionalTypes) {
      const centerIndex = Math.floor((lt.policyOptions?.length ?? 0) / 2);
      const centerOption = lt.policyOptions?.[centerIndex];
      if (!centerOption) continue;
      policyOps.push({
        updateOne: {
          filter: {
            scope: "state",
            stateId: state._id,
            legislationTypeId: lt._id,
            policyOptionId: { $exists: false },
          },
          update: {
            $set: {
              policyOptionId: centerOption.id,
              policyOptionIndex: centerIndex,
            },
          },
        },
      });
      policyOps.push({
        updateOne: {
          filter: { scope: "state", stateId: state._id, legislationTypeId: lt._id },
          update: {
            $setOnInsert: {
              scope: "state",
              stateId: state._id,
              legislationTypeId: lt._id,
              economic: 0,
              social: 0,
              policyOptionId: centerOption.id,
              policyOptionIndex: centerIndex,
              updatedAt: new Date(),
            },
          },
          upsert: true,
        },
      });
      regionalPoliciesSeeded++;
    }
  }
  // Interleaved + ordered: the backfill and the upsert hit the same document,
  // so their relative order is the behaviour, not an implementation detail.
  if (policyOps.length > 0) {
    await db.collection("statePolicies").bulkWrite(policyOps, { ordered: true });
  }
  if (regionalPoliciesSeeded > 0) {
    log(`Seeded ${regionalPoliciesSeeded} JP regional policies with policyOptionId`);
  }
}
