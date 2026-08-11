import { describe, expect, it } from "vitest";
import { isMoneySupplyEnabledFromConfig } from "./featureFlag";

describe("money-supply rollout gate", () => {
  it("is enabled only by an explicit true value", () => {
    expect(isMoneySupplyEnabledFromConfig({ moneySupplyEnabled: true })).toBe(true);
    expect(isMoneySupplyEnabledFromConfig({ moneySupplyEnabled: false })).toBe(false);
    expect(isMoneySupplyEnabledFromConfig({})).toBe(false);
    expect(isMoneySupplyEnabledFromConfig(null)).toBe(false);
  });
});
