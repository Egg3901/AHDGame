import { describe, it, expect } from "vitest";
import { getShareBuybackMode } from "./shareBuybackMode";

describe("getShareBuybackMode", () => {
  it("defaults to instant when unset", () => {
    expect(getShareBuybackMode({})).toBe("instant");
  });
  it("returns escrow only for the exact 'escrow' value", () => {
    expect(getShareBuybackMode({ shareBuybackMode: "escrow" })).toBe("escrow");
  });
  it("treats any other value as instant", () => {
    expect(getShareBuybackMode({ shareBuybackMode: "instant" })).toBe("instant");
    expect(getShareBuybackMode({ shareBuybackMode: "weird" as never })).toBe("instant");
  });
});
