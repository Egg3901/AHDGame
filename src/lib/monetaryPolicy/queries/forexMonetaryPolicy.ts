/**
 * Monetary policy views list the active scenario's currencies and central banks.
 * loadForexMonetaryPolicy includes transition economies when their books exist.
 */
import { getPresetMonetaryScope } from "../presetMonetaryScope";
import type { Db } from "mongodb";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getSeedCurrencyCode } from "@/lib/constants/currencies";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import type { CentralBank, TurnSnapshot } from "@/lib/db/types";

export async function loadForexMonetaryPolicy(params: { db: Db }) {
  const { db } = params;
  const forexActive = await isForexEnabled();
  if (!forexActive) {
    return { ok: false as const, status: 403, error: "Currency exchange is not yet enabled" };
  }
  // Preset-aware labels: 2027 euro members list EUR. One route-path read.
  const preset = await getGameStatePresetOrDefault(db);
  const activeCountries = getPresetMonetaryScope(preset).forexCountries;

  const banks = await db
    .collection<CentralBank>("centralBanks")
    .find({ countryId: { $in: activeCountries } })
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
      countries: activeCountries.map((countryId) => {
        const bank = byCountry.get(countryId);
        return {
          countryId,
          currencyCode: getSeedCurrencyCode(countryId, preset),
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
