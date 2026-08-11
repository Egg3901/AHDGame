import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  isClusterConnected,
  isPriorityRegionLocked,
  isStateInPriorityRegion,
  maxClusterSize,
  partyHoldsStateExecutiveInCluster,
  priorityRegionUnlockTurn,
  validatePriorityRegionCluster,
} from "./priorityRegion";
import {
  PRIORITY_REGION_GOVERNOR_ANCHOR_BONUS,
  PRIORITY_REGION_LOCKOUT_TURNS,
  PRIORITY_REGION_MAX_STATES,
} from "@/lib/turn/politicalStrength/strengthConstants";

describe("maxClusterSize", () => {
  it("returns the base MAX_STATES without anchor", () => {
    expect(maxClusterSize(false)).toBe(PRIORITY_REGION_MAX_STATES);
  });
  it("adds the governor-anchor bonus when anchored", () => {
    expect(maxClusterSize(true)).toBe(
      PRIORITY_REGION_MAX_STATES + PRIORITY_REGION_GOVERNOR_ANCHOR_BONUS
    );
  });
});

describe("isClusterConnected (US adjacency)", () => {
  it("single-state cluster is trivially connected", () => {
    expect(isClusterConnected("US", ["CA"])).toBe(true);
  });

  it("two adjacent states are connected (NY-NJ)", () => {
    expect(isClusterConnected("US", ["NY", "NJ"])).toBe(true);
  });

  it("two non-adjacent states are NOT connected (CA-NY)", () => {
    expect(isClusterConnected("US", ["CA", "NY"])).toBe(false);
  });

  it("3-state path (NY-NJ-PA) is connected even though NY-PA are also adjacent", () => {
    expect(isClusterConnected("US", ["NY", "NJ", "PA"])).toBe(true);
  });

  it("3-state path A-B-C is connected when only A-B and B-C are neighbors (not A-C)", () => {
    // Example: WA-OR-CA — WA-OR adjacent, OR-CA adjacent, WA-CA not adjacent
    expect(isClusterConnected("US", ["WA", "OR", "CA"])).toBe(true);
  });

  it("disconnected 3-state pick (CA+NY+FL) is rejected", () => {
    expect(isClusterConnected("US", ["CA", "NY", "FL"])).toBe(false);
  });

  it("AK is connected to WA via the sea-border edge", () => {
    // Per the F4 redesign adjacency map AK↔WA is included.
    expect(isClusterConnected("US", ["AK", "WA"])).toBe(true);
  });

  it("de-dupes duplicate state IDs before testing", () => {
    expect(isClusterConnected("US", ["CA", "CA", "OR"])).toBe(true);
  });
});

describe("validatePriorityRegionCluster", () => {
  it("accepts a 2-state adjacent cluster", () => {
    expect(validatePriorityRegionCluster("US", ["NY", "NJ"], false).ok).toBe(true);
  });

  it("accepts a 3-state connected path", () => {
    expect(validatePriorityRegionCluster("US", ["WA", "OR", "CA"], false).ok).toBe(true);
  });

  it("rejects a single-state cluster", () => {
    const result = validatePriorityRegionCluster("US", ["CA"], false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/at least 2/i);
  });

  it("rejects a 4-state cluster without anchor", () => {
    const result = validatePriorityRegionCluster("US", ["WA", "OR", "CA", "NV"], false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/at most 3/i);
  });

  it("accepts a 4-state connected cluster WITH governor anchor", () => {
    const result = validatePriorityRegionCluster("US", ["WA", "OR", "CA", "NV"], true);
    expect(result.ok).toBe(true);
  });

  it("rejects a 5-state cluster even with anchor", () => {
    const result = validatePriorityRegionCluster("US", ["WA", "OR", "CA", "NV", "AZ"], true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/at most 4/i);
  });

  it("rejects duplicate states in the pick", () => {
    const result = validatePriorityRegionCluster("US", ["CA", "CA"], false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/duplicate/i);
  });

  it("rejects a disconnected 3-state pick (CA + NY + FL)", () => {
    const result = validatePriorityRegionCluster("US", ["CA", "NY", "FL"], false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/connected/i);
  });

  it("rejects a 2-state non-adjacent pick (CA + NY)", () => {
    const result = validatePriorityRegionCluster("US", ["CA", "NY"], false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/connected/i);
  });
});

describe("priorityRegionUnlockTurn", () => {
  it("returns setAtTurn + LOCKOUT for a set cluster", () => {
    const unlock = priorityRegionUnlockTurn({
      priorityRegion: {
        stateIds: ["CA", "OR"],
        setAtTurn: 100,
        setBy: new ObjectId(),
      },
    });
    expect(unlock).toBe(100 + PRIORITY_REGION_LOCKOUT_TURNS);
  });

  it("returns null when no cluster is set", () => {
    expect(priorityRegionUnlockTurn({ priorityRegion: undefined })).toBeNull();
  });
});

describe("isPriorityRegionLocked", () => {
  it("returns true within the lockout window", () => {
    expect(
      isPriorityRegionLocked(
        {
          priorityRegion: {
            stateIds: ["CA", "OR"],
            setAtTurn: 100,
            setBy: new ObjectId(),
          },
        },
        100 + PRIORITY_REGION_LOCKOUT_TURNS - 1
      )
    ).toBe(true);
  });

  it("returns false at the unlock turn (exclusive)", () => {
    expect(
      isPriorityRegionLocked(
        {
          priorityRegion: {
            stateIds: ["CA", "OR"],
            setAtTurn: 100,
            setBy: new ObjectId(),
          },
        },
        100 + PRIORITY_REGION_LOCKOUT_TURNS
      )
    ).toBe(false);
  });

  it("returns false when no cluster is set (slot is unlocked)", () => {
    expect(isPriorityRegionLocked({ priorityRegion: undefined }, 999)).toBe(false);
  });

  it("an emptied cluster (states all evicted) still locks the slot", () => {
    // Per the spec — the slot stays empty AND locked until cooldown expires.
    expect(
      isPriorityRegionLocked(
        {
          priorityRegion: {
            stateIds: [], // all evicted by the decay validator
            setAtTurn: 100,
            setBy: new ObjectId(),
          },
        },
        100 + 50
      )
    ).toBe(true);
  });
});

describe("partyHoldsStateExecutiveInCluster (governor anchor)", () => {
  function makeDb(officialsByStateOfficeType: Record<string, { party: string } | null>): Db {
    const findOne = vi.fn(async (filter: { state?: string; officeType?: string }) => {
      const key = `${filter.state}:${filter.officeType}`;
      return officialsByStateOfficeType[key] ?? null;
    });
    return {
      collection: vi.fn(() => ({ findOne })),
    } as unknown as Db;
  }

  it("returns true when the party holds a governorship in any of the cluster states (US)", async () => {
    const db = makeDb({
      "WA:governor": { party: "7" },
      "OR:governor": { party: "9" },
    });
    const result = await partyHoldsStateExecutiveInCluster(db, { sequentialId: 7 }, "US", [
      "WA",
      "OR",
    ]);
    expect(result).toBe(true);
  });

  it("returns false when no cluster state has the party's executive", async () => {
    const db = makeDb({
      "WA:governor": { party: "9" }, // not us
      "OR:governor": null, // vacant
    });
    const result = await partyHoldsStateExecutiveInCluster(db, { sequentialId: 7 }, "US", [
      "WA",
      "OR",
    ]);
    expect(result).toBe(false);
  });

  it("returns false for an English non-London UK region (no devolved executive lookup)", async () => {
    // SEE is in `UK_FIRST_MINISTER_REGIONS=false` → `resolveExecutiveOffice`
    // returns null short-circuit before hitting the DB.
    const db = makeDb({});
    const result = await partyHoldsStateExecutiveInCluster(db, { sequentialId: 7 }, "UK", [
      "SEE",
      "EEM",
    ]);
    expect(result).toBe(false);
  });

  it("matches DE ministerPresident office type for Land executives", async () => {
    const db = makeDb({
      "BY:ministerPresident": { party: "7" },
    });
    const result = await partyHoldsStateExecutiveInCluster(db, { sequentialId: 7 }, "DE", [
      "BY",
      "BW",
    ]);
    expect(result).toBe(true);
  });
});

describe("isStateInPriorityRegion", () => {
  it("true when the state is in the cluster", () => {
    expect(
      isStateInPriorityRegion(
        {
          priorityRegion: {
            stateIds: ["CA", "OR"],
            setAtTurn: 0,
            setBy: new ObjectId(),
          },
        },
        "CA"
      )
    ).toBe(true);
  });

  it("false when the state isn't in the cluster", () => {
    expect(
      isStateInPriorityRegion(
        {
          priorityRegion: {
            stateIds: ["CA", "OR"],
            setAtTurn: 0,
            setBy: new ObjectId(),
          },
        },
        "TX"
      )
    ).toBe(false);
  });

  it("false when no cluster is set", () => {
    expect(isStateInPriorityRegion({ priorityRegion: undefined }, "CA")).toBe(false);
  });

  it("false when cluster is empty (all states evicted)", () => {
    expect(
      isStateInPriorityRegion(
        {
          priorityRegion: {
            stateIds: [],
            setAtTurn: 0,
            setBy: new ObjectId(),
          },
        },
        "CA"
      )
    ).toBe(false);
  });
});
