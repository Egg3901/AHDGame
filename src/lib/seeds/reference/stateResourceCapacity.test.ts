import { describe, it, expect } from "vitest";
import {
  lookupStateResourceCapacity,
  type StateResourceCapacityEntry,
} from "./stateResourceCapacity";

const entry = (countryId: "DE" | "DD", resources: StateResourceCapacityEntry["resources"]) => ({
  countryId,
  resources,
});

describe("lookupStateResourceCapacity", () => {
  const map = {
    "DD:SN": entry("DD", { coal: 55000 }),
    "DE:SN": entry("DE", { coal: 45000, rare_earth: 1286 }),
    "DE:NW": entry("DE", { coal: 90000, iron: 45000 }),
  };

  it("prefers the live owner's key when both owners list the region", () => {
    expect(lookupStateResourceCapacity(map, "DD", "SN")).toBe(map["DD:SN"]);
    expect(lookupStateResourceCapacity(map, "DE", "SN")).toBe(map["DE:SN"]);
  });

  it("falls back to a previous owner's key for an absorbed region (ticket #1271)", () => {
    // Nordrhein-Westfalen acceded to DD; the static map still keys the Ruhr
    // deposits under DE, and the geology did not move with the flag.
    expect(lookupStateResourceCapacity(map, "DD", "NW")).toBe(map["DE:NW"]);
  });

  it("returns undefined when no owner lists the region", () => {
    expect(lookupStateResourceCapacity(map, "DD", "NOWHERE")).toBeUndefined();
  });
});
