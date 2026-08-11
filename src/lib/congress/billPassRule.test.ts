import { describe, it, expect } from "vitest";
import {
  billHasNatPrivProvision,
  billHasDeclareWar,
  getBillPassRule,
  meetsBillPassRule,
} from "./billPassRule";

describe("billHasNatPrivProvision", () => {
  it("detects nationalize and privatize provisions, ignores others", () => {
    expect(billHasNatPrivProvision([{ type: "nationalize" }])).toBe(true);
    expect(billHasNatPrivProvision([{ type: "privatize" }])).toBe(true);
    expect(billHasNatPrivProvision([{ type: "designate_strategic_sector" }])).toBe(false);
    expect(billHasNatPrivProvision([{ type: "tariff" }, { type: "privatize" }])).toBe(true);
    expect(billHasNatPrivProvision([{ legislationTypeId: "x" } as { type?: string }])).toBe(false);
    expect(billHasNatPrivProvision(undefined)).toBe(false);
    expect(billHasNatPrivProvision([])).toBe(false);
  });
});

describe("getBillPassRule", () => {
  it("requires two-thirds for nat/priv bills in free legislatures", () => {
    for (const gt of ["presidential", "parliamentaryMonarchy", "parliamentaryRepublic"] as const) {
      expect(getBillPassRule(gt, true)).toEqual({
        rule: "twoThirds",
        label: "two-thirds supermajority",
      });
    }
  });
  it("requires only a simple majority in one-party states", () => {
    expect(getBillPassRule("onePartyState", true)).toEqual({
      rule: "majority",
      label: "simple majority",
    });
  });
  it("requires only a simple majority for non-nat/priv bills anywhere", () => {
    expect(getBillPassRule("presidential", false)).toEqual({
      rule: "majority",
      label: "simple majority",
    });
    expect(getBillPassRule(null, false)).toEqual({ rule: "majority", label: "simple majority" });
  });
});

describe("meetsBillPassRule", () => {
  it("majority: For must exceed Against; ties and empty fail", () => {
    expect(meetsBillPassRule(51, 49, "majority")).toBe(true);
    expect(meetsBillPassRule(50, 50, "majority")).toBe(false);
    expect(meetsBillPassRule(0, 0, "majority")).toBe(false);
    expect(meetsBillPassRule(1, 0, "majority")).toBe(true);
  });
  it("twoThirds: For must be >= 2/3 of votes cast; abstentions excluded", () => {
    expect(meetsBillPassRule(67, 33, "twoThirds")).toBe(true); // exactly 2/3
    expect(meetsBillPassRule(66, 34, "twoThirds")).toBe(false); // just under
    expect(meetsBillPassRule(60, 40, "twoThirds")).toBe(false);
    expect(meetsBillPassRule(2, 1, "twoThirds")).toBe(true); // 2/3 of 3
    expect(meetsBillPassRule(2, 2, "twoThirds")).toBe(false);
    expect(meetsBillPassRule(1, 0, "twoThirds")).toBe(true); // 100%
    expect(meetsBillPassRule(0, 0, "twoThirds")).toBe(false); // no votes cast
  });
});

describe("declare-war passage", () => {
  it("needs a two-thirds supermajority", () => {
    expect(getBillPassRule("presidential", false, true).rule).toBe("twoThirds");
  });

  it("needs two-thirds in a one-party state too", () => {
    // Deliberately unlike nat/priv, which drops back to a simple majority here.
    // War is war: the bar does not depend on the government type.
    expect(getBillPassRule("onePartyState", false, true).rule).toBe("twoThirds");
  });

  it("needs two-thirds in a parliamentary system", () => {
    expect(getBillPassRule("parliamentaryRepublic", false, true).rule).toBe("twoThirds");
  });

  it("leaves other bills on a simple majority", () => {
    expect(getBillPassRule("presidential", false, false).rule).toBe("majority");
  });

  it("detects the provision", () => {
    expect(billHasDeclareWar([{ type: "declare_war" }])).toBe(true);
    expect(billHasDeclareWar([{ type: "embargo" }])).toBe(false);
    expect(billHasDeclareWar([])).toBe(false);
    expect(billHasDeclareWar(undefined)).toBe(false);
  });

  it("applies the same two-thirds arithmetic as nat/priv bills", () => {
    // For must be at least 2/3 of votes CAST; abstentions are excluded.
    expect(meetsBillPassRule(2, 1, "twoThirds")).toBe(true);
    expect(meetsBillPassRule(1, 1, "twoThirds")).toBe(false);
    expect(meetsBillPassRule(0, 0, "twoThirds")).toBe(false);
  });
});
