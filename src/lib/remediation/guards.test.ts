import { describe, it, expect } from "vitest";
import { makeStrictInMemoryStore } from "@/lib/test-utils/inMemoryStore";
import { evaluateGuards, readTurnLock } from "./guards";
import type { Defect, HealPlan, TouchedDocs } from "./types";

const IDLE = {
  isProcessing: false,
  currentTurn: 100,
  processingPhase: null,
  heartbeatAgeSec: null,
  unknown: false,
};
const BUSY = {
  isProcessing: true,
  currentTurn: 100,
  processingPhase: "economy",
  heartbeatAgeSec: 12,
  unknown: false,
};
/** No gameState document at all. Must refuse, never read as idle. */
const UNREADABLE = {
  isProcessing: false,
  currentTurn: null,
  processingPhase: null,
  heartbeatAgeSec: null,
  unknown: true,
};

function makeDefect(overrides: Partial<Defect> = {}): Defect {
  return {
    id: "AHD-test",
    title: "test defect",
    severity: "P2",
    envs: ["sandbox"],
    idempotent: true,
    seedFix: { status: "not-needed", note: "test fixture" },
    guards: ["turn-lock-free", "max-affected:10"],
    detect: async () => ({ affected: 0, sample: [] }),
    plan: async () => makePlan(),
    apply: async () => ({}),
    verify: async () => ({ ok: true, remaining: 0, notes: [] }),
    ...overrides,
  };
}

function makePlan(overrides: Partial<HealPlan> = {}): HealPlan {
  const touched: TouchedDocs[] = [{ collection: "widgets", ids: ["a"] }];
  return { affected: 1, touched, moneyDelta: 0, summary: "test", ...overrides };
}

function verdict(outcome: ReturnType<typeof evaluateGuards>, guard: string) {
  return outcome.verdicts.find((v) => v.guard === guard);
}

describe("readTurnLock", () => {
  it("reports a live turn", async () => {
    const { db } = makeStrictInMemoryStore({
      gameState: [
        {
          _id: "live",
          isActive: true,
          currentTurn: 7,
          isProcessing: true,
          processingPhase: "elections",
          processingHeartbeatAt: new Date("2026-08-08T11:59:00Z"),
        },
      ],
    });
    const lock = await readTurnLock(db, new Date("2026-08-08T12:00:00Z"));
    expect(lock).toMatchObject({
      isProcessing: true,
      currentTurn: 7,
      processingPhase: "elections",
    });
    expect(lock.heartbeatAgeSec).toBe(60);
  });

  it('prefers the _id:"current" singleton the app itself reads', async () => {
    // The real databases carry isActive:false on this document, so a guard
    // that queries {isActive:true} matches nothing and fails open.
    const { db } = makeStrictInMemoryStore({
      gameState: [{ _id: "current", isActive: false, currentTurn: 412, isProcessing: true }],
    });
    const lock = await readTurnLock(db, new Date());
    expect(lock).toMatchObject({ currentTurn: 412, isProcessing: true, unknown: false });
  });

  it("falls back to the legacy isActive shape", async () => {
    const { db } = makeStrictInMemoryStore({
      gameState: [{ _id: "legacy", isActive: true, currentTurn: 7, isProcessing: false }],
    });
    expect(await readTurnLock(db, new Date())).toMatchObject({ currentTurn: 7, unknown: false });
  });

  it("reports unknown, NOT idle, when there is no gameState at all", async () => {
    const { db } = makeStrictInMemoryStore({ gameState: [] });
    expect(await readTurnLock(db, new Date())).toMatchObject({
      isProcessing: false,
      currentTurn: null,
      unknown: true,
    });
  });
});

describe("evaluateGuards", () => {
  it("passes a clean plan on an idle world", () => {
    const outcome = evaluateGuards({ defect: makeDefect(), plan: makePlan(), turnLock: IDLE });
    expect(outcome.ok).toBe(true);
  });

  it("refuses when the turn state cannot be read at all", () => {
    // Fail closed. An unreadable lock is not an idle one, and this exact bug
    // (wrong gameState key) silently disabled the guard on the real databases.
    const outcome = evaluateGuards({
      defect: makeDefect(),
      plan: makePlan(),
      turnLock: UNREADABLE,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.refusal).toContain("UNKNOWN whether a turn is running");
  });

  it("refuses while a turn is in flight", () => {
    const outcome = evaluateGuards({ defect: makeDefect(), plan: makePlan(), turnLock: BUSY });
    expect(outcome.ok).toBe(false);
    expect(outcome.refusal).toContain("turn in flight");
  });

  it("refuses a plan over the cap", () => {
    const outcome = evaluateGuards({
      defect: makeDefect(),
      plan: makePlan({ affected: 11 }),
      turnLock: IDLE,
    });
    expect(outcome.ok).toBe(false);
    expect(verdict(outcome, "max-affected:10")?.detail).toContain("exceeds cap");
  });

  it("refuses a heal that changes total money", () => {
    const outcome = evaluateGuards({
      defect: makeDefect(),
      plan: makePlan({ moneyDelta: -250 }),
      turnLock: IDLE,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.refusal).toContain("does not declare mintsMoney");
  });

  it("allows a money delta when the defect declares mintsMoney", () => {
    const outcome = evaluateGuards({
      defect: makeDefect({ mintsMoney: true }),
      plan: makePlan({ moneyDelta: -250 }),
      turnLock: IDLE,
    });
    expect(outcome.ok).toBe(true);
  });

  it("applies money conservation even when the defect does not list the guard", () => {
    const outcome = evaluateGuards({
      defect: makeDefect({ guards: ["max-affected:10"] }),
      plan: makePlan({ moneyDelta: 5 }),
      turnLock: IDLE,
    });
    expect(outcome.ok).toBe(false);
  });

  it("rejects an unknown guard name rather than ignoring it", () => {
    const outcome = evaluateGuards({
      defect: makeDefect({ guards: ["max-affected:10", "not-a-guard" as never] }),
      plan: makePlan(),
      turnLock: IDLE,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.refusal).toContain("unknown guard");
  });

  describe("code gate", () => {
    const gated = makeDefect({ codeFix: { requiredCommit: "abc1234", pr: 4042 } });

    it("passes when the defect pins no commit", () => {
      const outcome = evaluateGuards({ defect: makeDefect(), plan: makePlan(), turnLock: IDLE });
      expect(verdict(outcome, "code-gate")?.ok).toBe(true);
    });

    it("refuses a pinned defect with no gate verdict supplied", () => {
      const outcome = evaluateGuards({ defect: gated, plan: makePlan(), turnLock: IDLE });
      expect(outcome.ok).toBe(false);
      expect(outcome.refusal).toContain("re-corrupts on the next turn");
    });

    it("refuses when the fix is not deployed to the target env", () => {
      const outcome = evaluateGuards({
        defect: gated,
        plan: makePlan(),
        turnLock: IDLE,
        codeGate: { ok: false, detail: "abc1234 is not an ancestor of deployed def5678" },
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.refusal).toContain("not an ancestor");
    });

    it("passes when the fix is deployed", () => {
      const outcome = evaluateGuards({
        defect: gated,
        plan: makePlan(),
        turnLock: IDLE,
        codeGate: { ok: true, detail: "abc1234 is an ancestor of deployed def5678" },
      });
      expect(outcome.ok).toBe(true);
    });

    it("records an override instead of hiding it", () => {
      const outcome = evaluateGuards({
        defect: gated,
        plan: makePlan(),
        turnLock: IDLE,
        codeGate: {
          ok: false,
          detail: "not deployed",
          override: { reason: "player-visible now, fix lands in an hour", operator: "mason" },
        },
      });
      expect(outcome.ok).toBe(true);
      expect(verdict(outcome, "code-gate")?.detail).toContain("OVERRIDDEN by mason");
    });
  });
});
