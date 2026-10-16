/** Income-tax seed policies use the live budget target, including tier-specific laws. */
import type { Db } from "mongodb";
import type { FederalBudget, StateBudget, LegislationType } from "@/lib/db/types";
import { incomeTierForTaxKey, incomeTaxRate } from "./rules/incomeTaxTiers";

export async function alignSeedIncomeTaxTierRecords<
  T extends { scope: string; stateId?: string; legislationTypeId: string; policyOptionId?: string },
>(db: Db, records: T[]): Promise<T[]> {
  const [national, regional, types] = await Promise.all([
    db
      .collection<FederalBudget>("federalBudget")
      .find({}, { projection: { countryId: 1, taxRates: 1, taxRatePhaseIn: 1 } })
      .toArray(),
    db
      .collection<StateBudget>("stateBudgets")
      .find({}, { projection: { countryId: 1, taxRates: 1 } })
      .toArray(),
    db
      .collection<LegislationType>("legislationTypes")
      .find(
        {
          _id: {
            $in: records
              .filter((record) => record.legislationTypeId.includes("__income_"))
              .map((record) => record.legislationTypeId),
          },
        },
        { projection: { countryScope: 1, taxRateChange: 1, taxSlider: 1 } }
      )
      .toArray(),
  ]);
  const byType = new Map(types.map((type) => [type._id, type]));
  return records.map((record) => {
    const type = byType.get(record.legislationTypeId);
    const change = type?.taxSlider ?? type?.taxRateChange;
    const tier = change && incomeTierForTaxKey(change.taxType);
    if (!type || !change || !tier) return record;
    const budget =
      change.scope === "federal"
        ? national.find((budget) => budget.countryId.toLowerCase() === (type.countryScope ?? "us"))
        : regional.find((budget) => budget._id === record.stateId);
    if (!budget?.taxRates) return record;
    const pending =
      change.scope === "federal"
        ? (budget as FederalBudget).taxRatePhaseIn?.[
            change.taxType as keyof FederalBudget["taxRates"]
          ]
        : undefined;
    return {
      ...record,
      policyOptionId: "rate:" + (pending ?? incomeTaxRate(budget.taxRates, tier)),
    };
  });
}
