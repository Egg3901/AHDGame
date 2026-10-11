import { describe, it, expect } from "vitest";
import {
  forecastIndependenceDesire,
  computeIndependenceDesireDriftSnapshot as step,
  hasInitialWestminsterChange,
  westminsterStanceCooldownRemaining,
} from "./rules";
const inputs = {
  previous: 35,
  policy: "independence" as const,
  westminsterPolicy: "pro" as const,
  regionalApproval: 70,
  nationalApproval: 50,
  inflationPercent: 3,
};
describe("conditional Desire forecasts", () => {
  it("matches repeated turn calculations, including the exact first turn at 60", () => {
    const forecast = forecastIndependenceDesire(inputs);
    expect(forecast.annualChange).toBe(4.176);
    let previous = inputs.previous;
    for (let turn = 1; turn <= forecast.turnsToThreshold!; turn++) {
      previous = step({ ...inputs, previous }).next;
      expect(previous >= 60).toBe(turn === forecast.turnsToThreshold);
    }
  });
  it("accounts for bounds and an already met threshold", () => {
    const forecast = forecastIndependenceDesire({ ...inputs, previous: 99.99 });
    expect(forecast.annualChange).toBe(0.01);
    expect(forecast.turnsToThreshold).toBe(0);
  });
  it("does not promise a threshold when baseline recovery stops below it", () => {
    expect(
      forecastIndependenceDesire({ ...inputs, previous: 24.999, policy: "pro" }).turnsToThreshold
    ).toBeNull();
    expect(forecastIndependenceDesire({ ...inputs, policy: "anti" }).annualChange).toBeLessThan(0);
  });
});
describe("incoming government allowance", () => {
  const args = {
    changedAtTurn: 99,
    currentTurn: 100,
    changedUnderGovernment: "old",
    government: { key: "new", formedTurn: 100 },
  };
  it("bypasses inherited cooldowns once, including same-turn succession", () => {
    expect(hasInitialWestminsterChange(args)).toBe(true);
    expect(westminsterStanceCooldownRemaining(args)).toBe(0);
    expect(westminsterStanceCooldownRemaining({ ...args, changedAtTurn: 100 })).toBe(0);
    expect(
      westminsterStanceCooldownRemaining({
        ...args,
        changedAtTurn: 100,
        changedUnderGovernment: "new",
      })
    ).toBe(72);
  });
  it("keeps old saves conservative and does not grant allowances to missing governments", () => {
    expect(hasInitialWestminsterChange({ ...args, changedUnderGovernment: undefined })).toBe(true);
    expect(
      hasInitialWestminsterChange({
        ...args,
        changedUnderGovernment: undefined,
        changedAtTurn: 100,
      })
    ).toBe(false);
    expect(westminsterStanceCooldownRemaining({ ...args, government: null })).toBe(71);
  });
});
