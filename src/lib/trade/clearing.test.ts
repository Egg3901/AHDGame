import { describe, it, expect } from "vitest";
import { clearCommodity } from "./clearing";
import type { ClearingInput } from "./types";

/** Sum every cell of a flow matrix. */
function totalFlow(flow: Record<string, Record<string, number>>): number {
  let t = 0;
  for (const e of Object.keys(flow)) for (const i of Object.keys(flow[e])) t += flow[e][i];
  return t;
}

const uniformAffinity = () => 1;

describe("clearCommodity", () => {
  it("returns an empty result when there is no surplus or deficit", () => {
    const input: ClearingInput = {
      countries: ["US", "CN"],
      supply: { US: 100, CN: 100 },
      demand: { US: 100, CN: 100 },
      affinity: uniformAffinity,
    };
    const r = clearCommodity(input);
    expect(r.clearedVolume).toBe(0);
    expect(totalFlow(r.flow)).toBe(0);
    expect(r.perCountry.US.uncleared).toBe(0);
  });

  it("clears the short side between one exporter and one importer", () => {
    // US surplus 60, CN deficit 40 → cleared = 40.
    const input: ClearingInput = {
      countries: ["US", "CN"],
      supply: { US: 100, CN: 0 },
      demand: { US: 40, CN: 40 },
      affinity: uniformAffinity,
    };
    const r = clearCommodity(input);
    expect(r.clearedVolume).toBeCloseTo(40);
    expect(r.flow.US.CN).toBeCloseTo(40);
    expect(r.perCountry.US.exports).toBeCloseTo(40);
    expect(r.perCountry.US.imports).toBeCloseTo(0);
    expect(r.perCountry.US.net).toBeCloseTo(40);
    expect(r.perCountry.US.uncleared).toBeCloseTo(20); // 60 surplus − 40 exported
    expect(r.perCountry.CN.imports).toBeCloseTo(40);
    expect(r.perCountry.CN.net).toBeCloseTo(-40);
    expect(r.perCountry.CN.uncleared).toBeCloseTo(0); // deficit fully met
  });

  it("conserves volume: Σ exports = Σ imports = clearedVolume (no caps)", () => {
    const input: ClearingInput = {
      countries: ["US", "CN", "DE", "JP"],
      supply: { US: 200, CN: 50, DE: 120, JP: 0 },
      demand: { US: 40, CN: 180, DE: 30, JP: 90 },
      affinity: uniformAffinity,
    };
    const r = clearCommodity(input);
    let exp = 0,
      imp = 0;
    for (const c of input.countries) {
      exp += r.perCountry[c].exports;
      imp += r.perCountry[c].imports;
    }
    expect(exp).toBeCloseTo(r.clearedVolume, 3);
    expect(imp).toBeCloseTo(r.clearedVolume, 3);
    // No exporter exports more than its surplus.
    expect(r.perCountry.US.exports).toBeLessThanOrEqual(160 + 1e-6); // surplus 200−40
    // No importer imports more than its deficit.
    expect(r.perCountry.CN.imports).toBeLessThanOrEqual(130 + 1e-6); // deficit 180−50
  });

  it("biases flow toward higher-affinity importers", () => {
    // US surplus 100; CN and DE each deficit 100; cleared = 100.
    // DE has 3× the affinity of CN → DE receives more.
    const input: ClearingInput = {
      countries: ["US", "CN", "DE"],
      supply: { US: 100, CN: 0, DE: 0 },
      demand: { US: 0, CN: 100, DE: 100 },
      affinity: (_e, i) => (i === "DE" ? 3 : 1),
    };
    const r = clearCommodity(input);
    expect(r.flow.US.DE).toBeGreaterThan(r.flow.US.CN);
    expect(r.perCountry.US.exports).toBeCloseTo(100, 3);
  });

  it("never routes a self-flow", () => {
    const input: ClearingInput = {
      countries: ["US", "CN"],
      supply: { US: 100, CN: 0 },
      demand: { US: 0, CN: 50 },
      affinity: uniformAffinity,
    };
    const r = clearCommodity(input);
    expect(r.flow.US.US ?? 0).toBe(0);
  });

  it("respects an embargo cap and leaves the capped volume uncleared", () => {
    // US surplus 100, CN deficit 100, cap US→CN at 30.
    const input: ClearingInput = {
      countries: ["US", "CN"],
      supply: { US: 100, CN: 0 },
      demand: { US: 0, CN: 100 },
      affinity: uniformAffinity,
      capUnits: (e, i) => (e === "US" && i === "CN" ? 30 : undefined),
    };
    const r = clearCommodity(input);
    expect(r.flow.US.CN).toBeLessThanOrEqual(30 + 1e-6);
    expect(r.perCountry.CN.uncleared).toBeLessThan(0); // unmet deficit remains
  });

  it("caps a high-affinity importer at its deficit and spills the rest to others", () => {
    // US surplus 100. CN tiny deficit 10 but enormous affinity; DE deficit 100.
    // CN must not import more than 10 even though affinity favors it.
    const input: ClearingInput = {
      countries: ["US", "CN", "DE"],
      supply: { US: 100, CN: 0, DE: 0 },
      demand: { US: 0, CN: 10, DE: 100 },
      affinity: (_e, i) => (i === "CN" ? 1000 : 1),
    };
    const r = clearCommodity(input);
    expect(r.perCountry.CN.imports).toBeLessThanOrEqual(10 + 1e-6);
    expect(r.perCountry.DE.imports).toBeGreaterThan(80); // absorbs the spillover
    expect(r.perCountry.US.exports).toBeCloseTo(100, 3);
  });

  it("never exports more than a country's surplus when its importer is reachable only through it", () => {
    // World in glut (deficit binds). CN can buy only from CS (curtain), and
    // CS holds 10 of surplus against CN's 50 deficit. The last column pass
    // used to push all 50 onto CS (prod t1278: CS energy 12.8M exported
    // against a 1.6M surplus).
    const input: ClearingInput = {
      countries: ["CS", "US", "CN"],
      supply: { CS: 30, US: 300, CN: 0 },
      demand: { CS: 20, US: 100, CN: 50 },
      affinity: (e, i) => (i === "CN" && e !== "CS" ? 0 : 1),
    };
    const r = clearCommodity(input);
    expect(r.perCountry.CS.exports).toBeLessThanOrEqual(10 + 1e-9);
    expect(r.perCountry.CN.imports).toBeLessThanOrEqual(10 + 1e-9);
    expect(r.perCountry.US.exports).toBe(0);
    // The unreachable part of CN's deficit stays unmet, it is not invented.
    expect(r.perCountry.CN.uncleared).toBeCloseTo(-40);
  });

  it("keeps every export within surplus and every import within deficit", () => {
    const input: ClearingInput = {
      countries: ["US", "CN", "DE", "JP", "HU"],
      supply: { US: 500, CN: 10, DE: 40, JP: 0, HU: 25 },
      demand: { US: 100, CN: 300, DE: 10, JP: 60, HU: 5 },
      affinity: (e, i) => (i === "CN" && e !== "HU" ? 0 : e === "US" && i === "JP" ? 3 : 1),
    };
    const r = clearCommodity(input);
    for (const c of input.countries) {
      const net = (input.supply[c] ?? 0) - (input.demand[c] ?? 0);
      expect(r.perCountry[c].exports).toBeLessThanOrEqual(Math.max(0, net) + 1e-9);
      expect(r.perCountry[c].imports).toBeLessThanOrEqual(Math.max(0, -net) + 1e-9);
    }
  });

  it("is deterministic", () => {
    const input: ClearingInput = {
      countries: ["US", "CN", "DE"],
      supply: { US: 120, CN: 30, DE: 0 },
      demand: { US: 10, CN: 90, DE: 60 },
      affinity: (e, i) => (e === "US" && i === "DE" ? 2 : 1),
    };
    const a = clearCommodity(input);
    const b = clearCommodity(input);
    expect(b).toEqual(a);
  });
});
