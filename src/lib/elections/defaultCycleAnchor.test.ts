import { describe, expect, it } from "vitest";
import { resolveDefaultCycleEndTurn } from "./defaultCycleAnchor";

const DEFAULT = 72;

describe("resolveDefaultCycleEndTurn", () => {
  it("returns the modal endTurn of active default-duration elections", () => {
    const candidates = [
      { countryId: "US", durationTurns: DEFAULT, endTurn: 150 },
      { countryId: "US", durationTurns: DEFAULT, endTurn: 150 },
      { countryId: "US", durationTurns: DEFAULT, endTurn: 149 },
    ];
    expect(
      resolveDefaultCycleEndTurn(candidates, {
        defaultDurationTurns: DEFAULT,
        currentTurn: 100,
        countryId: "US",
      })
    ).toBe(150);
  });

  it("prefers same-country candidates over other countries", () => {
    const candidates = [
      { countryId: "UK", durationTurns: DEFAULT, endTurn: 150 },
      { countryId: "UK", durationTurns: DEFAULT, endTurn: 150 },
      { countryId: "US", durationTurns: DEFAULT, endTurn: 145 },
    ];
    expect(
      resolveDefaultCycleEndTurn(candidates, {
        defaultDurationTurns: DEFAULT,
        currentTurn: 100,
        countryId: "US",
      })
    ).toBe(145);
  });

  it("falls back to the global pool when the country has no candidates", () => {
    const candidates = [{ countryId: "UK", durationTurns: DEFAULT, endTurn: 150 }];
    expect(
      resolveDefaultCycleEndTurn(candidates, {
        defaultDurationTurns: DEFAULT,
        currentTurn: 100,
        countryId: "US",
      })
    ).toBe(150);
  });

  it("ignores custom-duration elections", () => {
    const candidates = [
      { countryId: "US", durationTurns: 300, endTurn: 400 },
      { countryId: "US", durationTurns: DEFAULT, endTurn: 150 },
    ];
    expect(
      resolveDefaultCycleEndTurn(candidates, {
        defaultDurationTurns: DEFAULT,
        currentTurn: 100,
        countryId: "US",
      })
    ).toBe(150);
  });

  it("uses originalEndTurn for accelerated candidates", () => {
    const candidates = [
      { countryId: "US", durationTurns: DEFAULT, endTurn: 120, originalEndTurn: 150 },
    ];
    expect(
      resolveDefaultCycleEndTurn(candidates, {
        defaultDurationTurns: DEFAULT,
        currentTurn: 100,
        countryId: "US",
      })
    ).toBe(150);
  });

  it("ignores candidates whose effective end is not in the future", () => {
    const candidates = [
      { countryId: "US", durationTurns: DEFAULT, endTurn: 100 },
      { countryId: "US", durationTurns: DEFAULT, endTurn: 90 },
    ];
    expect(
      resolveDefaultCycleEndTurn(candidates, {
        defaultDurationTurns: DEFAULT,
        currentTurn: 100,
        countryId: "US",
      })
    ).toBe(100 + DEFAULT);
  });

  it("returns currentTurn + default when there are no candidates at all", () => {
    expect(
      resolveDefaultCycleEndTurn([], {
        defaultDurationTurns: DEFAULT,
        currentTurn: 200,
        countryId: "US",
      })
    ).toBe(272);
  });

  it("treats a missing candidate countryId as US (legacy docs)", () => {
    const candidates = [{ durationTurns: DEFAULT, endTurn: 130 }];
    expect(
      resolveDefaultCycleEndTurn(candidates, {
        defaultDurationTurns: DEFAULT,
        currentTurn: 100,
        countryId: "US",
      })
    ).toBe(130);
  });

  it("breaks modal ties toward the smaller endTurn (deterministic)", () => {
    const candidates = [
      { countryId: "US", durationTurns: DEFAULT, endTurn: 150 },
      { countryId: "US", durationTurns: DEFAULT, endTurn: 140 },
    ];
    expect(
      resolveDefaultCycleEndTurn(candidates, {
        defaultDurationTurns: DEFAULT,
        currentTurn: 100,
        countryId: "US",
      })
    ).toBe(140);
  });
});
