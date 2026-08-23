import type { Db, Filter } from "mongodb";
import type { GovernorExecutiveOrder, LegislationType, StatePolicy } from "@/lib/db/types";
import type { EnactedLaw } from "@/lib/db/types/budget";
import {
  buildOrderRevertPolicyFields,
  policyFieldsFromOption,
} from "@/lib/governorOffice/orders/revertPolicy";
import type { Migration, MigrationResult } from "../types";

const STATE_ID = "KAZ";

type CanonicalPolicyFields = Pick<
  StatePolicy,
  "policyOptionIndex" | "policyOptionId" | "economic" | "social" | "effectDirection"
>;

function fieldsDiffer(policy: StatePolicy, canonical: CanonicalPolicyFields): boolean {
  return (Object.keys(canonical) as Array<keyof CanonicalPolicyFields>).some(
    (field) => policy[field] !== canonical[field]
  );
}

async function repairKazakhLawLevels(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const policies = await db
    .collection<StatePolicy>("statePolicies")
    .find({ stateId: STATE_ID })
    .toArray();
  const legislationTypeIds = [...new Set(policies.map((policy) => policy.legislationTypeId))];
  const [legislationTypes, enactedLaws, orders] = await Promise.all([
    db
      .collection<LegislationType>("legislationTypes")
      .find({ _id: { $in: legislationTypeIds } })
      .toArray(),
    db.collection<EnactedLaw>("enactedLaws").find({ stateId: STATE_ID }).toArray(),
    db
      .collection<GovernorExecutiveOrder>("governorExecutiveOrders")
      .find({ stateId: STATE_ID })
      .toArray(),
  ]);

  const legislationTypesById = new Map(
    legislationTypes.map((legislationType) => [legislationType._id, legislationType])
  );
  const enactedLawsByBillId = new Map(
    enactedLaws.map((law) => [`${law.billId.toString()}:${law.legislationTypeId}`, law])
  );
  const ordersById = new Map(
    orders.filter((order) => order._id).map((order) => [order._id!.toString(), order])
  );

  const repairs: Array<{
    filter: Filter<StatePolicy>;
    fields: CanonicalPolicyFields;
    label: string;
  }> = [];

  for (const policy of policies) {
    const legislationType = legislationTypesById.get(policy.legislationTypeId);
    if (!legislationType || !policy.enactedBy) continue;

    let canonical: CanonicalPolicyFields | null = null;
    if (policy.enactedBy.kind === "bill") {
      const law = enactedLawsByBillId.get(
        `${policy.enactedBy.id.toString()}:${policy.legislationTypeId}`
      );
      const option =
        law?.policyOptionIndex != null
          ? legislationType.policyOptions?.[law.policyOptionIndex]
          : undefined;
      if (law?.policyOptionIndex != null && option) {
        canonical = policyFieldsFromOption(option, law.policyOptionIndex);
      }
    } else if (policy.enactedBy.kind === "expiry") {
      const order = ordersById.get(policy.enactedBy.id.toString());
      if (order) {
        const restored = buildOrderRevertPolicyFields(order, legislationType, policy.enactedTurn);
        if (
          restored.policyOptionId != null &&
          restored.economic != null &&
          restored.social != null
        ) {
          canonical = {
            policyOptionIndex: restored.policyOptionIndex,
            policyOptionId: restored.policyOptionId,
            economic: restored.economic,
            social: restored.social,
            effectDirection: restored.effectDirection,
          };
        }
      }
    }

    if (!canonical || !fieldsDiffer(policy, canonical)) continue;
    repairs.push({
      filter: policy._id
        ? { _id: policy._id }
        : { stateId: policy.stateId, legislationTypeId: policy.legislationTypeId },
      fields: canonical,
      label: `${policy.legislationTypeId}:${canonical.policyOptionId}`,
    });
  }

  if (!dryRun) {
    for (const repair of repairs) {
      await db.collection<StatePolicy>("statePolicies").updateOne(repair.filter, {
        $set: repair.fields,
      });
    }
  }

  return {
    documentsScanned: policies.length,
    documentsUpdated: dryRun ? 0 : repairs.length,
    notes: [
      `${dryRun ? "would repair" : "repaired"} ${repairs.length} KAZ policy rows`,
      ...repairs.map((repair) => repair.label),
    ],
  };
}

export const migration: Migration = {
  id: "2026-08-23-repair-kazakh-law-levels",
  description:
    "Repair ticket 1174 KAZ policy rows from enacted laws and executive-order snapshots.",
  idempotent: true,
  execute: (db, ctx) => repairKazakhLawLevels(db, ctx.dryRun),
};
