import { describe, it, expect } from "vitest";
import {
  computeLocScheduledPaymentFace,
  computeLocInterestForTurn,
  LOC_IO_SURCHARGE_PERCENT_POINTS,
  LOC_PAYMENT_MODE_COOLDOWN_TURNS,
  LOC_PER_TURN_PAYMENT_RATE,
} from "./locMath";

describe("computeLocScheduledPaymentFace", () => {
  it("P/I mode: schedules LOC_PER_TURN_PAYMENT_RATE × (principal + arrears)", () => {
    const out = computeLocScheduledPaymentFace("pi", 1000, 50);
    expect(out).toBeCloseTo(1050 * LOC_PER_TURN_PAYMENT_RATE, 10);
  });

  it("I/O mode: schedules exactly arrears (which already includes accrued interest)", () => {
    const out = computeLocScheduledPaymentFace("io", 1000, 7.5);
    expect(out).toBe(7.5);
  });

  it("I/O mode: zero arrears → zero scheduled payment (principal stays untouched)", () => {
    const out = computeLocScheduledPaymentFace("io", 1000, 0);
    expect(out).toBe(0);
  });

  it("clamps negative inputs to 0", () => {
    expect(computeLocScheduledPaymentFace("pi", -50, -10)).toBe(0);
    expect(computeLocScheduledPaymentFace("io", 1000, -5)).toBe(0);
  });
});

describe("I/O surcharge integration with computeLocInterestForTurn", () => {
  it("I/O effective rate = prime + spread + 2pp", () => {
    const principal = 10_000;
    const arrears = 0;
    const prime = 5.0;
    const spread = 3.0;
    const piInt = computeLocInterestForTurn(principal, arrears, prime, spread, "USD");
    const ioInt = computeLocInterestForTurn(
      principal,
      arrears,
      prime,
      spread + LOC_IO_SURCHARGE_PERCENT_POINTS,
      "USD"
    );
    expect(ioInt).toBeGreaterThan(piInt);
    expect(ioInt).toBe(computeLocInterestForTurn(principal, arrears, prime, spread + 2.0, "USD"));
  });
});

describe("LOC_PAYMENT_MODE_COOLDOWN_TURNS", () => {
  it("is 24", () => {
    expect(LOC_PAYMENT_MODE_COOLDOWN_TURNS).toBe(24);
  });
});
