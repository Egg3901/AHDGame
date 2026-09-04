import { describe, expect, it, vi } from "vitest";
import {
  getStateResourceCapacity,
  resolveStateResourceEntry,
  type StateResourceCapacityEntry,
} from "./stateResourceCapacity";

const MAP: Record<string, StateResourceCapacityEntry> = {
  "DE:NW": { countryId: "DE", resources: { coal: 90000, iron: 45000 } },
  "DE:HB": { countryId: "DE", resources: { timber: 750 } },
  "DD:SN": { countryId: "DD", resources: { coal: 55000 } },
  "CN:HB": { countryId: "CN", resources: { coal: 1000 } },
  "US:TX": { countryId: "US", resources: { oil: 450000 } },
};

describe("resolveStateResourceEntry", () => {
  it("takes the exact compound key when the state is still in its seeded country", () => {
    expect(resolveStateResourceEntry(MAP, "DE", "NW")?.resources).toEqual({
      coal: 90000,
      iron: 45000,
    });
  });

  it("finds a state absorbed into another country by its unique state code", () => {
    // Ticket #1271: reunification re-keys the western Laender onto DD, so the
    // `DD:NW` lookup misses even though the Ruhr deposits are unchanged.
    expect(resolveStateResourceEntry(MAP, "DD", "NW")?.resources).toEqual({
      coal: 90000,
      iron: 45000,
    });
  });

  it("still prefers the exact key over the fallback when both could match", () => {
    expect(resolveStateResourceEntry(MAP, "CN", "HB")?.resources).toEqual({ coal: 1000 });
    expect(resolveStateResourceEntry(MAP, "DE", "HB")?.resources).toEqual({ timber: 750 });
  });

  it("refuses to guess when two countries define the same state code", () => {
    const onAmbiguous = vi.fn();
    expect(resolveStateResourceEntry(MAP, "DD", "HB", onAmbiguous)).toBeUndefined();
    expect(onAmbiguous).toHaveBeenCalledTimes(1);
    expect(onAmbiguous.mock.calls[0][0].sort()).toEqual(["CN", "DE"]);
  });

  it("returns undefined for a state that carries no deposits anywhere", () => {
    const onAmbiguous = vi.fn();
    expect(resolveStateResourceEntry(MAP, "US", "NOWHERE", onAmbiguous)).toBeUndefined();
    expect(onAmbiguous).not.toHaveBeenCalled();
  });

  it("resolves every western German Land through a DD survivor on the live map", () => {
    // The exact shape of the live bug: all eleven states report deposits under
    // the surviving country id, and none of the codes are ambiguous.
    const live = getStateResourceCapacity("1953-default");
    const west = ["BW", "BY", "NW", "HE", "RP", "SL", "NI", "SH", "HH", "BRE", "BE"];
    for (const stateId of west) {
      const entry = resolveStateResourceEntry(live, "DD", stateId);
      expect(entry, `${stateId} should resolve under DD`).toBeDefined();
      expect(Object.keys(entry?.resources ?? {}).length).toBeGreaterThan(0);
    }
  });
});
