import { describe, expect, it } from "vitest";
import {
  CATEGORY_LEAN_AXIS,
  TIER3_LEAN_SPREAD,
  countryLeanFromParties,
  leanAdjustedTier3,
  type LeanPartySeed,
} from "./countryLean";

const party = (
  economicPosition: number,
  socialPosition: number,
  treasury = 0,
  validForPresets?: string[]
): LeanPartySeed => ({ economicPosition, socialPosition, treasury, validForPresets });

describe("countryLeanFromParties", () => {
  it("returns null when no party is valid for the preset", () => {
    expect(countryLeanFromParties([party(-4, 2, 700_000, ["1979-default"])], "1953-default")).toBe(
      null
    );
    expect(countryLeanFromParties([], "1953-default")).toBe(null);
  });

  it("keeps preset-agnostic parties (no validForPresets) at every preset", () => {
    const lean = countryLeanFromParties([party(2, -2, 1_000)], "1953-default");
    expect(lean).toEqual({ economic: 2, social: -2 });
  });

  it("filters by preset, so an era's regime is read from that era's roster", () => {
    // The whole reason this is preset-gated: Hungary's 1953 MDP and its 1979
    // MSZMP successor are different parties with different positions, and a
    // 1953 board must not be coloured by a party that did not exist yet.
    const parties = [
      party(-4, 2, 700_000, ["1953-default"]),
      party(-3, 1, 700_000, ["1979-default"]),
    ];
    expect(countryLeanFromParties(parties, "1953-default")).toEqual({ economic: -4, social: 2 });
    expect(countryLeanFromParties(parties, "1979-default")).toEqual({ economic: -3, social: 1 });
  });

  it("weights by treasury, so token parties cannot outvote a dominant one", () => {
    // Modelled on CN 1953: the CCP plus two CPPCC bloc parties. Equal weighting
    // reads Maoist China as barely left of centre; treasury weighting does not.
    const lean = countryLeanFromParties(
      [party(-3, 2, 2_000_000), party(-1, 0, 200_000), party(1, 0, 200_000)],
      "1953-default"
    )!;
    expect(lean.economic).toBeCloseTo(-2.5, 6);
    expect(lean.social).toBeCloseTo(1.667, 3);
    // Equal weighting would have produced -1.0 — materially different.
    expect(lean.economic).toBeLessThan(-2);
  });

  it("falls back to equal weighting when every treasury is zero", () => {
    // NG seeds all parties at zero treasury; a naive weighted mean divides by
    // zero and produces NaN, which would silently poison the whole board.
    const lean = countryLeanFromParties([party(-1, -1), party(1, 0), party(1, 3)], "1953-default")!;
    expect(lean.economic).toBeCloseTo(1 / 3, 6);
    expect(lean.social).toBeCloseTo(2 / 3, 6);
  });

  it("ignores negative treasury rather than letting it flip a weight", () => {
    const lean = countryLeanFromParties(
      [party(-4, 2, 1_000), party(4, -2, -9_999)],
      "1953-default"
    )!;
    expect(lean).toEqual({ economic: -4, social: 2 });
  });

  it("skips parties with a non-finite position instead of poisoning the mean", () => {
    const broken = { economicPosition: Number.NaN, socialPosition: 1, treasury: 1_000 };
    const lean = countryLeanFromParties([broken, party(2, 2, 1_000)], "1953-default")!;
    expect(Number.isFinite(lean.economic)).toBe(true);
    expect(lean.economic).toBe(2);
  });
});

describe("CATEGORY_LEAN_AXIS", () => {
  it("assigns every political category to an axis", () => {
    const categories = Object.keys(CATEGORY_LEAN_AXIS);
    expect(categories).toHaveLength(9);
    for (const axis of Object.values(CATEGORY_LEAN_AXIS)) {
      expect(["economic", "social"]).toContain(axis);
    }
  });

  it("routes provision categories to the economic axis and liberty ones to social", () => {
    expect(CATEGORY_LEAN_AXIS.economy).toBe("economic");
    expect(CATEGORY_LEAN_AXIS.health).toBe("economic");
    expect(CATEGORY_LEAN_AXIS.education).toBe("economic");
    expect(CATEGORY_LEAN_AXIS.order).toBe("social");
    expect(CATEGORY_LEAN_AXIS.governance).toBe("social");
    expect(CATEGORY_LEAN_AXIS.society).toBe("social");
  });
});

describe("leanAdjustedTier3", () => {
  const CENTRIST = { economic: 0, social: 0 };
  const HARD_LEFT = { economic: -5, social: 0 };
  const AUTHORITARIAN = { economic: 0, social: 5 };

  it("is a no-op for a perfectly centrist country — the conservative default", () => {
    // Where the party system carries no ideological tilt there is no signal to
    // spread with, so the family must keep the legacy category average exactly.
    expect(leanAdjustedTier3(60, "order.deterrence", CENTRIST)).toBe(60);
    expect(leanAdjustedTier3(60, "order.dueProcess", CENTRIST)).toBe(60);
  });

  it("is a no-op for a lean-0 family regardless of country lean", () => {
    expect(leanAdjustedTier3(60, "order.safety", HARD_LEFT)).toBe(60);
  });

  it("separates ideological opposites that previously read identically", () => {
    // The defect this exists to fix: order.dueProcess (-5) and order.deterrence
    // (+5) both used to resolve to the raw category average.
    const due = leanAdjustedTier3(60, "order.dueProcess", AUTHORITARIAN);
    const deter = leanAdjustedTier3(60, "order.deterrence", AUTHORITARIAN);
    expect(deter).toBeGreaterThan(due);
    // A socially authoritarian regime invests in deterrence, not due process.
    expect(deter).toBeGreaterThan(60);
    expect(due).toBeLessThan(60);
  });

  it("raises left-leaning families in a left-leaning country", () => {
    // education.teacherCorps is lean -3 on the economic axis.
    expect(leanAdjustedTier3(50, "education.teacherCorps", HARD_LEFT)).toBeGreaterThan(50);
    // education.choice is lean +5 — private provision, which a command economy
    // does not build.
    expect(leanAdjustedTier3(50, "education.choice", HARD_LEFT)).toBeLessThan(50);
  });

  it("reads each category on its own axis", () => {
    // A country that is hard-left economically but centrist socially must move
    // economy families and leave order families alone.
    expect(leanAdjustedTier3(50, "education.choice", HARD_LEFT)).not.toBe(50);
    expect(leanAdjustedTier3(50, "order.deterrence", HARD_LEFT)).toBe(50);
  });

  it("never displaces further than the spread constant", () => {
    const max = leanAdjustedTier3(50, "order.deterrence", { economic: 0, social: 5 });
    expect(max - 50).toBeCloseTo(TIER3_LEAN_SPREAD, 6);
  });

  it("clamps into the 0-100 board range", () => {
    expect(leanAdjustedTier3(98, "order.deterrence", { economic: 0, social: 5 })).toBe(100);
    expect(leanAdjustedTier3(2, "order.deterrence", { economic: 0, social: -5 })).toBe(0);
  });

  it("is symmetric — mirroring the country lean mirrors the displacement", () => {
    const up = leanAdjustedTier3(50, "governance.centralAuthority", { economic: 0, social: 3 });
    const down = leanAdjustedTier3(50, "governance.centralAuthority", { economic: 0, social: -3 });
    expect(up - 50).toBeCloseTo(50 - down, 6);
  });
});
