import { describe, expect, it } from "vitest";
import {
  classifyOpeningInflation,
  MAX_INFLATION,
  MAX_PER_TURN_DELTA,
  MAX_SUPPORTED_OPENING_INFLATION,
  MIN_INFLATION,
  minimumTurnsToOrdinaryRange,
  settleInflationStep,
} from "./inflationBounds";

/** The settlement every in-range rate used before the recovery contract existed. */
function legacySettle(previous: number, proposed: number, maxPositiveDelta = MAX_PER_TURN_DELTA) {
  const delta = Math.max(-MAX_PER_TURN_DELTA, Math.min(maxPositiveDelta, proposed - previous));
  return Math.round(Math.max(MIN_INFLATION, Math.min(MAX_INFLATION, previous + delta)) * 100) / 100;
}

describe("settleInflationStep", () => {
  it("is unchanged for every in-range previous rate", () => {
    for (let previous = -3; previous <= MAX_INFLATION; previous += 0.73) {
      for (const proposed of [-50, -2, 0, previous - 0.4, previous + 0.4, 50, 150, 600]) {
        expect(settleInflationStep({ previous, proposed })).toBe(legacySettle(previous, proposed));
        expect(settleInflationStep({ previous, proposed, maxPositiveDelta: 6 })).toBe(
          legacySettle(previous, proposed, 6)
        );
      }
    }
  });

  it("does not snap an above-range rate to the ceiling", () => {
    expect(settleInflationStep({ previous: 480, proposed: 20 })).toBe(465.6);
    expect(settleInflationStep({ previous: 144, proposed: 20 })).toBe(139.68);
  });

  it("never lets an above-range rate rise", () => {
    expect(settleInflationStep({ previous: 480, proposed: 900 })).toBe(480);
  });

  it("follows the calculated rate when it is inside the unwind limit", () => {
    expect(settleInflationStep({ previous: 480, proposed: 470 })).toBe(470);
  });

  it("hands off to the ordinary limits once the rate crosses the ceiling", () => {
    expect(settleInflationStep({ previous: 101, proposed: 0 })).toBe(97.97);
    expect(settleInflationStep({ previous: 97.97, proposed: 0 })).toBe(96.47);
  });

  it("re-enters the ordinary range in about a game year from 480%", () => {
    expect(minimumTurnsToOrdinaryRange(480)).toBe(52);
    expect(minimumTurnsToOrdinaryRange(144)).toBe(12);
    expect(minimumTurnsToOrdinaryRange(MAX_INFLATION)).toBe(0);
  });
});

describe("classifyOpeningInflation", () => {
  it("separates ordinary, recoverable and unsupported openings", () => {
    expect(classifyOpeningInflation(2.5)).toBe("ordinary");
    expect(classifyOpeningInflation(MIN_INFLATION)).toBe("ordinary");
    expect(classifyOpeningInflation(MAX_INFLATION)).toBe("ordinary");
    expect(classifyOpeningInflation(480)).toBe("hyperinflation-recovery");
    expect(classifyOpeningInflation(MAX_SUPPORTED_OPENING_INFLATION + 1)).toBe("unsupported");
    expect(classifyOpeningInflation(-5)).toBe("unsupported");
    expect(classifyOpeningInflation(Number.NaN)).toBe("unsupported");
  });
});
