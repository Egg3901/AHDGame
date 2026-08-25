import { describe, expect, it } from "vitest";
import {
  getStateResourceCapacity,
  STATE_RESOURCE_CAPACITY,
  RESOURCE_CAPACITY_HEADROOM,
} from "./stateResourceCapacity";

describe("eastern-bloc deposit authoring", () => {
  const capacity1953 = getStateResourceCapacity("1953-default");

  it("authors deposits for every bloc country that seeds extraction SOEs", () => {
    for (const key of [
      "UKR:UKR_DON",
      "UKR:UKR_DNI",
      "PL:PL_SLK",
      "CS:CS_BOH",
      "CS:CS_MOR",
      "HU:HU_NOR",
      "RO:RO_MUN",
      "BG:BG_THR",
      "BLR:BLR_HOM",
      "BAL:BAL_EST",
      "YU:YU_BIH",
    ]) {
      expect(Object.keys(capacity1953[key]?.resources ?? {}).length, key).toBeGreaterThan(0);
    }
  });

  it("preserves the retired RU:UKR country budget across the UKR split", () => {
    // The pre-split combined entry authored coal 300000 / iron 270000 /
    // natural_gas 45000 for all of Ukraine. The per-state split must keep the
    // original country-level calibration.
    const ukr = Object.entries(STATE_RESOURCE_CAPACITY).filter(([key]) => key.startsWith("UKR:"));
    const total: Record<string, number> = {};
    for (const [, entry] of ukr) {
      for (const [resource, value] of Object.entries(entry.resources)) {
        total[resource] = (total[resource] ?? 0) + (value ?? 0);
      }
    }
    expect(total.coal).toBe(300000);
    expect(total.iron).toBe(270000);
    expect(total.natural_gas).toBe(45000);
    expect(STATE_RESOURCE_CAPACITY["RU:UKR"]).toBeUndefined();
  });

  it("applies headroom scaling to the new entries like every other entry", () => {
    const donbass = capacity1953["UKR:UKR_DON"]!.resources;
    expect(donbass.coal).toBe(270000 * RESOURCE_CAPACITY_HEADROOM.coal);
    const krivoyRog = capacity1953["UKR:UKR_DNI"]!.resources;
    expect(krivoyRog.iron).toBe(243000 * RESOURCE_CAPACITY_HEADROOM.iron);
  });

  it("keeps the CN iron authoring the SOE flip depends on", () => {
    for (const key of ["CN:DB", "CN:HB", "CN:HZ", "CN:XN"]) {
      expect(capacity1953[key]?.resources.iron ?? 0, key).toBeGreaterThan(0);
    }
  });
});
