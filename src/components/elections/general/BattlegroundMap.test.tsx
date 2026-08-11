// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { HoverCard, shadeColorForTier } from "./BattlegroundMap";

describe("shadeColorForTier", () => {
  it("safe darkens the base color", () => {
    const safe = shadeColorForTier("#ff0000", "safe");
    // r * 0.7 = 178.5 → floor 178 → 0xb2
    expect(safe).toBe("rgb(178, 0, 0)");
  });

  it("likely returns the base color unchanged", () => {
    expect(shadeColorForTier("#0000ff", "likely")).toBe("#0000ff");
  });

  it("lean lightens toward white (50% blend)", () => {
    const lean = shadeColorForTier("#0000ff", "lean");
    // r: 0 + (255-0)*0.5 = 127.5 → 127. g: same. b: 255 + (255-255)*0.5 = 255
    expect(lean).toBe("rgb(127, 127, 255)");
  });

  it("tossup tints near-white (85% blend)", () => {
    const tossup = shadeColorForTier("#0000ff", "tossup");
    expect(tossup).toBe("rgb(216, 216, 255)");
  });

  it("falls back to base color for invalid hex", () => {
    expect(shadeColorForTier("not-a-color", "safe")).toBe("not-a-color");
  });

  it("each tier produces a visually distinct shade", () => {
    const base = "#3366ff";
    const safe = shadeColorForTier(base, "safe");
    const likely = shadeColorForTier(base, "likely");
    const lean = shadeColorForTier(base, "lean");
    const tossup = shadeColorForTier(base, "tossup");
    expect(safe).not.toBe(likely);
    expect(likely).not.toBe(lean);
    expect(lean).not.toBe(tossup);
  });
});

describe("HoverCard", () => {
  it("renders state name, candidate rows with shares, and tier line", () => {
    const { getByText } = render(
      <HoverCard
        data={{
          stateName: "Pennsylvania",
          candidates: [
            { name: "J. Smith", partyAbbr: "DEM", partyColor: "#3B82F6", votePct: 52.1 },
            { name: "M. Jones", partyAbbr: "REP", partyColor: "#EF4444", votePct: 47.4 },
          ],
          marginPp: 4.7,
          tier: "tossup",
        }}
      />
    );
    // getByText throws if not found, so a successful return IS the assertion.
    expect(getByText("Pennsylvania")).toBeTruthy();
    expect(getByText("J. Smith")).toBeTruthy();
    expect(getByText("M. Jones")).toBeTruthy();
    expect(getByText("DEM")).toBeTruthy();
    expect(getByText("REP")).toBeTruthy();
    expect(getByText("52.1%")).toBeTruthy();
    expect(getByText("47.4%")).toBeTruthy();
    expect(getByText(/Toss-up/i)).toBeTruthy();
    expect(getByText(/\+4\.7pp/)).toBeTruthy();
  });

  it("renders three-candidate variant when input includes 3 candidates", () => {
    const { getByText } = render(
      <HoverCard
        data={{
          stateName: "California",
          candidates: [
            { name: "A", partyAbbr: "DEM", partyColor: "#3B82F6", votePct: 50 },
            { name: "B", partyAbbr: "REP", partyColor: "#EF4444", votePct: 45 },
            { name: "C", partyAbbr: "GRN", partyColor: "#22C55E", votePct: 5 },
          ],
          marginPp: 5,
          tier: "lean",
        }}
      />
    );
    expect(getByText("DEM")).toBeTruthy();
    expect(getByText("REP")).toBeTruthy();
    expect(getByText("GRN")).toBeTruthy();
    expect(getByText(/Lean/i)).toBeTruthy();
  });
});
