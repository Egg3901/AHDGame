import { ObjectId, type AnyBulkWriteOperation, type Db, type Filter } from "mongodb";
import type { Bill, TariffProvision } from "@/lib/db/types";
import type { FederalBudget, Tariff } from "@/lib/db/types";
import { applyTariffProvision, tariffProvisionFilter } from "@/lib/tariffs/tariffEffects";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";

const BASELINE_TARIFF_COUNTRIES = [
  COUNTRY_CONFIGS.US.id,
  COUNTRY_CONFIGS.UK.id,
  COUNTRY_CONFIGS.JP.id,
  COUNTRY_CONFIGS.DE.id,
] as const satisfies readonly CountryId[];

type BaselineTariffCountryId = "US" | "UK" | "JP" | "DE";

const BASELINE_TARIFF_SOURCE_BILL_IDS: Record<BaselineTariffCountryId, ObjectId> = {
  US: new ObjectId("680bfd000000000000000001"),
  UK: new ObjectId("680bfd000000000000000002"),
  JP: new ObjectId("680bfd000000000000000003"),
  DE: new ObjectId("680bfd000000000000000004"),
};

function hasTariffProvision(bill: Pick<Bill, "provisions">): boolean {
  return bill.provisions?.some((provision) => provision.type === "tariff") ?? false;
}

async function ensureBaselineEconomyWideTariffs(db: Db, countryId?: CountryId): Promise<void> {
  const countries = countryId ? [countryId] : [...BASELINE_TARIFF_COUNTRIES];

  for (const candidateCountryId of countries) {
    if (!BASELINE_TARIFF_COUNTRIES.includes(candidateCountryId)) continue;
    const baselineCountryId = candidateCountryId as BaselineTariffCountryId;

    const existingTariff = await db.collection<Tariff>("tariffs").findOne({
      countryId: baselineCountryId,
      scopeType: "economy_wide",
    });
    if (existingTariff) continue;

    const budget = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: getNationalBudgetId(baselineCountryId) });
    const rate = budget?.taxRates?.tariffs;
    if (typeof rate !== "number") continue;

    const now = new Date();
    await db.collection<Tariff>("tariffs").updateOne(
      {
        countryId: baselineCountryId,
        scopeType: "economy_wide",
      } as Record<string, unknown>,
      {
        $set: {
          rate,
          sourceBillId: BASELINE_TARIFF_SOURCE_BILL_IDS[baselineCountryId],
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );
  }
}

/**
 * Replays signed tariff bills into the tariffs collection in enactment order.
 * Non-economy scopes only update tariff documents, so they can share one
 * ordered bulk command. Economy-wide scopes still use applyTariffProvision to
 * heal the federal budget's headline rate when it is out of sync.
 *
 * A crash between ordered bulk operations can leave only an enactment-order
 * prefix applied. Crash recovery skips the interrupted corporationTurn phase,
 * so the next scheduled reconciliation repairs that partial state rather
 * than the current turn's resume. Replaying signed bills sets final rates and
 * source bills without double-applying them; the budget sync is also a value
 * repair. Keep this recovery window in mind if this work moves between phases.
 */
export async function reconcileSignedTariffBills(db: Db, countryId?: CountryId): Promise<void> {
  // Reset/bootstrap seeds the baseline tariff rate into federal budgets, but not all
  // historical worlds have a matching economy-wide tariff doc yet. Create that
  // baseline layer first so turn processing and policy pages both see the same
  // default trade regime, then replay signed tariff bills over the top of it.
  await ensureBaselineEconomyWideTariffs(db, countryId);

  const query: Record<string, unknown> = {
    status: "signed",
    provisions: { $elemMatch: { type: "tariff" } },
  };
  if (countryId) {
    query.countryId = countryId;
  }

  const signedBills = await db
    .collection<Bill>("bills")
    .find(query)
    .sort({ enactedAt: 1, updatedAt: 1, _id: 1 })
    .toArray();

  const pending: AnyBulkWriteOperation<Tariff>[] = [];
  const flush = async () => {
    if (pending.length === 0) return;
    const operations = pending.splice(0);
    await db.collection<Tariff>("tariffs").bulkWrite(operations, { ordered: true });
  };

  for (const bill of signedBills) {
    if (!bill.countryId || !hasTariffProvision(bill)) continue;
    for (const provision of bill.provisions ?? []) {
      if (provision.type !== "tariff") continue;
      const tariffProvision = provision as TariffProvision;
      if (tariffProvision.scopeType === "economy_wide") {
        await flush();
        await applyTariffProvision(db, bill.countryId, tariffProvision, bill._id);
        continue;
      }
      // Reconciliation discards rateChanged and must not fire enactment pulses.
      // Ordered writes preserve the last signed bill for each scope.
      const now = new Date();
      pending.push({
        updateOne: {
          filter: tariffProvisionFilter(bill.countryId, tariffProvision) as Filter<Tariff>,
          update: {
            $set: { rate: tariffProvision.rate, sourceBillId: bill._id, updatedAt: now },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      });
    }
  }
  await flush();
}
