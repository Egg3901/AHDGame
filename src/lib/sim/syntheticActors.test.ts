import { describe, expect, it } from "vitest";
import {
  SIM_ACTOR_MODES,
  SIM_ACTOR_USERNAME_PREFIX,
  buildSyntheticActorPlan,
  parseSimActorMode,
  snapshotActorPopulation,
  syntheticActorCounts,
} from "./syntheticActors";
import { SYNTHETIC_ACTOR_ROLES, syntheticObjectIdHex } from "./actorCoverage";

describe("parseSimActorMode", () => {
  it("defaults an omitted flag to pure NPP autonomy", () => {
    expect(parseSimActorMode(undefined)).toBe("pure-npp");
  });

  it("accepts both known modes", () => {
    expect(parseSimActorMode("pure-npp")).toBe("pure-npp");
    expect(parseSimActorMode("synthetic")).toBe("synthetic");
  });

  it("throws on a typo instead of silently running the wrong population", () => {
    expect(() => parseSimActorMode("synthetc")).toThrow("--actors must be one of");
    expect(() => parseSimActorMode("")).toThrow("--actors must be one of");
    expect(() => parseSimActorMode("ALL")).toThrow("--actors must be one of");
  });

  it("advertises exactly the modes the registry evaluates", () => {
    expect([...SIM_ACTOR_MODES]).toEqual(["pure-npp", "synthetic"]);
  });
});

describe("syntheticObjectIdHex", () => {
  it("is deterministic by seed and role", () => {
    expect(syntheticObjectIdHex("s1", "character:us-president")).toBe(
      syntheticObjectIdHex("s1", "character:us-president")
    );
  });

  it("differs across seeds and across roles", () => {
    const a = syntheticObjectIdHex("s1", "character:us-president");
    expect(syntheticObjectIdHex("s2", "character:us-president")).not.toBe(a);
    expect(syntheticObjectIdHex("s1", "character:crisis-decider")).not.toBe(a);
  });

  it("returns 24 lowercase hex chars (a valid ObjectId string)", () => {
    expect(syntheticObjectIdHex("s1", "character:us-president")).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe("buildSyntheticActorPlan", () => {
  it("covers every registered role exactly once", () => {
    const plan = buildSyntheticActorPlan("probe-seed");
    expect(plan.actors.map((a) => a.role)).toEqual([...SYNTHETIC_ACTOR_ROLES]);
    expect(plan.planVersion).toBe(1);
    expect(plan.seed).toBe("probe-seed");
  });

  it("is byte-stable for the same seed (re-seeding is idempotent)", () => {
    const a = buildSyntheticActorPlan("probe-seed");
    const b = buildSyntheticActorPlan("probe-seed");
    expect(b).toEqual(a);
  });

  it("gives every actor a distinct character id, user id, and sandbox username", () => {
    const plan = buildSyntheticActorPlan("probe-seed");
    expect(new Set(plan.actors.map((a) => a.characterIdHex)).size).toBe(plan.actors.length);
    expect(new Set(plan.actors.map((a) => a.userIdHex)).size).toBe(plan.actors.length);
    for (const actor of plan.actors) {
      expect(actor.username.startsWith(SIM_ACTOR_USERNAME_PREFIX)).toBe(true);
      expect(actor.username).toContain("probe-seed");
      expect(actor.characterIdHex).toMatch(/^[0-9a-f]{24}$/);
      expect(actor.userIdHex).toMatch(/^[0-9a-f]{24}$/);
    }
  });

  it("counts one character and one user per planned actor", () => {
    const plan = buildSyntheticActorPlan("probe-seed");
    expect(syntheticActorCounts(plan)).toEqual({
      characters: SYNTHETIC_ACTOR_ROLES.length,
      users: SYNTHETIC_ACTOR_ROLES.length,
    });
  });
});

describe("snapshotActorPopulation", () => {
  it("defaults turn-derived evidence counters to zero", () => {
    const snapshot = snapshotActorPopulation({
      mode: "pure-npp",
      preset: "1953-default",
      characters: 0,
      users: 0,
      syntheticCharacters: 0,
      syntheticUsers: 0,
    });
    expect(snapshot).toMatchObject({
      mode: "pure-npp",
      preset: "1953-default",
      statePartyCandidates: 0,
      crisisDecidedInteractions: 0,
      wealthListRows: 0,
      playerFoundedCorps: 0,
    });
  });

  it("carries caller-supplied live counts through", () => {
    const snapshot = snapshotActorPopulation({
      mode: "synthetic",
      preset: "1953-default",
      characters: 7,
      users: 7,
      syntheticCharacters: 7,
      syntheticUsers: 7,
      statePartyCandidates: 3,
      crisisDecidedInteractions: 1,
      wealthListRows: 2,
      playerFoundedCorps: 2,
    });
    expect(snapshot.statePartyCandidates).toBe(3);
    expect(snapshot.playerFoundedCorps).toBe(2);
  });
});
