import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Db } from "mongodb";
import {
  expandFrontier,
  isInFrontier,
  getPartyPresenceStates,
  getPartyFrontier,
  canCharacterJoinParty,
} from "@/lib/parties/partyFrontier";

describe("expandFrontier", () => {
  it("includes the presence state itself plus its neighbours", () => {
    const f = expandFrontier("US", ["TN"]);
    expect(f.has("TN")).toBe(true);
    expect(f.has("KY")).toBe(true);
    expect(f.has("CA")).toBe(false);
  });

  it("unions two disconnected clusters without bridging them", () => {
    const f = expandFrontier("US", ["CA", "NY"]);
    expect(f.has("OR")).toBe(true);
    expect(f.has("PA")).toBe(true);
    expect(f.has("TX")).toBe(false);
  });

  it("keeps an isolated state that has no neighbours (HI)", () => {
    expect([...expandFrontier("US", ["HI"])]).toEqual(["HI"]);
  });

  it("keeps a state absent from the adjacency map, with no expansion", () => {
    expect([...expandFrontier("US", ["ZZ"])]).toEqual(["ZZ"]);
  });

  it("returns an empty set for empty presence", () => {
    expect(expandFrontier("US", []).size).toBe(0);
  });

  it("de-dupes repeated inputs", () => {
    const f = expandFrontier("US", ["NY", "NY"]);
    expect(f.has("NY")).toBe(true);
    expect([...f].length).toBe(new Set([...f]).size);
  });
});

describe("isInFrontier", () => {
  const presence = new Set(["NY"]);
  const frontier = expandFrontier("US", presence);

  it("allows a state inside the frontier", () => {
    expect(isInFrontier(presence, frontier, "PA")).toBe(true);
  });

  it("blocks a state outside the frontier", () => {
    expect(isInFrontier(presence, frontier, "CA")).toBe(false);
  });

  it("fails open when the party has no presence anywhere", () => {
    const empty = new Set<string>();
    expect(isInFrontier(empty, expandFrontier("US", empty), "CA")).toBe(true);
  });

  it("fails open for a character with no home state", () => {
    expect(isInFrontier(presence, frontier, null)).toBe(true);
    expect(isInFrontier(presence, frontier, undefined)).toBe(true);
    expect(isInFrontier(presence, frontier, "")).toBe(true);
  });

  it("blocks a California player from a NY/PA/MD party (the motivating case)", () => {
    const p = new Set(["NY", "PA", "MD"]);
    const f = expandFrontier("US", p);
    expect(isInFrontier(p, f, "CA")).toBe(false);
    expect(isInFrontier(p, f, "OH")).toBe(true);
  });
});

const mockCollections: Record<string, Record<string, Mock>> = {};

function setMockCollection(name: string, overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, Mock> = {
    distinct: vi.fn().mockResolvedValue([]),
    find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    aggregate: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    ...overrides,
  };
  mockCollections[name] = defaults;
  return defaults;
}

function makeDb(): Db {
  return {
    collection: vi.fn((name: string) => {
      if (!mockCollections[name]) setMockCollection(name);
      return mockCollections[name];
    }),
  } as unknown as Db;
}

function resetMocks() {
  vi.clearAllMocks();
  for (const k of Object.keys(mockCollections)) delete mockCollections[k];
}

function seedRegions(regions: string[]) {
  setMockCollection("states", {
    find: vi.fn(() => ({
      toArray: vi.fn().mockResolvedValue(regions.map((r) => ({ _id: r }))),
    })),
  });
}

describe("getPartyPresenceStates", () => {
  beforeEach(resetMocks);

  it("unions members, officials and active NPPs", async () => {
    const db = makeDb();
    seedRegions(["NY", "PA", "MD"]);
    setMockCollection("characters", { distinct: vi.fn().mockResolvedValue(["NY"]) });
    setMockCollection("electedOfficials", { distinct: vi.fn().mockResolvedValue(["PA"]) });
    setMockCollection("npps", { distinct: vi.fn().mockResolvedValue(["MD"]) });

    const presence = await getPartyPresenceStates(db, "US", "7");
    expect([...presence].sort()).toEqual(["MD", "NY", "PA"]);
  });

  it("drops any region that is not in this country's region set", async () => {
    const db = makeDb();
    seedRegions(["NY"]);
    // A same-sequentialId party in another country would otherwise leak "LON" in.
    setMockCollection("characters", { distinct: vi.fn().mockResolvedValue(["NY", "LON"]) });

    const presence = await getPartyPresenceStates(db, "US", "1");
    expect([...presence]).toEqual(["NY"]);
  });

  it("scopes every query by the region set rather than by countryId", async () => {
    const db = makeDb();
    seedRegions(["NY"]);
    const npps = setMockCollection("npps", { distinct: vi.fn().mockResolvedValue([]) });

    await getPartyPresenceStates(db, "US", "1");

    const [field, filter] = npps.distinct.mock.calls[0];
    expect(field).toBe("homeState");
    expect(filter).toMatchObject({ party: "1", retiredAt: null, homeState: { $in: ["NY"] } });
    expect(filter).not.toHaveProperty("countryId");
  });

  it("reuses caller-supplied regionIds without re-reading states", async () => {
    const db = makeDb();
    const states = setMockCollection("states");
    setMockCollection("characters", { distinct: vi.fn().mockResolvedValue(["NY"]) });

    await getPartyPresenceStates(db, "US", "1", ["NY", "PA"]);
    expect(states.find).not.toHaveBeenCalled();
  });
});

describe("getPartyFrontier", () => {
  beforeEach(resetMocks);

  it("returns presence and its one-hop expansion", async () => {
    const db = makeDb();
    seedRegions(["NY"]);
    setMockCollection("characters", { distinct: vi.fn().mockResolvedValue(["NY"]) });

    const { presence, frontier } = await getPartyFrontier(db, "US", "1");
    expect([...presence]).toEqual(["NY"]);
    expect(frontier.has("PA")).toBe(true);
    expect(frontier.has("CA")).toBe(false);
  });
});

describe("canCharacterJoinParty", () => {
  beforeEach(resetMocks);

  const party = { sequentialId: 7, name: "Northeast Labor Party" };

  function seedPresence(states: string[], regions: string[]) {
    seedRegions(regions);
    setMockCollection("characters", { distinct: vi.fn().mockResolvedValue(states) });
  }

  it("allows a joiner inside the frontier", async () => {
    const db = makeDb();
    seedPresence(["NY"], ["NY", "PA", "CA"]);
    await expect(canCharacterJoinParty(db, { homeState: "PA" }, party, "US")).resolves.toEqual({
      ok: true,
    });
  });

  it("blocks a joiner outside the frontier with copy free of dashes", async () => {
    const db = makeDb();
    seedPresence(["NY"], ["NY", "PA", "CA"]);
    const result = await canCharacterJoinParty(db, { homeState: "CA" }, party, "US");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Northeast Labor Party");
      expect(result.error).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("allows any joiner into a party with no presence at all", async () => {
    const db = makeDb();
    seedPresence([], ["NY", "CA"]);
    await expect(canCharacterJoinParty(db, { homeState: "CA" }, party, "US")).resolves.toEqual({
      ok: true,
    });
  });

  // Regions get transferred, merged and dissolved. A character left homed in a
  // region this country no longer has cannot be placed, and blocking would lock
  // them out of every party rather than just the distant ones.
  it("allows a joiner homed in a region this country no longer has", async () => {
    const db = makeDb();
    seedPresence(["NY"], ["NY", "PA"]);
    await expect(
      canCharacterJoinParty(db, { homeState: "DISSOLVED" }, party, "US")
    ).resolves.toEqual({ ok: true });
  });

  it("allows a joiner who has no home state", async () => {
    const db = makeDb();
    seedPresence(["NY"], ["NY", "CA"]);
    await expect(canCharacterJoinParty(db, { homeState: "" }, party, "US")).resolves.toEqual({
      ok: true,
    });
  });
});
