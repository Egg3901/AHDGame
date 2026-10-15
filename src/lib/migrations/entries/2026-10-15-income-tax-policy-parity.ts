import type { AnyBulkWriteOperation } from "mongodb";
import type { FederalBudget, LegislationType, StatePolicy } from "@/lib/db/types";
import {
  INCOME_TAX_POLICY_JURISDICTIONS,
  incomeTaxPolicyOptionId,
} from "@/lib/budget/rules/incomeTaxPolicy";
import type { Migration } from "../types";

/** Align original seed policies with existing receipts, without changing rates or enacted laws. */
export const migration: Migration = {
  id: "2026-10-15-income-tax-policy-parity",
  description: "Align Brazil and Nigeria seeded income-tax records with their budget rates.",
  idempotent: true,
  execute: async (db, ctx) => {
    const ids = INCOME_TAX_POLICY_JURISDICTIONS.map((entry) => entry.legislationTypeId);
    const seedOnly = {
      scope: "national" as const,
      legislationTypeId: { $in: ids },
      enactedBy: { $exists: false },
      enactedByBillId: { $exists: false },
      enactedAt: { $exists: false },
      enactedTurn: { $exists: false },
    };
    const [policies, budgets, types] = await Promise.all([
      db.collection<StatePolicy>("statePolicies").find(seedOnly).toArray(),
      db
        .collection<FederalBudget>("federalBudget")
        .find(
          { countryId: { $in: ["BR", "NG"] } },
          { projection: { countryId: 1, "taxRates.incomeTax": 1, "taxRatePhaseIn.incomeTax": 1 } }
        )
        .toArray(),
      db
        .collection<LegislationType>("legislationTypes")
        .find(
          { _id: { $in: ids } },
          { projection: { "policyOptions.id": 1, "policyOptions.rate": 1 } }
        )
        .toArray(),
    ]);
    const ops: AnyBulkWriteOperation<StatePolicy>[] = [];
    for (const policy of policies) {
      const jurisdiction = INCOME_TAX_POLICY_JURISDICTIONS.find(
        (entry) =>
          entry.stateId === policy.stateId && entry.legislationTypeId === policy.legislationTypeId
      );
      if (!jurisdiction) continue;
      const budget = budgets.find(
        (entry) =>
          entry.countryId === jurisdiction.countryId && entry._id === jurisdiction.countryId
      );
      const type = types.find((entry) => entry._id === jurisdiction.legislationTypeId);
      if (!budget || !type) continue;
      const policyOptionId = incomeTaxPolicyOptionId({
        currentOptionId: policy.policyOptionId,
        options: type.policyOptions ?? [],
        effectiveRate: budget.taxRates?.incomeTax,
        pendingRate: budget.taxRatePhaseIn?.incomeTax,
      });
      if (!policyOptionId || policyOptionId === policy.policyOptionId) continue;
      ops.push({
        updateOne: {
          filter: {
            ...seedOnly,
            _id: policy._id,
            stateId: policy.stateId,
            legislationTypeId: policy.legislationTypeId,
            policyOptionId: policy.policyOptionId,
          },
          update: { $set: { policyOptionId } },
        },
      });
    }
    if (ctx.dryRun)
      return {
        documentsScanned: policies.length,
        documentsUpdated: 0,
        notes: [
          `Would align ${ops.length} seed policies; budget rates and ideological effects are preserved.`,
        ],
      };
    const result = ops.length
      ? await db.collection<StatePolicy>("statePolicies").bulkWrite(ops)
      : undefined;
    return { documentsScanned: policies.length, documentsUpdated: result?.modifiedCount ?? 0 };
  },
};
