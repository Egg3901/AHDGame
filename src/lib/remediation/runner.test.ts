import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { makeStrictInMemoryStore, type Doc } from "@/lib/test-utils/inMemoryStore";

// widgets in these fixtures use string _ids ("w1"...), not ObjectIds.
type Widget = { _id: string } & Record<string, unknown>;
import { HEAL_BACKUPS_COLLECTION } from "./backup";
import {
  HEAL_RUNS_COLLECTION,
  listHistory,
  runApply,
  runDetect,
  runPlan,
  runRollback,
  runVerify,
} from "./runner";
import type { Defect, HealPlan, HealResult, HealRun } from "./types";

/**
 * The fixture defect deletes `widgets` rows marked `bad: true`. Small enough to
 * reason about, real enough to exercise snapshot, rollback and verify.
 */
function makeFixture(overrides: Partial<Defect> = {}): Defect {
  return {
    id: "AHD-fixture",
    title: "bad widgets",
    severity: "P2",
    envs: ["dev", "sandbox", "prod"],
    idempotent: true,
    seedFix: { status: "not-needed", note: "test fixture" },
    guards: ["turn-lock-free", "max-affected:10"],
    detect: async (db) => {
      const bad = await db.collection<Widget>("widgets").find({ bad: true }).toArray();
      return { affected: bad.length, sample: bad.slice(0, 5) };
    },
    plan: async (db) => {
      const bad = await db.collection<Widget>("widgets").find({ bad: true }).toArray();
      return {
        affected: bad.length,
        touched: [{ collection: "widgets", ids: bad.map((w) => String(w._id)) }],
        moneyDelta: 0,
        summary: `delete ${bad.length} bad widget(s)`,
      };
    },
    apply: async (db, plan: HealPlan): Promise<HealResult> => {
      const ids = plan.touched[0]?.ids ?? [];
      const res = await db.collection<Widget>("widgets").deleteMany({ _id: { $in: ids } });
      return { documentsDeleted: res.deletedCount };
    },
    verify: async (db) => {
      const remaining = await db.collection<Widget>("widgets").countDocuments({ bad: true });
      return { ok: remaining === 0, remaining, notes: [`${remaining} bad widget(s) left`] };
    },
    ...overrides,
  };
}

const IDLE_WORLD = [{ _id: "live", isActive: true, currentTurn: 100, isProcessing: false }];

function seed(extra: Record<string, Doc[]> = {}) {
  return makeStrictInMemoryStore({
    gameState: IDLE_WORLD,
    widgets: [
      { _id: "w1", bad: true, value: 1 },
      { _id: "w2", bad: true, value: 2 },
      { _id: "w3", bad: false, value: 3 },
    ],
    ...extra,
  });
}

const OPERATOR = "tester";

describe("runDetect", () => {
  it("counts bad rows without writing", async () => {
    const { db, cols } = seed();
    const result = await runDetect(db, makeFixture(), { env: "sandbox" });
    expect(result.affected).toBe(2);
    expect(cols.widgets).toHaveLength(3);
  });

  it("refuses an env the defect is not registered for", async () => {
    const { db } = seed();
    await expect(
      runDetect(db, makeFixture({ envs: ["sandbox"] }), { env: "prod" })
    ).rejects.toThrow(/not registered for env "prod"/);
  });
});

describe("runPlan", () => {
  it("mints a token and writes nothing else", async () => {
    const { db, cols } = seed();
    const outcome = await runPlan(db, makeFixture(), { env: "sandbox", operator: OPERATOR });
    expect(outcome.plan.affected).toBe(2);
    expect(outcome.token).not.toBeNull();
    expect(cols.widgets).toHaveLength(3);
  });

  it("withholds a token when there is nothing to heal", async () => {
    const { db } = makeStrictInMemoryStore({
      gameState: IDLE_WORLD,
      widgets: [{ _id: "w3", bad: false }],
    });
    const outcome = await runPlan(db, makeFixture(), { env: "sandbox", operator: OPERATOR });
    expect(outcome.token).toBeNull();
    expect(outcome.tokenWithheld).toContain("nothing to heal");
  });

  it("withholds a token when a guard already fails", async () => {
    const { db } = makeStrictInMemoryStore({
      gameState: [{ _id: "live", isActive: true, currentTurn: 100, isProcessing: true }],
      widgets: [{ _id: "w1", bad: true }],
    });
    const outcome = await runPlan(db, makeFixture(), { env: "sandbox", operator: OPERATOR });
    expect(outcome.token).toBeNull();
    expect(outcome.tokenWithheld).toContain("turn in flight");
  });
});

describe("runApply", () => {
  let store: ReturnType<typeof seed>;
  let db: Db;
  const fixture = makeFixture();

  beforeEach(() => {
    store = seed();
    db = store.db;
  });

  async function planned(defect = fixture, env: "sandbox" | "prod" = "sandbox") {
    const outcome = await runPlan(db, defect, { env, operator: OPERATOR });
    if (!outcome.token) throw new Error(`no token issued: ${outcome.tokenWithheld}`);
    return outcome.token.id;
  }

  it("heals, verifies and records a run", async () => {
    const tokenId = await planned();
    const result = await runApply(db, fixture, { env: "sandbox", tokenId, operator: OPERATOR });

    expect(result.ok).toBe(true);
    expect(store.cols.widgets.map((w) => w._id)).toEqual(["w3"]);

    const runs = store.cols[HEAL_RUNS_COLLECTION] as unknown as HealRun[];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      defectId: "AHD-fixture",
      env: "sandbox",
      status: "succeeded",
      planAffected: 2,
      backupCount: 2,
      operator: OPERATOR,
    });
    expect(runs[0].verify?.ok).toBe(true);
  });

  it("snapshots every touched document before writing", async () => {
    const tokenId = await planned();
    await runApply(db, fixture, { env: "sandbox", tokenId, operator: OPERATOR });

    const backups = store.cols[HEAL_BACKUPS_COLLECTION];
    expect(backups).toHaveLength(2);
    expect(backups.map((b) => (b as { docId: string }).docId).sort()).toEqual(["w1", "w2"]);
    // The snapshot must hold the PRE-heal document, not a stub.
    expect((backups[0] as { doc: Doc }).doc).toMatchObject({ _id: "w1", bad: true, value: 1 });
  });

  it("refuses without a valid token", async () => {
    const result = await runApply(db, fixture, {
      env: "sandbox",
      tokenId: "heal_fabricated",
      operator: OPERATOR,
    });
    expect(result.ok).toBe(false);
    expect(result.refusal).toContain("unknown confirm token");
    expect(store.cols.widgets).toHaveLength(3);
  });

  it("refuses when the world moved between plan and apply", async () => {
    const tokenId = await planned();
    // A turn ticks.
    store.cols.gameState[0].currentTurn = 101;

    const result = await runApply(db, fixture, { env: "sandbox", tokenId, operator: OPERATOR });
    expect(result.ok).toBe(false);
    expect(result.refusal).toContain("world state moved");
    expect(store.cols.widgets).toHaveLength(3);
  });

  it("refuses when the affected set grew under the approved plan", async () => {
    const tokenId = await planned();
    store.cols.widgets.push({ _id: "w4", bad: true, value: 4 });

    const result = await runApply(db, fixture, { env: "sandbox", tokenId, operator: OPERATOR });
    expect(result.ok).toBe(false);
    expect(result.refusal).toContain("world state moved");
    expect(store.cols.widgets).toHaveLength(4);
  });

  it("refuses a second apply on the same token", async () => {
    const tokenId = await planned();
    await runApply(db, fixture, { env: "sandbox", tokenId, operator: OPERATOR });

    const replay = await runApply(db, fixture, { env: "sandbox", tokenId, operator: OPERATOR });
    expect(replay.ok).toBe(false);
    // The world also moved (nothing left to heal), so either refusal is correct;
    // what matters is that no second run wrote anything.
    expect(store.cols[HEAL_RUNS_COLLECTION]).toHaveLength(1);
  });

  it("refuses prod without confirmProd", async () => {
    const tokenId = await planned(fixture, "prod");
    const result = await runApply(db, fixture, { env: "prod", tokenId, operator: OPERATOR });
    expect(result.ok).toBe(false);
    expect(result.refusal).toContain("confirmProd");
    expect(store.cols.widgets).toHaveLength(3);
  });

  it("heals prod when confirmProd is set", async () => {
    const tokenId = await planned(fixture, "prod");
    const result = await runApply(db, fixture, {
      env: "prod",
      tokenId,
      operator: OPERATOR,
      confirmProd: true,
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a pinned defect when the code fix is not deployed", async () => {
    const gated = makeFixture({ codeFix: { requiredCommit: "abc1234" } });
    const outcome = await runPlan(db, gated, {
      env: "sandbox",
      operator: OPERATOR,
      codeGate: { ok: true, detail: "deployed" },
    });
    expect(outcome.token).not.toBeNull();

    const result = await runApply(db, gated, {
      env: "sandbox",
      tokenId: outcome.token!.id,
      operator: OPERATOR,
      codeGate: { ok: false, detail: "abc1234 not deployed to sandbox" },
    });
    expect(result.ok).toBe(false);
    expect(result.refusal).toContain("not deployed");
    expect(store.cols.widgets).toHaveLength(3);
  });

  it("marks the run failed when verify still finds bad rows", async () => {
    // apply() only deletes one of the two, so the detector stays non-zero.
    const halfHearted = makeFixture({
      apply: async (innerDb, plan) => {
        const first = plan.touched[0]?.ids[0];
        const res = await innerDb.collection<Widget>("widgets").deleteMany({ _id: first });
        return { documentsDeleted: res.deletedCount };
      },
    });
    const tokenId = await planned(halfHearted);
    const result = await runApply(db, halfHearted, {
      env: "sandbox",
      tokenId,
      operator: OPERATOR,
    });

    expect(result.ok).toBe(false);
    expect(result.refusal).toContain("verify failed");
    const runs = store.cols[HEAL_RUNS_COLLECTION] as unknown as HealRun[];
    expect(runs[0].status).toBe("failed");
  });

  it("records a run as failed when apply throws, without losing the snapshot", async () => {
    const exploding = makeFixture({
      apply: async () => {
        throw new Error("boom");
      },
    });
    const tokenId = await planned(exploding);
    const result = await runApply(db, exploding, { env: "sandbox", tokenId, operator: OPERATOR });

    expect(result.ok).toBe(false);
    expect(result.refusal).toBe("boom");
    const runs = store.cols[HEAL_RUNS_COLLECTION] as unknown as HealRun[];
    expect(runs[0].status).toBe("failed");
    expect(store.cols[HEAL_BACKUPS_COLLECTION]).toHaveLength(2);
  });
});

describe("runRollback", () => {
  it("restores the documents a heal deleted", async () => {
    const store = seed();
    const fixture = makeFixture();
    const outcome = await runPlan(store.db, fixture, { env: "sandbox", operator: OPERATOR });
    const applied = await runApply(store.db, fixture, {
      env: "sandbox",
      tokenId: outcome.token!.id,
      operator: OPERATOR,
    });
    expect(store.cols.widgets).toHaveLength(1);

    const rolled = await runRollback(store.db, applied.runId!);
    expect(rolled.ok).toBe(true);
    expect(rolled.restored).toBe(2);
    expect(store.cols.widgets.map((w) => w._id).sort()).toEqual(["w1", "w2", "w3"]);
    // Restored verbatim, not as a stub.
    expect(store.cols.widgets.find((w) => w._id === "w1")).toMatchObject({ bad: true, value: 1 });

    const runs = store.cols[HEAL_RUNS_COLLECTION] as unknown as HealRun[];
    expect(runs[0].status).toBe("rolled-back");
  });

  it("refuses to roll back twice", async () => {
    const store = seed();
    const fixture = makeFixture();
    const outcome = await runPlan(store.db, fixture, { env: "sandbox", operator: OPERATOR });
    const applied = await runApply(store.db, fixture, {
      env: "sandbox",
      tokenId: outcome.token!.id,
      operator: OPERATOR,
    });
    await runRollback(store.db, applied.runId!);

    const again = await runRollback(store.db, applied.runId!);
    expect(again.ok).toBe(false);
    expect(again.detail).toContain("already rolled back");
  });

  it("reports undeclared inserts as still present", async () => {
    const store = seed();
    const inserting = makeFixture({
      apply: async (db, plan) => {
        const ids = plan.touched[0]?.ids ?? [];
        await db.collection<Widget>("widgets").deleteMany({ _id: { $in: ids } });
        await db
          .collection<Widget>("widgets")
          .insertOne({ _id: "w9", bad: false, replacement: true });
        // Deliberately omits insertedIds.
        return { documentsDeleted: ids.length, documentsInserted: 1 };
      },
    });
    const outcome = await runPlan(store.db, inserting, { env: "sandbox", operator: OPERATOR });
    const applied = await runApply(store.db, inserting, {
      env: "sandbox",
      tokenId: outcome.token!.id,
      operator: OPERATOR,
    });

    const rolled = await runRollback(store.db, applied.runId!);
    expect(rolled.notes.join(" ")).toContain("STILL PRESENT");
    expect(store.cols.widgets.some((w) => w._id === "w9")).toBe(true);
  });

  it("deletes inserts the result declared", async () => {
    const store = seed();
    const inserting = makeFixture({
      apply: async (db, plan) => {
        const ids = plan.touched[0]?.ids ?? [];
        await db.collection<Widget>("widgets").deleteMany({ _id: { $in: ids } });
        await db
          .collection<Widget>("widgets")
          .insertOne({ _id: "w9", bad: false, replacement: true });
        return {
          documentsDeleted: ids.length,
          documentsInserted: 1,
          insertedIds: [{ collection: "widgets", ids: ["w9"] }],
        };
      },
    });
    const outcome = await runPlan(store.db, inserting, { env: "sandbox", operator: OPERATOR });
    const applied = await runApply(store.db, inserting, {
      env: "sandbox",
      tokenId: outcome.token!.id,
      operator: OPERATOR,
    });

    const rolled = await runRollback(store.db, applied.runId!);
    expect(rolled.deleted).toBe(1);
    expect(store.cols.widgets.some((w) => w._id === "w9")).toBe(false);
  });

  it("reports an unknown run rather than throwing", async () => {
    const { db } = seed();
    const result = await runRollback(db, "run_nope");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("unknown run");
  });
});

describe("runVerify and listHistory", () => {
  it("verifies a healthy world", async () => {
    const { db } = makeStrictInMemoryStore({
      gameState: IDLE_WORLD,
      widgets: [{ _id: "w3", bad: false }],
    });
    const result = await runVerify(db, makeFixture(), { env: "sandbox" });
    expect(result).toMatchObject({ ok: true, remaining: 0 });
  });

  it("returns runs for a defect", async () => {
    const store = seed();
    const fixture = makeFixture();
    const outcome = await runPlan(store.db, fixture, { env: "sandbox", operator: OPERATOR });
    await runApply(store.db, fixture, {
      env: "sandbox",
      tokenId: outcome.token!.id,
      operator: OPERATOR,
    });

    const history = await listHistory(store.db, { defectId: "AHD-fixture" });
    expect(history).toHaveLength(1);
    expect(await listHistory(store.db, { defectId: "AHD-other" })).toHaveLength(0);
  });
});
