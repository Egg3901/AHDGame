/**
 * Initial money supply uses a country's authored GDP basis and fixed currency
 * denomination. seedMoneySupplyBaselines initializes only missing balances;
 * it never rewrites an existing monetary stock or its issuance history.
 */
import type { Db } from "mongodb";
import type { CentralBank, FederalBudget } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { broadMoneyToGdpRatio } from "@/lib/seeds/reference/moneySupply";
import { campaignLocalRate, loadCampaignCurrencyRates } from "@/lib/campaigns/campaignCurrency";
import { getGdpAnchorRate } from "@/lib/currency/gdpAnchorRate";
import { seedExternalBroadMoney } from "./rules/seed";

export async function seedMoneySupplyBaselines(db: Db, preset: string): Promise<void> {
  const banks = await db
    .collection<CentralBank>("centralBanks")
    .find({ externalBroadMoney: { $exists: false } }, { projection: { countryId: 1 } })
    .toArray();
  if (banks.length > 0) {
    const [budgets, rates] = await Promise.all([
      db
        .collection<FederalBudget>("federalBudget")
        .find(
          { _id: { $in: banks.map((bank) => getNationalBudgetId(bank.countryId)) } },
          { projection: { gdp: 1 } }
        )
        .toArray(),
      loadCampaignCurrencyRates(db),
    ]);
    const gdpById = new Map(budgets.map((budget) => [budget._id, budget.gdp]));
    const now = new Date();
    await db.collection<CentralBank>("centralBanks").bulkWrite(
      banks.map((bank) => ({
        updateOne: {
          filter: { _id: bank._id, externalBroadMoney: { $exists: false } },
          update: {
            $set: {
              externalBroadMoney: seedExternalBroadMoney({
                storedGdp: Math.max(0, gdpById.get(getNationalBudgetId(bank.countryId)) ?? 0),
                anchorPerGdpUnit: getGdpAnchorRate(bank.countryId, preset),
                localPerAnchor: campaignLocalRate(bank.countryId, rates),
                broadMoneyToGdp: broadMoneyToGdpRatio(preset, bank.countryId as CountryId),
              }),
              netMoneyCreatedLifetime: 0,
              monetaryOperations: [],
              updatedAt: now,
            },
          },
        },
      }))
    );
  }
  await db
    .collection("moneySupplySnapshots")
    .createIndex({ currencyCode: 1, turn: -1 }, { background: true });
}
