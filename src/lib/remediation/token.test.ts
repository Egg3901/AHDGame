import { describe, it, expect } from "vitest";
import { makeStrictInMemoryStore } from "@/lib/test-utils/inMemoryStore";
import {
  checkToken,
  consumeToken,
  issueToken,
  planDigest,
  readTurnNumber,
  stateFingerprint,
} from "./token";
import type { HealPlan } from "./types";

function makePlan(overrides: Partial<HealPlan> = {}): HealPlan {
  return {
    affected: 2,
    touched: [{ collection: "widgets", ids: ["a", "b"] }],
    moneyDelta: 0,
    summary: "delete 2 widgets",
    ...overrides,
  };
}

describe("planDigest", () => {
  it("ignores the order ids arrive in", () => {
    const a = makePlan({ touched: [{ collection: "widgets", ids: ["a", "b"] }] });
    const b = makePlan({ touched: [{ collection: "widgets", ids: ["b", "a"] }] });
    expect(planDigest(a)).toBe(planDigest(b));
  });

  it("merges duplicate collection entries", () => {
    const split = makePlan({
      touched: [
        { collection: "widgets", ids: ["a"] },
        { collection: "widgets", ids: ["b"] },
      ],
    });
    expect(planDigest(split)).toBe(planDigest(makePlan()));
  });

  it("changes when the affected set changes", () => {
    const extra = makePlan({
      affected: 3,
      touched: [{ collection: "widgets", ids: ["a", "b", "c"] }],
    });
    expect(planDigest(extra)).not.toBe(planDigest(makePlan()));
  });

  it("changes when the money delta changes", () => {
    expect(planDigest(makePlan({ moneyDelta: 1 }))).not.toBe(planDigest(makePlan()));
  });
});

describe("stateFingerprint", () => {
  const base = {
    defectId: "AHD-1",
    env: "prod" as const,
    affected: 2,
    planDigest: "digest",
    turnNumber: 100,
  };

  it("binds to the turn number", () => {
    expect(stateFingerprint({ ...base, turnNumber: 101 })).not.toBe(stateFingerprint(base));
  });

  it("binds to the env", () => {
    expect(stateFingerprint({ ...base, env: "sandbox" })).not.toBe(stateFingerprint(base));
  });

  it("binds to the defect", () => {
    expect(stateFingerprint({ ...base, defectId: "AHD-2" })).not.toBe(stateFingerprint(base));
  });
});

describe("readTurnNumber", () => {
  it("reads the active gameState", async () => {
    const { db } = makeStrictInMemoryStore({
      gameState: [
        { _id: "old", isActive: false, currentTurn: 5 },
        { _id: "live", isActive: true, currentTurn: 42 },
      ],
    });
    expect(await readTurnNumber(db)).toBe(42);
  });

  it("returns null when there is no active world", async () => {
    const { db } = makeStrictInMemoryStore({ gameState: [] });
    expect(await readTurnNumber(db)).toBeNull();
  });
});

describe("checkToken", () => {
  const now = new Date("2026-08-08T12:00:00Z");

  async function issued(plan = makePlan(), turnNumber: number | null = 100) {
    const { db } = makeStrictInMemoryStore({});
    const token = await issueToken(db, {
      defectId: "AHD-1",
      env: "prod",
      plan,
      turnNumber,
      operator: "tester",
      now,
    });
    return { db, token };
  }

  it("accepts a token against the state it was minted for", async () => {
    const { db, token } = await issued();
    const check = await checkToken(db, {
      tokenId: token._id,
      defectId: "AHD-1",
      env: "prod",
      freshPlan: makePlan(),
      turnNumber: 100,
      now,
    });
    expect(check.ok).toBe(true);
  });

  it("refuses when a turn ticked between plan and apply", async () => {
    const { db, token } = await issued();
    const check = await checkToken(db, {
      tokenId: token._id,
      defectId: "AHD-1",
      env: "prod",
      freshPlan: makePlan(),
      turnNumber: 101,
      now,
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("world state moved");
  });

  it("refuses when the affected set changed under it", async () => {
    const { db, token } = await issued();
    const check = await checkToken(db, {
      tokenId: token._id,
      defectId: "AHD-1",
      env: "prod",
      freshPlan: makePlan({
        affected: 3,
        touched: [{ collection: "widgets", ids: ["a", "b", "c"] }],
      }),
      turnNumber: 100,
      now,
    });
    expect(check.ok).toBe(false);
  });

  it("refuses a token issued for another env", async () => {
    const { db, token } = await issued();
    const check = await checkToken(db, {
      tokenId: token._id,
      defectId: "AHD-1",
      env: "sandbox",
      freshPlan: makePlan(),
      turnNumber: 100,
      now,
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("env prod");
  });

  it("refuses an expired token", async () => {
    const { db, token } = await issued();
    const check = await checkToken(db, {
      tokenId: token._id,
      defectId: "AHD-1",
      env: "prod",
      freshPlan: makePlan(),
      turnNumber: 100,
      now: new Date(now.getTime() + 11 * 60 * 1000),
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("expired");
  });

  it("refuses an unknown token", async () => {
    const { db } = await issued();
    const check = await checkToken(db, {
      tokenId: "heal_nope",
      defectId: "AHD-1",
      env: "prod",
      freshPlan: makePlan(),
      turnNumber: 100,
      now,
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("unknown confirm token");
  });

  it("is one-time use", async () => {
    const { db, token } = await issued();
    expect(await consumeToken(db, token._id, "run_1", now)).toBe(true);
    expect(await consumeToken(db, token._id, "run_2", now)).toBe(false);

    const check = await checkToken(db, {
      tokenId: token._id,
      defectId: "AHD-1",
      env: "prod",
      freshPlan: makePlan(),
      turnNumber: 100,
      now,
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("already consumed");
  });
});
