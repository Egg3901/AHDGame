import { ObjectId, type Db } from "mongodb";
import type { Bill, TariffProvision } from "@/lib/db/types";
import type { FederalBudget, Tariff } from "@/lib/db/types";
import { applyTariffProvision } from "@/lib/tariffs/tariffEffects";
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
 * This is intentionally idempotent: applyTariffProvision upserts by scope, so
 * later laws overwrite earlier ones exactly the way repeated enactment would.
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

  for (const bill of signedBills) {
    if (!bill.countryId || !hasTariffProvision(bill)) continue;
    for (const provision of bill.provisions ?? []) {
      if (provision.type !== "tariff") continue;
      // Reconcile is a pure data rebuild — discard the `rateChanged` signal
      // intentionally. Sentiment pulses are a side effect of the bill-enactment
      // path (`legislationEffects.applyLegislationEffect`); replaying signed
      // bills here must NOT fire them, otherwise every GET /api/tariffs would
      // deposit a fresh pulse pair per signed sector tariff.
      await applyTariffProvision(db, bill.countryId, provision as TariffProvision, bill._id);
    }
  }
}
