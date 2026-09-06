import { describe, expect, it } from "vitest";
import { OP_SLOTS_PER_TURN } from "./config";
import { intelligenceAccrualPerTurn } from "./appropriationLine";
import { networkUpkeep, operationCost } from "./cost";

/** The funding law's five levels, as fractions of GDP. Mirrors the catalog entries. */
const LEVEL = {
  unfunded: 0,
  nominal: 0.0005,
  standing: 0.0015,
  expanded: 0.003,
  unrestricted: 0.005,
} as const;

/** Live local-currency GDPs, four different denominations. This is the whole problem. */
const GDP = { RU: 1.478e12, US: 5.649e11, DD: 2.905e11, UK: 2.201e10 } as const;

const accrualAt = (gdp: number, level: number) => intelligenceAccrualPerTurn(gdp * level);

describe("operation pricing", () => {
  it("charges a covert action three times a collection", () => {
    expect(operationCost("action", 1e12)).toBeCloseTo(3 * operationCost("collect", 1e12), 6);
  });

  it("scales with the ordering country's own economy", () => {
    expect(operationCost("collect", 2e12)).toBeCloseTo(2 * operationCost("collect", 1e12), 6);
  });

  it("returns zero rather than NaN for an unusable GDP", () => {
    expect(operationCost("collect", 0)).toBe(0);
    expect(operationCost("collect", -1)).toBe(0);
    expect(operationCost("collect", Number.NaN)).toBe(0);
  });
});

describe("network upkeep", () => {
  it("charges nothing to leave a network unfunded", () => {
    expect(networkUpkeep("none", 1e12)).toBe(0);
  });

  it("climbs with the funding level", () => {
    const gdp = GDP.US;
    expect(networkUpkeep("trickle", gdp)).toBeLessThan(networkUpkeep("steady", gdp));
    expect(networkUpkeep("steady", gdp)).toBeLessThan(networkUpkeep("crash", gdp));
  });

  it("returns zero rather than NaN for an unusable GDP", () => {
    expect(networkUpkeep("steady", -1)).toBe(0);
    expect(networkUpkeep("steady", Number.NaN)).toBe(0);
  });
});

describe("the GDP cancellation", () => {
  it("affords every country the same at the same funding level", () => {
    // The property the whole redenomination exists to produce. Under the old flat
    // costs the UK bought three operations a turn where the USSR bought two hundred,
    // at an identical share of GDP.
    for (const level of Object.values(LEVEL)) {
      const counts = Object.values(GDP).map(
        (gdp) => accrualAt(gdp, level) / operationCost("collect", gdp)
      );
      for (const count of counts) expect(count).toBeCloseTo(counts[0], 6);
    }
  });

  it("sustains the same number of networks in every currency", () => {
    for (const level of Object.values(LEVEL)) {
      const counts = Object.values(GDP).map(
        (gdp) => accrualAt(gdp, level) / networkUpkeep("steady", gdp)
      );
      for (const count of counts) expect(count).toBeCloseTo(counts[0], 6);
    }
  });
});

describe("the funding ladder", () => {
  it("affords nothing at all while unfunded", () => {
    expect(accrualAt(GDP.US, LEVEL.unfunded)).toBe(0);
  });

  it("makes money bind below the design centre", () => {
    // At level 1 a service cannot work both slots: it must choose reach or tempo.
    const gdp = GDP.UK;
    expect(OP_SLOTS_PER_TURN * operationCost("collect", gdp)).toBeGreaterThan(
      accrualAt(gdp, LEVEL.nominal)
    );
  });

  it("puts the design centre at level 2: both slots plus one steady network", () => {
    const gdp = GDP.US;
    const accrual = accrualAt(gdp, LEVEL.standing);
    const committed =
      OP_SLOTS_PER_TURN * operationCost("collect", gdp) + networkUpkeep("steady", gdp);
    expect(committed).toBeLessThanOrEqual(accrual);
    // ...and only just. A second steady network does not fit.
    expect(committed + networkUpkeep("steady", gdp)).toBeGreaterThan(accrual);
  });

  it("lets slots bind above the design centre, so the surplus buys reach", () => {
    const gdp = GDP.RU;
    const accrual = accrualAt(gdp, LEVEL.expanded);
    const slotsCost = OP_SLOTS_PER_TURN * operationCost("collect", gdp);
    expect(slotsCost).toBeLessThan(accrual);
    // Three more steady networks fit inside what is left after both slots.
    expect(slotsCost + 3 * networkUpkeep("steady", gdp)).toBeLessThanOrEqual(accrual);
  });
});
