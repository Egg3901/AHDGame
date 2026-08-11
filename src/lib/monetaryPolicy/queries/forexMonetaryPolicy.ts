import type { Db } from "mongodb";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { COUNTRY_CURRENCY_MAP, FOREX_ACTIVE_COUNTRIES } from "@/lib/constants/currencies";
import type { CentralBank, TurnSnapshot } from "@/lib/db/types";

export async function loadForexMonetaryPolicy(params: { db: Db }) {
  const { db } = params;
  const forexActive = await isForexEnabled();
  if (!forexActive) {
    return { ok: false as const, status: 403, error: "Currency exchange is not yet enabled" };
  }

  const banks = await db
    .collection<CentralBank>("centralBanks")
    .find({ countryId: { $in: FOREX_ACTIVE_COUNTRIES } })
    .project({
      countryId: 1,
      primeRate: 1,
      interestRateHistory: 1,
      inflationHistory: 1,
      gdpGrowthHistory: 1,
    })
    .toArray();

  const byCountry = new Map(banks.map((bank) => [bank.countryId, bank]));
  return {
    ok: true as const,
    body: {
      countries: FOREX_ACTIVE_COUNTRIES.map((countryId) => {
        const bank = byCountry.get(countryId);
        return {
          countryId,
          currencyCode: COUNTRY_CURRENCY_MAP[countryId],
          primeRate: bank?.primeRate ?? null,
          interestRateHistory: (bank?.interestRateHistory ?? []).map((snapshot: TurnSnapshot) => ({
            turn: snapshot.turn,
            value: snapshot.rate,
          })),
          inflationHistory: (bank?.inflationHistory ?? []).map((snapshot: TurnSnapshot) => ({
            turn: snapshot.turn,
            value: snapshot.rate,
          })),
          gdpGrowthHistory: (bank?.gdpGrowthHistory ?? []).map((snapshot: TurnSnapshot) => ({
            turn: snapshot.turn,
            value: snapshot.rate,
          })),
        };
      }),
    },
  };
}
