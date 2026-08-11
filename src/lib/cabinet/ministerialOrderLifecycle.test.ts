import { describe, expect, it } from "vitest";
import {
  computeMinisterialOrderExpiresTurn,
  isMinisterialOrderActive,
  resolveMinisterialOrderExpiresTurn,
} from "./ministerialOrderLifecycle";

describe("ministerialOrderLifecycle", () => {
  it("computeMinisterialOrderExpiresTurn adds duration to issued turn", () => {
    expect(computeMinisterialOrderExpiresTurn(100, 24)).toBe(124);
  });

  it("resolveMinisterialOrderExpiresTurn prefers stored duration over expiresTurn", () => {
    expect(
      resolveMinisterialOrderExpiresTurn({
        issuedTurn: 100,
        duration: 24,
        expiresTurn: 999,
      })
    ).toBe(124);
  });

  it("resolveMinisterialOrderExpiresTurn coerces string expiresTurn", () => {
    expect(
      resolveMinisterialOrderExpiresTurn({
        issuedTurn: 100,
        expiresTurn: "124" as unknown as number,
      })
    ).toBe(124);
  });

  it("isMinisterialOrderActive is false once currentTurn reaches expiresTurn", () => {
    const order = {
      active: true,
      issuedTurn: 100,
      duration: 24,
      expiresTurn: 124,
    };
    expect(isMinisterialOrderActive(order, 123)).toBe(true);
    expect(isMinisterialOrderActive(order, 124)).toBe(false);
    expect(isMinisterialOrderActive(order, 148)).toBe(false);
  });

  it("isMinisterialOrderActive ignores active flag when past expiry", () => {
    expect(
      isMinisterialOrderActive(
        { active: true, issuedTurn: 100, duration: 24, expiresTurn: 124 },
        200
      )
    ).toBe(false);
  });
});
