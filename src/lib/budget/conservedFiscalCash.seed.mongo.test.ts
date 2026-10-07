/** The financing payer must already exist in the real 1991 monetary seed. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  REAL_MONGO_ENABLED,
  startIsolatedMongod,
  stopIsolatedMongod,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";
import { getInitialNationalBudgetsForPreset } from "@/lib/seeds/reference/budgets";
import { seedExchangeRates, updateCentralBanks } from "@/lib/currency/migration";
import { seedMoneySupplyBaselines } from "@/lib/moneySupply/seed";
import { getPresetMonetaryScope } from "@/lib/monetaryPolicy/presetMonetaryScope";
import { householdMoneyBankId } from "./conservedFiscalCash";

describe.runIf(REAL_MONGO_ENABLED)("1991 conserved financing seed ownership", () => {
  let fixture: IsolatedMongod | null = null;
  beforeAll(async () => {
    fixture = await startIsolatedMongod("ahd-financing-seed-");
  }, 60_000);
  afterAll(async () => {
    await stopIsolatedMongod(fixture);
  });

  it("resolves all 23 fiscal currencies to one existing funded payer without reseeding cash", async () => {
    const db = fixture!.db;
    const preset = "1991-default";
    const budgets = getInitialNationalBudgetsForPreset(preset);
    expect(budgets).toHaveLength(23);
    await db.collection("federalBudget").insertMany(budgets as never[]);
    await seedExchangeRates(db, preset);
    await updateCentralBanks(db, preset);
    await seedMoneySupplyBaselines(db, preset);

    const banks = db.collection<{ _id: string; countryId: string; externalBroadMoney: number }>(
      "centralBanks"
    );
    const seeded = await banks.find({}).toArray();
    expect(seeded).toHaveLength(getPresetMonetaryScope(preset).centralBankCountries.length);
    const used = new Set<string>();
    for (const budget of budgets) {
      expect(typeof budget.currencyCode).toBe("string");
      const id = householdMoneyBankId(budget.currencyCode!);
      const matches = seeded.filter((bank) => bank._id === id);
      expect(matches, `${budget.countryId}/${budget.currencyCode}`).toHaveLength(1);
      expect(Number.isFinite(matches[0].externalBroadMoney)).toBe(true);
      expect(matches[0].externalBroadMoney).toBeGreaterThan(0);
      used.add(id);
    }
    expect(used.size).toBe(23);

    await banks.updateOne({ _id: "US" }, { $inc: { externalBroadMoney: -123 } });
    const balances = await banks.find({}).sort({ _id: 1 }).toArray();
    await seedMoneySupplyBaselines(db, preset);
    expect(await banks.find({}).sort({ _id: 1 }).toArray()).toEqual(balances);
  }, 60_000);
});
