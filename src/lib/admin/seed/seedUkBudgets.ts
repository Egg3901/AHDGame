import type { AnyBulkWriteOperation, Db, Document } from "mongodb";
import { logWarning } from "@/lib/utils/errorLog";
import type { Corporation, CorporateSector, State } from "@/lib/db/types";
import type { FederalBudget, EnactedLaw, StateBudget } from "@/lib/db/types/budget";

/**
 * Seeds only UK budget data: national budget, enacted laws, regional budgets,
 * and the UK country-owned corporation (NHS). Leaves US data untouched.
 */
export async function seedUkBudgets(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    // Only delete UK-specific budget data, not US
    await db.collection<FederalBudget>("federalBudget").deleteMany({ countryId: "UK" });
    const ukStateIds = (
      await db.collection("states").find({ countryId: "UK" }).project({ _id: 1 }).toArray()
    ).map((s) => s._id as string);
    await db
      .collection<StateBudget>("stateBudgets")
      .deleteMany({ stateId: { $in: ukStateIds }, countryId: "UK" });
    await db.collection<EnactedLaw>("enactedLaws").deleteMany({ countryId: "UK" });
    log("Reset: deleted UK budget data");
  }

  const {
    getInitialNationalBudgetsForPreset,
    getNationalBudgetSeedConfigsForPreset,
    generateCountryOwnedSeedData,
    generateStateBudgets,
    generateDefaultEnactedLaws,
  } = await import("@/lib/seeds/reference/budgets");

  const presetBudgets = getInitialNationalBudgetsForPreset(preset);
  const ukFiscalYear =
    getNationalBudgetSeedConfigsForPreset(preset).find((c) => c.countryId === "UK")?.fiscalYear ??
    2020;

  // Seed UK national budget only
  const ukNationalBudget = presetBudgets.find((b) => b.countryId === "UK");
  if (ukNationalBudget) {
    const { _id, ...budgetData } = ukNationalBudget;
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id }, { $set: { ...budgetData, updatedAt: new Date() } }, { upsert: true });
    log("Seeded 1 UK national budget");
  }

  // Seed UK default enacted laws
  const allEnactedLaws = generateDefaultEnactedLaws(preset);
  const ukEnactedLaws = allEnactedLaws.filter((law) => law.countryId === "UK");
  for (const law of ukEnactedLaws) {
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
  log(`Seeded ${ukEnactedLaws.length} UK default enacted laws`);

  // Seed UK regional budgets
  const states = await db.collection<State>("states").find({ countryId: "UK" }).toArray();
  const statesForBudgets = states.map((s) => ({
    id: s._id,
    population: s.population,
    gdp: s.gdp,
    countryId: s.countryId,
  }));
  const stateBudgets = generateStateBudgets(statesForBudgets, ukFiscalYear);
  for (const budget of stateBudgets) {
    const { _id, ...budgetData } = budget;
    await db
      .collection<StateBudget>("stateBudgets")
      .updateOne({ _id }, { $set: budgetData }, { upsert: true });
  }
  log(`Seeded ${stateBudgets.length} UK regional budgets`);

  // Seed UK country-owned corporation (NHS nationalized healthcare)
  const countryOwnedSeedData = generateCountryOwnedSeedData(statesForBudgets, preset);
  const ukCorpData = countryOwnedSeedData.filter(
    (entry) => entry.corporation.countryOwnerId === "UK"
  );
  for (const entry of ukCorpData) {
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
  if (ukCorpData.length > 0) {
    log(`Seeded ${ukCorpData.length} UK country-owned public corporation setup(s)`);
  }

  // Seed/update UK regional state policies (spending + tax) with policyOptionId
  // so the regional budget processor can look up annualCostPerCapita.
  //
  // Gated on the preset for the same reason `seedStatePolicies` gates the
  // national ones (political-legislation spec §6): on a v2 preset
  // `seedLegislationTypes` unseeds AND prunes every `countryScope: "uk"` type,
  // so seeding these anyway wrote 18 policies × 12 regions pointing at
  // legislation that no longer exists. Those dangling rows are invisible until
  // something reads through them — which is how UK regional revenue silently
  // resolved to £0 while the cost half kept pricing through the v2 catalog.
  const { legislationTypes } = await import("@/lib/seeds/reference/legislationTypes");
  const { isPoliticalLegislationPreset } = await import("./seedPoliticalLegislation");
  const ukRegionalTypes = isPoliticalLegislationPreset(preset)
    ? []
    : legislationTypes.filter(
        (lt: { countryScope?: string; allowedScope?: string }) =>
          lt.countryScope === "uk" && lt.allowedScope === "state"
      );
  let regionalPoliciesSeeded = 0;
  const policyOps: AnyBulkWriteOperation<Document>[] = [];
  for (const state of states) {
    for (const lt of ukRegionalTypes) {
      const centerIndex = Math.floor((lt.policyOptions?.length ?? 0) / 2);
      const centerOption = lt.policyOptions?.[centerIndex];
      if (!centerOption) continue;
      // Only set policyOptionId if not already present (don't overwrite in-game changes)
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
      // Ensure the policy exists (upsert for fresh DBs)
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
  // The two ops above touch the SAME document and their order matters — the
  // backfill must see the doc before the upsert can create it. They are pushed
  // interleaved and written `ordered`, so the sequence is byte-for-byte what
  // the sequential awaits produced.
  if (policyOps.length > 0) {
    await db.collection("statePolicies").bulkWrite(policyOps, { ordered: true });
  }
  if (regionalPoliciesSeeded > 0) {
    log(`Seeded ${regionalPoliciesSeeded} UK regional policies with policyOptionId`);
  }

  // Budget indexes (idempotent, safe to run for both US and UK)
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
  log("UK budget indexes ensured");
}
