import type { Db } from "mongodb";
import type { CentralBank, FederalBudget } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { broadMoneyToGdpRatio } from "@/lib/seeds/reference/moneySupply";

export async function seedMoneySupplyBaselines(db: Db, preset: string): Promise<void> {
  const banks = await db.collection<CentralBank>("centralBanks").find({}).toArray();
  for (const bank of banks) {
    const budget = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: getNationalBudgetId(bank.countryId) } as { _id: "federal" });
    const gdp = Math.max(0, budget?.gdp ?? 0);
    const externalBroadMoney = Math.round(
      gdp * broadMoneyToGdpRatio(preset, bank.countryId as CountryId)
    );
    await db.collection<CentralBank>("centralBanks").updateOne(
      { _id: bank._id, externalBroadMoney: { $exists: false } },
      {
        $set: {
          externalBroadMoney,
          netMoneyCreatedLifetime: 0,
          monetaryOperations: [],
          updatedAt: new Date(),
        },
      }
    );
  }
  await db
    .collection("moneySupplySnapshots")
    .createIndex({ currencyCode: 1, turn: -1 }, { background: true });
}
