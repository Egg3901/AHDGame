import { describe, expect, it } from "vitest";
import { computeNoticeTurns, allCitedConditionsCleared } from "./noticeWindow";
import { DISTRESS_NOTICE_TURNS, STRATEGIC_NOTICE_TURNS } from "./constants";

describe("computeNoticeTurns", () => {
  it("is immediate (0) for a distress taking", () => {
    expect(computeNoticeTurns(["distress"])).toBe(DISTRESS_NOTICE_TURNS);
  });
  it("is the strategic window for monopoly / strategic / supermajority", () => {
    expect(computeNoticeTurns(["monopoly"])).toBe(STRATEGIC_NOTICE_TURNS);
    expect(computeNoticeTurns(["strategic"])).toBe(STRATEGIC_NOTICE_TURNS);
    expect(computeNoticeTurns(["supermajority"])).toBe(STRATEGIC_NOTICE_TURNS);
  });
  it("takes the SHORTEST window when multiple triggers (distress wins)", () => {
    expect(computeNoticeTurns(["distress", "monopoly"])).toBe(DISTRESS_NOTICE_TURNS);
  });
});

describe("allCitedConditionsCleared", () => {
  it("cancels when the only cited curable condition has cleared", () => {
    expect(allCitedConditionsCleared(["monopoly"], { strategic: false, monopoly: false })).toBe(
      true
    );
  });
  it("does NOT cancel while a cited condition still holds", () => {
    expect(allCitedConditionsCleared(["monopoly"], { strategic: false, monopoly: true })).toBe(
      false
    );
  });
  it("requires ALL cited curable conditions to clear", () => {
    expect(
      allCitedConditionsCleared(["strategic", "monopoly"], { strategic: false, monopoly: true })
    ).toBe(false);
    expect(
      allCitedConditionsCleared(["strategic", "monopoly"], { strategic: false, monopoly: false })
    ).toBe(true);
  });
  it("never cancels a taking that cited no curable condition (e.g. supermajority)", () => {
    expect(
      allCitedConditionsCleared(["supermajority"], { strategic: false, monopoly: false })
    ).toBe(false);
  });
});
