import type { Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import type {
  Bond,
  CentralBank,
  FederalBudget,
  GameConfig,
  MoneySupplySnapshot,
  OrganizationFund,
} from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { annualizedMoneyGrowthPct } from "./calculate";
import { seedMoneySupplyBaselines } from "./seed";
import { isMoneySupplyEnabledFromConfig } from "./featureFlag";
import {
  addCentralBankMoney,
  addComponent,
  addHouseholdMoneyFromDemography,
  aggregatesForCurrency,
  emptyComponents,
  governmentLiquidFromTreasury,
  homeCurrency,
  PERSONS_PER_HOUSEHOLD,
  HOUSEHOLD_LIQUID_RATIO,
  HOUSEHOLD_SAVINGS_RATIO,
  UNMODELED_EXTERNAL_SHARE,
  type MutableComponents,
} from "./assemble";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

export {
  PERSONS_PER_HOUSEHOLD,
  HOUSEHOLD_LIQUID_RATIO,
  HOUSEHOLD_SAVINGS_RATIO,
  UNMODELED_EXTERNAL_SHARE,
};

export const MONEY_SUPPLY_SNAPSHOTS_COLLECTION = "moneySupplySnapshots";

export async function snapshotMoneySupply(db: Db, turn: number): Promise<number> {
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { moneySupplyEnabled: 1 } });
  if (!isMoneySupplyEnabledFromConfig(config)) return 0;

  let banks = await db.collection<CentralBank>("centralBanks").find({}).toArray();
  if (banks.some((bank) => bank.externalBroadMoney == null)) {
    const gameState = await db
      .collection<{ _id: string; preset?: string }>("gameState")
      .findOne({ _id: "current" }, { projection: { preset: 1 } });
    await seedMoneySupplyBaselines(db, gameState?.preset ?? DEFAULT_SEED_PRESET);
    banks = await db.collection<CentralBank>("centralBanks").find({}).toArray();
  }
  const [
    characters,
    npps,
    corporations,
    parties,
    budgets,
    organizationFunds,
    bonds,
    states,
    medianIncomeDocs,
    indexFunds,
    exchangeRateRows,
    charteredBanks,
    bondPools,
    equityPools,
  ] = await Promise.all([
    db.collection("characters").find({}).toArray(),
    db
      .collection("npps")
      .find(
        {},
        { projection: { countryId: 1, funds: 1, currencyBalances: 1, nppInvestmentCashAnchor: 1 } }
      )
      .toArray(),
    // Corp-level liquidCapital is the SSOT insolvency keys on and sectorTurn
    // $inc's every turn. CorporateSector has no liquidCapital field.
    db.collection("corporations").find({}).toArray(),
    db.collection("politicalParties").find({}).toArray(),
    db.collection<FederalBudget>("federalBudget").find({}).toArray(),
    db.collection<OrganizationFund>("organizationFunds").find({}).toArray(),
    db
      .collection<Bond>("bonds")
      .find({ issuerType: "sovereign", matured: false, defaulted: false })
      .toArray(),
    db
      .collection<{ _id: string; countryId?: string; population?: number }>("states")
      .find({}, { projection: { countryId: 1, population: 1 } })
      .toArray(),
    // State-level + national-scope rows. Restricting to NATIONAL_SCOPE alone
    // left FR/IT/ES/SE/TR (and every other country without a national doc) at
    // householdLiquid = 0 even after the demography derivation landed.
    db
      .collection<{ _id: string; economic?: { medianIncome?: { value?: number } } }>("macroMetrics")
      .find({}, { projection: { "economic.medianIncome": 1 } })
      .toArray(),
    // Fund cash is ₳ (every fund leg is, since the currency SSOT fix), so it
    // converts into a native figure with the same rate table everything else
    // uses. That was the blocker on counting it at all.
    db
      .collection<{ _id: unknown; cashAnchor?: number; anchorCurrencyCode?: string }>("indexFunds")
      .find({}, { projection: { cashAnchor: 1, anchorCurrencyCode: 1 } })
      .toArray(),
    db
      .collection<{ currencyCode: string; rate: number }>("exchangeRates")
      .find({}, { projection: { currencyCode: 1, rate: 1 } })
      .toArray(),
    // Chartered private banks: their deposit books and their loan books are both
    // invisible to the aggregates otherwise.
    db
      .collection<{
        _id: unknown;
        bankCharter?: {
          status?: string;
          currency?: string;
          totalDeposits?: number;
          totalLoans?: number;
        };
      }>("corporations")
      .find(
        { "bankCharter.status": "active" },
        {
          projection: {
            "bankCharter.currency": 1,
            "bankCharter.totalDeposits": 1,
            "bankCharter.totalLoans": 1,
          },
        }
      )
      .toArray(),
    db
      .collection<{ _id: string; cashLocal?: number }>("bondMarketPools")
      .find({}, { projection: { cashLocal: 1 } })
      .toArray(),
    db
      .collection<{ _id: string; cashLocal?: number }>("equityMarketPools")
      .find({}, { projection: { cashLocal: 1 } })
      .toArray(),
  ]);
  const byCurrency = new Map<CurrencyCode, MutableComponents>();

  addCentralBankMoney(byCurrency, banks);
  addHouseholdMoneyFromDemography(byCurrency, states, medianIncomeDocs);

  for (const character of characters) {
    const country = character.countryId as CountryId;
    const currency = homeCurrency(country);
    const balances = character.currencyBalances;
    if (balances) {
      addComponent(byCurrency, currency, "campaignLiquid", balances.campaign);
      for (const [code, amount] of Object.entries(balances.personal ?? {}))
        addComponent(byCurrency, code as CurrencyCode, "householdLiquid", amount);
      for (const [code, amount] of Object.entries(balances.savings ?? {}))
        addComponent(byCurrency, code as CurrencyCode, "householdSavings", amount);
    } else {
      addComponent(byCurrency, currency, "campaignLiquid", character.funds);
      addComponent(byCurrency, currency, "householdLiquid", character.cashOnHand);
      addComponent(byCurrency, currency, "householdSavings", character.savingsOnHand);
    }
    // Player LOC book only. No economy-wide private-credit stock exists in the
    // engine today — leave the component at 0 for NPP-run worlds rather than
    // inventing one. A real source would be a per-currency loan ledger.
    for (const [code, amount] of Object.entries(character.lineOfCredit?.balances ?? {}))
      addComponent(byCurrency, code as CurrencyCode, "creditOutstanding", amount);
    for (const [code, amount] of Object.entries(character.lineOfCredit?.arrears ?? {}))
      addComponent(byCurrency, code as CurrencyCode, "creditOutstanding", amount);
  }
  for (const npp of npps) {
    const currency = homeCurrency(npp.countryId as CountryId);
    addComponent(byCurrency, currency, "nppLiquid", npp.funds);
    for (const [code, amount] of Object.entries(npp.currencyBalances?.personal ?? {}))
      addComponent(byCurrency, code as CurrencyCode, "nppLiquid", amount);
    for (const [code, amount] of Object.entries(npp.currencyBalances?.savings ?? {}))
      addComponent(byCurrency, code as CurrencyCode, "householdSavings", amount);
    addComponent(byCurrency, "USD", "nppLiquid", npp.nppInvestmentCashAnchor);
  }
  for (const corp of corporations)
    addComponent(
      byCurrency,
      (corp.liquidCurrencyCode ?? homeCurrency(corp.countryId as CountryId)) as CurrencyCode,
      "corporateLiquid",
      corp.liquidCapital
    );
  for (const party of parties)
    addComponent(
      byCurrency,
      homeCurrency(party.countryId as CountryId),
      "partyLiquid",
      party.treasury
    );
  for (const budget of budgets)
    addComponent(
      byCurrency,
      (budget.currencyCode ?? homeCurrency(budget.countryId as CountryId)) as CurrencyCode,
      "governmentLiquid",
      governmentLiquidFromTreasury(budget.treasuryBalance)
    );
  // Fund cash is ₳ and the rate table is local-per-₳, so cashAnchor × rate is
  // the native figure. This used to be left at 0 because the equity leg of a
  // fund was denominated inconsistently; with one unit across every fund leg
  // the conversion is well defined and the cash is real money that moves.
  const rateByCurrency = new Map<string, number>(
    exchangeRateRows
      .filter((r) => Number.isFinite(r.rate) && r.rate > 0)
      .map((r) => [r.currencyCode, r.rate])
  );
  for (const fund of indexFunds) {
    const currency = (fund.anchorCurrencyCode ?? "USD") as CurrencyCode;
    const rate = rateByCurrency.get(currency) ?? 1;
    addComponent(byCurrency, currency, "fundLiquid", (fund.cashAnchor ?? 0) * rate);
  }

  // Private-bank books. Capturing an NPC deposit debits externalBroadMoney and
  // credits the bank, so counting only the debit made measured M2 shrink as
  // private banking grew. Loans join the credit stock for the same reason: the
  // component was player LOC only.
  for (const bank of charteredBanks) {
    const charter = bank.bankCharter;
    if (!charter?.currency) continue;
    const currency = charter.currency as CurrencyCode;
    addComponent(byCurrency, currency, "bankDeposits", charter.totalDeposits ?? 0);
    addComponent(byCurrency, currency, "creditOutstanding", charter.totalLoans ?? 0);
  }

  // organizationFunds.balanceLocal IS native — include it.
  for (const fund of organizationFunds)
    addComponent(
      byCurrency,
      homeCurrency(fund.currencyCountryId),
      "organizationLiquid",
      fund.balanceLocal
    );
  for (const pool of bondPools)
    addComponent(byCurrency, pool._id as CurrencyCode, "bondPoolCash", pool.cashLocal ?? 0);
  for (const pool of equityPools)
    addComponent(byCurrency, pool._id as CurrencyCode, "equityPoolCash", pool.cashLocal ?? 0);
  for (const bond of bonds) {
    const currency = (bond.currencyCode ?? homeCurrency(bond.countryId!)) as CurrencyCode;
    addComponent(byCurrency, currency, "sovereignBondsOutstanding", bond.totalIssued);
    addComponent(
      byCurrency,
      currency,
      "centralBankBondHoldings",
      (bond.centralBankHoldings ?? 0) * BOND_UNIT_FACE_VALUE
    );
  }

  const now = new Date();
  let written = 0;

  // Writes one moneySupplySnapshot row for a currency, reading whatever this
  // turn's byCurrency pass already accumulated for it (household/government/
  // corporate/NPP/party components are keyed by currency and populated above
  // regardless of central-bank existence — only the write itself was ever
  // gated on having a bank doc).
  async function writeSnapshot(
    countryId: CountryId,
    bankId: string,
    netMoneyCreatedLifetime: number
  ): Promise<void> {
    const currencyCode = homeCurrency(countryId);
    const aggregates = aggregatesForCurrency(byCurrency, currencyCode);
    const prior = await db
      .collection<MoneySupplySnapshot>(MONEY_SUPPLY_SNAPSHOTS_COLLECTION)
      .findOne({ currencyCode, turn: { $lte: Math.max(0, turn - 12) } }, { sort: { turn: -1 } });
    const doc: MoneySupplySnapshot = {
      _id: `${turn}:${currencyCode}`,
      turn,
      countryId,
      bankId,
      currencyCode,
      ...aggregates,
      // null when no prior or the lookback window is shorter than a game-quarter
      // (see MIN_MONEY_GROWTH_BASE_TURNS). inflationRecalc's finiteOr then falls
      // back to gdpGrowth → zero monetary impulse, rather than annualizing a
      // bootstrap stock jump into 10^8 %+ readings that pin the inflation clamp.
      annualizedM2GrowthPct: prior
        ? annualizedMoneyGrowthPct(prior.m2, aggregates.m2, turn - prior.turn)
        : null,
      netMoneyCreatedLifetime,
      createdAt: now,
    };
    await db
      .collection<MoneySupplySnapshot>(MONEY_SUPPLY_SNAPSHOTS_COLLECTION)
      .replaceOne({ _id: doc._id }, doc, { upsert: true });
    written++;
  }

  for (const bank of banks) {
    await writeSnapshot(bank.countryId, bank._id, bank.netMoneyCreatedLifetime ?? 0);
  }

  // Countries with no central bank (Warsaw Pact / non-aligned command
  // economies excluded from FOREX_ACTIVE_COUNTRIES — see updateCentralBanks
  // in src/lib/currency/migration.ts) still accumulate real money-supply
  // components above: household money from demography, government liquid
  // from federalBudget.treasuryBalance, NPP/party liquid, all keyed by their
  // OWN currency. But this write loop iterated `banks` alone, so those
  // currencies' aggregates were computed and then silently discarded every
  // turn — every one of these countries had zero moneySupplySnapshot rows
  // for the entire run. This is the same shape as the bug already fixed in
  // inflationRecalc.ts's "unbanked" pass (PL/HU/CS/RO/BG/YU). UKR/BLR/BAL do NOT
  // need an entry here: they are on the Soviet ruble, and RU's central bank
  // already writes the SUR aggregate, so the currency guard below skips them
  // correctly rather than by accident. A command
  // economy genuinely has no central-bank monetary policy to model — that's
  // real (`monetaryOverhang`/`blackMarketPremium` on FederalBudget model
  // exactly this) — but "no central bank" must not mean "no money-supply
  // record". The synthetic bankId (the country's own id) and
  // netMoneyCreatedLifetime: 0 reflect that there is no CB operations ledger
  // behind these currencies.
  const bankedCountryIds = new Set(banks.map((bank) => bank.countryId));
  const writtenCurrencies = new Set(banks.map((bank) => homeCurrency(bank.countryId)));
  for (const budget of budgets) {
    const countryId = budget.countryId as CountryId | undefined;
    if (!countryId || bankedCountryIds.has(countryId)) continue;
    const currencyCode = homeCurrency(countryId);
    if (writtenCurrencies.has(currencyCode)) continue;
    writtenCurrencies.add(currencyCode);
    await writeSnapshot(countryId, countryId, 0);
  }

  return written;
}

/** @internal test helper — empty component row */
export { emptyComponents };
