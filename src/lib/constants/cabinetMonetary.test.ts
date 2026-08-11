import { describe, it, expect } from "vitest";
import {
  DEBT_OP_DURATION_TURNS,
  DEBT_OP_CONFIDENCE_BOOST_PER_TURN,
  DEBT_OP_COOLDOWN_TURNS,
  resolveFinancePosition,
} from "./cabinetMonetary";
import { INVESTOR_CONFIDENCE_BASELINE } from "@/lib/nationalization/constants";

describe("cabinetMonetary constants", () => {
  it("durations and boost are positive and sane", () => {
    expect(DEBT_OP_DURATION_TURNS).toBeGreaterThan(0);
    expect(DEBT_OP_COOLDOWN_TURNS).toBeGreaterThan(0);
    expect(DEBT_OP_CONFIDENCE_BOOST_PER_TURN).toBeGreaterThan(0);
  });

  it("a full window's boost cannot exceed the whole 0..baseline band", () => {
    // Sanity: even a from-zero op should not be able to over-shoot the band in one window.
    expect(DEBT_OP_DURATION_TURNS * DEBT_OP_CONFIDENCE_BOOST_PER_TURN).toBeLessThanOrEqual(
      INVESTOR_CONFIDENCE_BASELINE
    );
  });
});

describe("resolveFinancePosition", () => {
  it("maps each country's configured finance seat", () => {
    expect(resolveFinancePosition("US")).toBe("secretary_of_treasury");
    expect(resolveFinancePosition("UK")).toBe("chancellor");
    expect(resolveFinancePosition("IE")).toBe("minister_for_finance");
  });
  it("returns null for an unknown country", () => {
    expect(resolveFinancePosition("ZZ")).toBeNull();
  });
});
