import { describe, it, expect } from "vitest";
import { resolveEnergyEnvelope } from "./energyEnvelope";
import {
  ENERGY_ENVELOPE_FALLBACK_GDP_FRACTION,
  ENERGY_DISCRETIONARY_FRACTION,
  ENERGY_DISCRETIONARY_BASELINE,
  ENERGY_DISCRETIONARY_CAP,
  ENERGY_UPKEEP_UNIT,
} from "@/lib/constants/cabinetEnergy";

function fakeDb(budget: unknown) {
  return { collection: () => ({ findOne: async () => budget }) } as never;
}
const baselineAbs = ENERGY_DISCRETIONARY_BASELINE * ENERGY_UPKEEP_UNIT;
const capAbs = ENERGY_DISCRETIONARY_CAP * ENERGY_UPKEEP_UNIT;

describe("resolveEnergyEnvelope", () => {
  it("returns the gdp-fraction slice when it falls inside the band", async () => {
    const gdp = 30_000_000_000_000; // slice = 4,500M ∈ (baseline 3,500M, cap 5,000M)
    expect(await resolveEnergyEnvelope(fakeDb({ gdp }), "US")).toBeCloseTo(
      gdp * ENERGY_ENVELOPE_FALLBACK_GDP_FRACTION * ENERGY_DISCRETIONARY_FRACTION,
      5
    );
  });

  it("caps a huge (large-currency) economy at the cap", async () => {
    expect(await resolveEnergyEnvelope(fakeDb({ gdp: 50_000_000_000_000 }), "JP")).toBe(capAbs);
  });

  it("floors at the baseline allowance for a small economy", async () => {
    expect(await resolveEnergyEnvelope(fakeDb({ gdp: 1_000_000_000_000 }), "US")).toBe(baselineAbs);
  });

  it("floors at the baseline when a budget exists but has no gdp", async () => {
    expect(await resolveEnergyEnvelope(fakeDb({}), "US")).toBe(baselineAbs);
  });

  it("returns 0 when there is no budget at all", async () => {
    expect(await resolveEnergyEnvelope(fakeDb(null), "US")).toBe(0);
  });
});
