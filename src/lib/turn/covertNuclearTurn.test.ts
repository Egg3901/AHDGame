import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { applyCovertNuclearTurn, CRACKDOWN_APPROVAL_HIT } from "./covertNuclearTurn";
import { CRACKDOWN_TENSION_SPIKE } from "@/lib/military/covertNuclear";

// News and tension are world side effects; the turn maths is what this file
// proves, so both are spied rather than run.
vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn() }));
vi.mock("@/lib/coldwar/tension", () => ({ applyTensionEvent: vi.fn() }));

const { createSystemNewsPost } = await import("@/lib/news");
const { applyTensionEvent } = await import("@/lib/coldwar/tension");

interface World {
  covert: Record<string, unknown> | null;
  appropriation: { balance: number; encumbered?: number };
  covertWrites: Record<string, unknown>[];
  approvalIncs: Record<string, unknown>[];
}

/**
 * Mirrors the nuclearProductionTurn test's stub-db style: emulate only the
 * filters the module actually issues. The federalBudget stub honours the
 * $expr guard `debitAppropriation` uses, so a starved pot refuses the spend
 * exactly like the real collection.
 */
function stubDb(w: World): Db {
  return {
    collection: (name: string) => {
      if (name === "covertNuclearPrograms") {
        return {
          findOne: async () => w.covert,
          updateOne: async (_f: unknown, u: { $set: Record<string, unknown> }) => {
            w.covertWrites.push(u.$set);
            return { matchedCount: 1, modifiedCount: 1 };
          },
        };
      }
      if (name === "federalBudget") {
        return {
          findOne: async () => ({
            countryId: "DD",
            defenseAppropriation: {
              balance: w.appropriation.balance,
              encumbered: w.appropriation.encumbered ?? 0,
              accruedThroughTurn: 0,
              arrearsRatio: 0,
            },
          }),
          updateOne: async (f: Record<string, unknown>, u: Record<string, unknown>) => {
            const inc = (u.$inc ?? {}) as Record<string, number>;
            const delta = inc["defenseAppropriation.balance"] ?? 0;
            if (f.$expr) {
              const available = w.appropriation.balance - (w.appropriation.encumbered ?? 0);
              if (available < -delta) return { matchedCount: 0, modifiedCount: 0 };
            }
            w.appropriation.balance += delta;
            return { matchedCount: 1, modifiedCount: 1 };
          },
        };
      }
      if (name === "governmentApprovals") {
        return {
          updateOne: async (_f: unknown, u: Record<string, unknown>) => {
            w.approvalIncs.push(u.$inc as Record<string, unknown>);
            return { matchedCount: 1, modifiedCount: 1 };
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;
}

const covert = (over: Record<string, unknown> = {}) => ({
  _id: "DD",
  stage: 1,
  progress: 10,
  funding: "steady",
  suspicion: 20,
  exposureCount: 0,
  startedTurn: 5,
  completed: false,
  updatedAt: new Date(),
  ...over,
});

const GATES = { coldWarEnabled: true };

describe("applyCovertNuclearTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // roll = 0.99: no discovery unless a test forces it.
    vi.spyOn(Math, "random").mockReturnValue(0.99);
  });
  afterEach(() => vi.restoreAllMocks());

  it("advances a funded programme and draws the cost from the appropriation", async () => {
    const w: World = {
      covert: covert(),
      appropriation: { balance: 10_000 },
      covertWrites: [],
      approvalIncs: [],
    };
    const r = await applyCovertNuclearTurn(stubDb(w), "DD", 42, GATES);
    expect(r).toEqual({ spent: 260, discovered: false });
    expect(w.appropriation.balance).toBe(9_740);
    // Steady: +2 progress, +0.5 suspicion.
    expect(w.covertWrites[0]).toMatchObject({ stage: 1, progress: 12, suspicion: 20.5 });
  });

  it("skips without a write for a country that never opened the programme", async () => {
    const w: World = {
      covert: null,
      appropriation: { balance: 10_000 },
      covertWrites: [],
      approvalIncs: [],
    };
    const r = await applyCovertNuclearTurn(stubDb(w), "DD", 42, GATES);
    expect(r).toEqual({ spent: 0, discovered: false });
    expect(w.covertWrites).toHaveLength(0);
    expect(w.appropriation.balance).toBe(10_000);
  });

  it("does nothing while the Cold War subsystem is off", async () => {
    const w: World = {
      covert: covert(),
      appropriation: { balance: 10_000 },
      covertWrites: [],
      approvalIncs: [],
    };
    const r = await applyCovertNuclearTurn(stubDb(w), "DD", 42, { coldWarEnabled: false });
    expect(r).toEqual({ spent: 0, discovered: false });
    expect(w.covertWrites).toHaveLength(0);
  });

  it("cools instead of progressing when the budget cannot cover the funding level", async () => {
    const w: World = {
      covert: covert({ funding: "crash", suspicion: 40 }),
      appropriation: { balance: 100 },
      covertWrites: [],
      approvalIncs: [],
    };
    const r = await applyCovertNuclearTurn(stubDb(w), "DD", 42, GATES);
    expect(r).toEqual({ spent: 0, discovered: false });
    expect(w.appropriation.balance).toBe(100);
    // An unfunded turn cools by the idle rate and moves nothing else.
    expect(w.covertWrites[0]).toMatchObject({ stage: 1, progress: 10, suspicion: 39.7 });
  });

  it("sizes the turn against the uncommitted balance, not the raw one", async () => {
    const w: World = {
      covert: covert(),
      appropriation: { balance: 400, encumbered: 300 },
      covertWrites: [],
      approvalIncs: [],
    };
    const r = await applyCovertNuclearTurn(stubDb(w), "DD", 42, GATES);
    // 100 uncommitted cannot cover steady's 260; the turn is unfunded.
    expect(r).toEqual({ spent: 0, discovered: false });
    expect(w.appropriation.balance).toBe(400);
  });

  it("applies the full crackdown on discovery: tension, news, approval hit", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const w: World = {
      covert: covert({ funding: "crash", suspicion: 60, stage: 3, progress: 30 }),
      appropriation: { balance: 10_000 },
      covertWrites: [],
      approvalIncs: [],
    };
    const r = await applyCovertNuclearTurn(stubDb(w), "DD", 42, GATES);
    expect(r.discovered).toBe(true);
    // The crackdown costs a stage and the one in progress, and kills funding.
    expect(w.covertWrites[0]).toMatchObject({
      stage: 2,
      progress: 0,
      funding: "none",
      suspicion: 30,
      exposureCount: 1,
    });
    expect(applyTensionEvent).toHaveBeenCalledWith(
      expect.anything(),
      42,
      "crisis",
      "Soviet inspectors raid East German facilities",
      CRACKDOWN_TENSION_SPIKE
    );
    expect(w.approvalIncs[0]).toEqual({ approvalRating: CRACKDOWN_APPROVAL_HIT });
    expect(createSystemNewsPost).toHaveBeenCalledWith(
      // The public learns there was SOMETHING, never what stage it reached.
      expect.not.stringMatching(/bomb|nuclear|enrich|warhead|device/i),
      "executive",
      expect.objectContaining({ title: expect.any(String) })
    );
  });

  it("touches no world surface on a quiet funded turn", async () => {
    const w: World = {
      covert: covert(),
      appropriation: { balance: 10_000 },
      covertWrites: [],
      approvalIncs: [],
    };
    await applyCovertNuclearTurn(stubDb(w), "DD", 42, GATES);
    expect(applyTensionEvent).not.toHaveBeenCalled();
    expect(createSystemNewsPost).not.toHaveBeenCalled();
    expect(w.approvalIncs).toHaveLength(0);
  });
});
