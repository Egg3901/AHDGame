import { describe, expect, it } from "vitest";
import {
  BANKING_POLICY_ALL_ON,
  BANKING_POLICY_OFF,
  resolveBankingPolicy,
  savingsReadsAuthoritative,
  type BankingPolicyConfig,
} from "./policy";

describe("resolveBankingPolicy", () => {
  it("requires banking, Treasury cash accounting and explicit construction finance permission", () => {
    expect(resolveBankingPolicy({ bankConstructionFinanceEnabled: true }).constructionFinance).toBe(
      false
    );
    expect(resolveBankingPolicy({ privateBankingEnabled: true }).constructionFinance).toBe(false);
    expect(
      resolveBankingPolicy({ privateBankingEnabled: true, bankConstructionFinanceEnabled: true })
        .constructionFinance
    ).toBe(false);
    expect(
      resolveBankingPolicy({
        privateBankingEnabled: true,
        treasuryCashLedgerEnabled: true,
        bankConstructionFinanceEnabled: true,
      }).constructionFinance
    ).toBe(true);
  });
  it("enables the funded Treasury cash ledger only on an explicit true flag", () => {
    expect(resolveBankingPolicy(null).treasuryCashLedger).toBe(false);
    expect(resolveBankingPolicy({ treasuryCashLedgerEnabled: false }).treasuryCashLedger).toBe(
      false
    );
    expect(resolveBankingPolicy({ treasuryCashLedgerEnabled: true }).treasuryCashLedger).toBe(true);
  });

  it("enables Treasury holdings only explicitly with banking enabled", () => {
    expect(resolveBankingPolicy({ bankTreasuryEnabled: true }).bankTreasury).toBe(false);
    expect(resolveBankingPolicy({ privateBankingEnabled: true }).bankTreasury).toBe(false);
    expect(
      resolveBankingPolicy({ privateBankingEnabled: true, bankTreasuryEnabled: true }).bankTreasury
    ).toBe(true);
  });
  it("enables forex fees only with their explicit flag and active prop trading", () => {
    expect(resolveBankingPolicy({ bankPropForexFeesEnabled: true }).propForexFees).toBe(false);
    expect(
      resolveBankingPolicy({ privateBankingEnabled: true, bankPropForexFeesEnabled: true })
        .propForexFees
    ).toBe(true);
    expect(
      resolveBankingPolicy({
        privateBankingEnabled: true,
        bankPropForexFeesEnabled: true,
        bankPropTradingEnabled: false,
      }).propForexFees
    ).toBe(false);
  });
  it("defaults to banking off, LOC on, with a missing config document", () => {
    expect(resolveBankingPolicy(null)).toEqual({
      privateBanking: false,
      failurePolitics: false,
      constructionFinance: false,
      propTrading: false,
      propForexFees: false,
      bankTreasury: false,
      treasuryCashLedger: false,
      contagion: false,
      lineOfCredit: true,
      advancedCharters: false,
      savingsAccounts: "off",
      savingsReadCurrencies: [],
    });
    expect(resolveBankingPolicy(undefined)).toEqual(BANKING_POLICY_OFF);
  });

  it("treats prop trading and contagion as kill switches that require banking", () => {
    expect(resolveBankingPolicy({ privateBankingEnabled: true })).toEqual({
      privateBanking: true,
      failurePolitics: false,
      constructionFinance: false,
      propTrading: true,
      propForexFees: false,
      bankTreasury: false,
      treasuryCashLedger: false,
      contagion: true,
      lineOfCredit: true,
      advancedCharters: false,
      savingsAccounts: "off",
      savingsReadCurrencies: [],
    });
    expect(
      resolveBankingPolicy({
        privateBankingEnabled: false,
        bankPropTradingEnabled: true,
        bankContagionEnabled: true,
        playerAdvancedBankChartersEnabled: true,
      })
    ).toEqual(BANKING_POLICY_OFF);
    expect(
      resolveBankingPolicy({ privateBankingEnabled: true, bankPropTradingEnabled: false })
        .propTrading
    ).toBe(false);
    expect(
      resolveBankingPolicy({ privateBankingEnabled: true, bankContagionEnabled: false }).contagion
    ).toBe(false);
  });

  it("turns LOC off only on an explicit false", () => {
    expect(resolveBankingPolicy({ lineOfCreditEnabled: false }).lineOfCredit).toBe(false);
    expect(resolveBankingPolicy({ lineOfCreditEnabled: undefined }).lineOfCredit).toBe(true);
  });

  it("offers advanced charters only on an explicit true with banking on", () => {
    expect(
      resolveBankingPolicy({ privateBankingEnabled: true, playerAdvancedBankChartersEnabled: true })
        .advancedCharters
    ).toBe(true);
    expect(resolveBankingPolicy({ playerAdvancedBankChartersEnabled: true }).advancedCharters).toBe(
      false
    );
  });

  it("requires both private banking and explicit politics opt-in", () => {
    expect(resolveBankingPolicy({ bankFailurePoliticsEnabled: true }).failurePolitics).toBe(false);
    expect(
      resolveBankingPolicy({ privateBankingEnabled: true, bankFailurePoliticsEnabled: true })
        .failurePolitics
    ).toBe(true);
  });

  it("returns a frozen snapshot", () => {
    const snapshot = resolveBankingPolicy({ privateBankingEnabled: true });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(BANKING_POLICY_ALL_ON).toEqual({
      privateBanking: true,
      failurePolitics: true,
      constructionFinance: true,
      propTrading: true,
      propForexFees: true,
      bankTreasury: true,
      treasuryCashLedger: true,
      contagion: true,
      lineOfCredit: true,
      advancedCharters: true,
      savingsAccounts: "off",
      savingsReadCurrencies: [],
    });
  });

  it("carries the savings rollout stage and read cohort", () => {
    expect(resolveBankingPolicy({ savingsAccountsMode: "shadow" }).savingsAccounts).toBe("shadow");
    expect(resolveBankingPolicy({ savingsAccountsMode: "bogus" as never }).savingsAccounts).toBe(
      "off"
    );
    const live = resolveBankingPolicy({
      savingsAccountsMode: "authoritative",
      savingsAccountsReadCurrencies: ["USD"],
    });
    expect(savingsReadsAuthoritative(live, "USD")).toBe(true);
    expect(savingsReadsAuthoritative(live, "GBP")).toBe(false);
    // Read cohorts mean nothing before writes are authoritative.
    const shadow = resolveBankingPolicy({
      savingsAccountsMode: "shadow",
      savingsAccountsReadCurrencies: ["USD"],
    });
    expect(shadow.savingsReadCurrencies).toEqual([]);
    expect(savingsReadsAuthoritative(shadow, "USD")).toBe(false);
  });

  it("is a pure function of the config: same input, same snapshot, every time", () => {
    const configs: BankingPolicyConfig[] = [];
    for (const privateBankingEnabled of [true, false, undefined]) {
      for (const bankPropTradingEnabled of [true, false, undefined]) {
        for (const lineOfCreditEnabled of [true, false, undefined]) {
          configs.push({ privateBankingEnabled, bankPropTradingEnabled, lineOfCreditEnabled });
        }
      }
    }
    for (const config of configs) {
      expect(resolveBankingPolicy(config)).toEqual(resolveBankingPolicy({ ...config }));
    }
  });
});
