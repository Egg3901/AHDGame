import { describe, expect, it } from "vitest";
import {
  BANKING_POLICY_ALL_ON,
  BANKING_POLICY_OFF,
  resolveBankingPolicy,
  type BankingPolicyConfig,
} from "./policy";

describe("resolveBankingPolicy", () => {
  it("defaults to banking off, LOC on, with a missing config document", () => {
    expect(resolveBankingPolicy(null)).toEqual({
      privateBanking: false,
      propTrading: false,
      contagion: false,
      lineOfCredit: true,
      advancedCharters: false,
    });
    expect(resolveBankingPolicy(undefined)).toEqual(BANKING_POLICY_OFF);
  });

  it("treats prop trading and contagion as kill switches that require banking", () => {
    expect(resolveBankingPolicy({ privateBankingEnabled: true })).toEqual({
      privateBanking: true,
      propTrading: true,
      contagion: true,
      lineOfCredit: true,
      advancedCharters: false,
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

  it("returns a frozen snapshot", () => {
    const snapshot = resolveBankingPolicy({ privateBankingEnabled: true });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(BANKING_POLICY_ALL_ON).toEqual({
      privateBanking: true,
      propTrading: true,
      contagion: true,
      lineOfCredit: true,
      advancedCharters: true,
    });
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
