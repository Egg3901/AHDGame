import { describe, it, expect } from "vitest";
import {
  getStateResourceCapacity,
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

  it("picks the first owner by key order when several list a region the asker does not", () => {
    // PINS A DELIBERATE AMBIGUITY. The country half of the key exists to keep
    // colliding region codes apart, so a code defined by two countries that are
    // BOTH foreign to the asker has no provably right answer. The fallback takes
    // the first by sorted key rather than refusing, which is safe today only
    // because no such collision is reachable: the sole colliding codes on the
    // live map are the five eastern Laender (SN, BB, ST, TH, MV), and DD and DE
    // each carry their own entry for those, so the exact key always hits first
    // and this branch never runs for them. If a future merge introduces a code
    // two countries share and a THIRD asks for it, that country silently
    // inherits alphabetical-first geology. Kept as a pinned expectation so the
    // choice is visible rather than incidental.
    const ambiguous = {
      "CN:HB": entry("DD", { coal: 1000 }),
      "DE:HB": entry("DE", { timber: 750 }),
    };
    expect(lookupStateResourceCapacity(ambiguous, "PL", "HB")).toBe(ambiguous["CN:HB"]);
  });
});

describe("lookupStateResourceCapacity against the live reference map", () => {
  // The exact shape of the #1271 incident: reunification re-keys the eleven
  // western Laender onto DD, and every one of them must still report the
  // deposits it was seeded with. Without this the SOE extraction gate reads
  // "no resources" and builds no plant, which is how the Ruhr, the Saar and the
  // Niedersachsen gas fields went unreachable on the live world.
  const WESTERN_LAENDER = ["BW", "BY", "NW", "HE", "RP", "SL", "NI", "SH", "HH", "BRE", "BE"];
  const EASTERN_LAENDER = ["MV", "BB", "ST", "SN", "TH"];

  it("resolves every western Land under the DD survivor", () => {
    const live = getStateResourceCapacity("1953-default");
    for (const stateId of WESTERN_LAENDER) {
      const resolved = lookupStateResourceCapacity(live, "DD", stateId);
      expect(resolved, `${stateId} should resolve under DD`).toBeDefined();
      expect(
        Object.keys(resolved?.resources ?? {}).length,
        `${stateId} should carry deposits`
      ).toBeGreaterThan(0);
    }
  });

  it("keeps each eastern Land on its own entry rather than the FRG's", () => {
    // These are the only colliding codes on the map, so they are the ones that
    // would break first if the exact-key preference were ever dropped.
    const live = getStateResourceCapacity("1953-default");
    for (const stateId of EASTERN_LAENDER) {
      expect(lookupStateResourceCapacity(live, "DD", stateId)?.countryId).toBe("DD");
      expect(lookupStateResourceCapacity(live, "DE", stateId)?.countryId).toBe("DE");
    }
  });
});
