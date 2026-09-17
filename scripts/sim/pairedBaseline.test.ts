import { describe, expect, it } from "vitest";
import {
  assertCloneDestNotStamped,
  assertCopiedMarkerMatches,
  assertBaselineMarkerForClaim,
  assertBaselineStampCompatible,
  fingerprintBaselineState,
  stableStringify,
} from "./simJobArgs";
import {
  PAIRED_BASELINE_TOOL_DESCRIPTION,
  PAIRED_BASELINE_TOOL_NAME,
  PAIRED_BASELINE_TOOL_SCHEMA,
  createPairedBaselinePair,
  pairedBaselineArmDbName,
  pairedArmContentMatches,
  planPairedBaselineCreation,
  resolvePairedBaselineWrites,
  runPairedBaselineTool,
  type PairedBaselineStore,
  type PairedBaselineToolDb,
} from "./pairedBaseline";

const BASE_INPUT = {
  preset: "1953-default",
  turns: 48,
  seed: "rs1470",
  pairId: "rs1470-01",
  baselineId: "live-20260917",
};

/** In-memory simJobs stand-in. Duplicate _ids surface as code-11000 errors,
 * exactly like the mongodb driver, so convergence races run for real. */
class FakeJobs implements PairedBaselineStore {
  docs = new Map<string, Record<string, unknown>>();

  async listByPairId(pairId: string): Promise<Array<Record<string, unknown>>> {
    return [...this.docs.values()].filter((d) => d.pairId === pairId).map((d) => ({ ...d }));
  }

  async insertArm(doc: Record<string, unknown>): Promise<void> {
    const id = String(doc._id);
    if (this.docs.has(id)) {
      const err = new Error(
        `E11000 duplicate key error collection: simJobs index: _id_ dup key: { _id: "${id}" }`
      ) as Error & { code: number };
      err.code = 11000;
      throw err;
    }
    this.docs.set(id, { ...doc });
  }
}

function fakeDb(jobs: FakeJobs): PairedBaselineToolDb {
  return {
    collection: (name: string) => {
      if (name !== "simJobs") throw new Error(`unexpected collection "${name}"`);
      return {
        find: (q: Record<string, unknown>) => ({
          toArray: () => jobs.listByPairId(String(q.pairId)),
        }),
        insertOne: async (doc: Record<string, unknown>) => {
          await jobs.insertArm(doc);
          return { acknowledged: true };
        },
      };
    },
  };
}

/** Minimal fake baseline snapshot: gameState turn + doc count + marker, with
 * stamp/observe/claim helpers mirroring the production scripts' method. */
interface FakeBaselineDb {
  gameState: Record<string, unknown>;
  docCount: number;
  marker: Record<string, unknown> | null;
}

function stampFakeBaseline(db: FakeBaselineDb, baselineId: string): void {
  const sourceTurn = Number(db.gameState.currentTurn ?? 0);
  const observed = {
    baselineId,
    sourceTurn,
    docCount: db.docCount,
    stateHash: fingerprintBaselineState(db.gameState),
  };
  const existing = db.marker
    ? {
        baselineId,
        sourceTurn: Number(db.marker.sourceTurn ?? -1),
        docCount: Number(db.marker.docCount ?? -1),
        stateHash:
          typeof db.marker.stateHash === "string" ? (db.marker.stateHash as string) : undefined,
      }
    : null;
  assertBaselineStampCompatible(existing, observed);
  db.marker = { _id: baselineId, ...observed, stampedAt: new Date(0) };
}

function claimFakeBaseline(db: FakeBaselineDb, baselineId: string): void {
  const observed = {
    baselineId,
    sourceTurn: Number(db.gameState.currentTurn ?? 0),
    docCount: db.docCount,
    stateHash: fingerprintBaselineState(db.gameState),
  };
  assertBaselineMarkerForClaim(db.marker, observed);
}

describe("paired-baseline creation surface (issue #1470 runtime caller)", () => {
  it("registers the narrow MCP tool with a live-free schema", () => {
    // Red before the fix: no production caller existed for
    // buildPairedBaselinePair/planPairedBaselineRepair (tests only).
    expect(PAIRED_BASELINE_TOOL_NAME).toBe("sim_create_paired_baseline");
    expect(PAIRED_BASELINE_TOOL_DESCRIPTION).toMatch(/Sandbox only/i);
    const schema = PAIRED_BASELINE_TOOL_SCHEMA as {
      required: string[];
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };
    expect(schema.required).toEqual(["preset", "turns", "seed", "pairId", "baselineId"]);
    expect(schema.additionalProperties).toBe(false);
    const names = Object.keys(schema.properties).join(" ").toLowerCase();
    for (const banned of ["live", "mongodb", "mongo_uri", "targetdb", "clonefromlive"]) {
      expect(names).not.toContain(banned);
    }
  });

  it("creates both deterministic arms end to end through the tool runner", async () => {
    const jobs = new FakeJobs();
    const result = await runPairedBaselineTool({ ...BASE_INPUT }, fakeDb(jobs), {
      controlDbName: "sim_control",
    });
    expect(result.repaired).toBe(false);
    expect(result.pairId).toBe("rs1470-01");
    expect(result.baselineId).toBe("live-20260917");
    expect(result.baselineDb).toBe("ahd_sim_baseline_live-20260917");
    expect(jobs.docs.size).toBe(2);
    const control = jobs.docs.get("rs1470-01-control");
    const treatment = jobs.docs.get("rs1470-01-treatment");
    expect(control?.realOutputShadowEnabled).toBe(false);
    expect(treatment?.realOutputShadowEnabled).toBe(true);
    expect(control?.pairId).toBe("rs1470-01");
    expect(treatment?.baselineId).toBe("live-20260917");
    expect(control?.dbName).toBe("ahd_sim_rs1470-control");
    expect(treatment?.dbName).toBe("ahd_sim_rs1470-treatment");
    expect(control?.status).toBe("queued");
    // No live surface anywhere on the stored arms.
    for (const doc of [control, treatment]) {
      expect(doc).toBeDefined();
      expect("cloneFromLive" in (doc as object)).toBe(false);
      expect(JSON.stringify(doc)).not.toMatch(/LIVE_MONGODB_URI|MONGODB_URI|a-house-divided/);
    }
  });

  it("plans strict arms and rejects tainted or malformed input", () => {
    const planned = planPairedBaselineCreation({ ...BASE_INPUT });
    expect(planned.control.doc.realOutputShadowEnabled).toBe(false);
    expect(planned.treatment.doc.realOutputShadowEnabled).toBe(true);
    expect(planned.control.runId).toBe("rs1470-01-control");
    expect(planned.treatment.runId).toBe("rs1470-01-treatment");
    expect(pairedArmContentMatches(planned.control.doc, { ...planned.control.doc })).toBe(true);
    expect(pairedArmContentMatches(planned.control.doc, planned.treatment.doc)).toBe(false);

    // Live-adjacent and run-instance fields are never accepted.
    for (const tainted of [
      { cloneFromLive: false },
      { cloneFromLive: true },
      { dbName: "ahd_sim_x" },
      { runId: "x" },
      { targetDb: "a-house-divided" },
      { LIVE_MONGODB_URI: "mongodb://x" },
      { realOutputShadowEnabled: true },
      { pairId: "other", baselineId: "other", realOutputShadowEnabled: false },
    ]) {
      expect(() => planPairedBaselineCreation({ ...BASE_INPUT, ...tainted })).toThrow();
    }
    // Shape failures fail closed.
    expect(() => planPairedBaselineCreation({ ...BASE_INPUT, pairId: "a/b" })).toThrow(
      'Job field "pairId" failed validation'
    );
    expect(() => planPairedBaselineCreation({ ...BASE_INPUT, baselineId: "x".repeat(48) })).toThrow(
      "too long"
    );
    expect(() =>
      planPairedBaselineCreation({ ...BASE_INPUT, sourceWorktree: "muse-1470" })
    ).toThrow("must both be set");
    expect(() =>
      planPairedBaselineCreation({
        ...BASE_INPUT,
        sourceWorktree: 42,
        sourceCommit: "a".repeat(40),
      })
    ).toThrow("must both be strings");
    expect(() =>
      planPairedBaselineCreation({
        ...BASE_INPUT,
        sourceWorktree: "muse-1470",
        sourceCommit: "HEAD",
      })
    ).toThrow("full 40-hex");
    expect(() => planPairedBaselineCreation({ ...BASE_INPUT, turns: 0 })).toThrow();
    expect(() => planPairedBaselineCreation({ ...BASE_INPUT, turns: 1001 })).toThrow();
    expect(() => planPairedBaselineCreation({ ...BASE_INPUT, marketSystemMode: "nope" })).toThrow(
      'invalid marketSystemMode "nope"'
    );
    // Arm sandbox db names: overlong seeds and baseline-namespace seeds refuse.
    expect(() => pairedBaselineArmDbName("baseline_live", "control")).toThrow("baseline");
    expect(() => planPairedBaselineCreation({ ...BASE_INPUT, seed: "s".repeat(64) })).toThrow(
      "64-byte"
    );
    expect(() => planPairedBaselineCreation({ ...BASE_INPUT, seed: "baseline_live" })).toThrow(
      "baseline"
    );
    expect(() =>
      planPairedBaselineCreation({ ...BASE_INPUT }, { controlDbName: "ahd_sim_rs1470-control" })
    ).toThrow("control-plane");
  });

  it("carries a valid source pin through to both arms", () => {
    const sha = "a".repeat(40);
    const planned = planPairedBaselineCreation({
      ...BASE_INPUT,
      sourceWorktree: "muse-1470",
      sourceCommit: sha,
    });
    expect(planned.control.doc.sourceWorktree).toBe("muse-1470");
    expect(planned.treatment.doc.sourceCommit).toBe(sha);
  });
});

describe("paired-baseline repair and convergence", () => {
  it("repairs a partial creation by inserting only the missing arm", async () => {
    const jobs = new FakeJobs();
    // Crash between the two inserts: control exists, treatment never landed.
    const planned = planPairedBaselineCreation({ ...BASE_INPUT });
    await jobs.insertArm({ ...planned.control.doc, createdAt: new Date(), updatedAt: new Date() });

    const result = await createPairedBaselinePair({ ...BASE_INPUT }, jobs);
    expect(result.repaired).toBe(true);
    expect(jobs.docs.size).toBe(2);
    expect(jobs.docs.get("rs1470-01-treatment")?.realOutputShadowEnabled).toBe(true);
    // Re-running a completed creation inserts nothing and converges.
    const again = await createPairedBaselinePair({ ...BASE_INPUT }, jobs);
    expect(jobs.docs.size).toBe(2);
    expect(again.arms.every((a) => a.created === false)).toBe(true);
  });

  it("converges concurrent creators without duplicate arms", async () => {
    const jobs = new FakeJobs();
    let innerDone = false;
    let fired = false;
    const racy = new (class extends FakeJobs {
      override async insertArm(doc: Record<string, unknown>): Promise<void> {
        if (!fired) {
          fired = true;
          // A concurrent creator runs to completion between our resolve and
          // our first insert: every insert below races as duplicate-key.
          await createPairedBaselinePair({ ...BASE_INPUT }, superRef);
          innerDone = true;
        }
        return super.insertArm(doc);
      }
    })();
    const superRef: PairedBaselineStore = racy;
    const outer = await createPairedBaselinePair({ ...BASE_INPUT }, racy);
    expect(innerDone).toBe(true);
    expect(jobs.docs.size).toBe(0); // sanity: the decoy store stayed empty
    expect(racy.docs.size).toBe(2);
    expect(outer.arms.map((a) => a.runId).sort()).toEqual([
      "rs1470-01-control",
      "rs1470-01-treatment",
    ]);
  });

  it("converges two fully concurrent runners with no lost writes", async () => {
    const jobs = new FakeJobs();
    const db = fakeDb(jobs);
    const [a, b] = await Promise.all([
      runPairedBaselineTool({ ...BASE_INPUT }, db, { controlDbName: "sim_control" }),
      runPairedBaselineTool({ ...BASE_INPUT }, db, { controlDbName: "sim_control" }),
    ]);
    expect(jobs.docs.size).toBe(2);
    expect(a.pairId).toBe("rs1470-01");
    expect(b.pairId).toBe("rs1470-01");
  });

  it("rejects a mismatched existing arm instead of overwriting it", async () => {
    for (const mutate of [
      (doc: Record<string, unknown>) => ({ ...doc, baselineId: "live-20260918" }),
      (doc: Record<string, unknown>) => ({ ...doc, seed: "other" }),
      (doc: Record<string, unknown>) => ({ ...doc, turns: 49 }),
      (doc: Record<string, unknown>) => ({ ...doc, realOutputShadowEnabled: true }),
      (doc: Record<string, unknown>) => ({ ...doc, sourceCommit: "b".repeat(40) }),
    ]) {
      const jobs = new FakeJobs();
      const planned = planPairedBaselineCreation({ ...BASE_INPUT });
      await jobs.insertArm(mutate({ ...planned.control.doc }));
      await expect(createPairedBaselinePair({ ...BASE_INPUT }, jobs)).rejects.toThrow(
        /different content|unexpected job/
      );
      // Nothing else was written beside the pre-existing arm.
      expect(jobs.docs.size).toBe(1);
      expect(jobs.docs.has("rs1470-01-treatment")).toBe(false);
    }
  });

  it("rejects pairId-tagged docs outside the deterministic arm ids", async () => {
    const jobs = new FakeJobs();
    const planned = planPairedBaselineCreation({ ...BASE_INPUT });
    await jobs.insertArm({
      _id: "rs1470-01-surgery",
      pairId: "rs1470-01",
      baselineId: "live-20260917",
      preset: "1953-default",
      turns: 48,
      seed: "rs1470",
    });
    await expect(createPairedBaselinePair({ ...BASE_INPUT }, jobs)).rejects.toThrow(
      "unexpected job"
    );
    expect(
      resolvePairedBaselineWrites(
        [{ ...planned.control.doc }, { ...planned.treatment.doc }],
        planned
      )
    ).toEqual({ missing: [] });
  });
});

describe("baseline marker races (stamp, claim, copy)", () => {
  it("refuses same-id recapture once the snapshot is stamped", () => {
    // First capture (or pre-stamp retry): no marker, passes.
    expect(() => assertCloneDestNotStamped("ahd_sim_baseline_live-20260917", false)).not.toThrow();
    // Same-id recapture after stamping: refuses before any --drop.
    expect(() => assertCloneDestNotStamped("ahd_sim_baseline_live-20260917", true)).toThrow(
      "same-id recapture"
    );
    // Worker re-copies land in arm dbs (never baseline-named): unaffected
    // even though the copied marker travels with the snapshot.
    expect(() => assertCloneDestNotStamped("ahd_sim_rs1470-control", true)).not.toThrow();
    expect(() => assertCloneDestNotStamped("ahd_sim_clone_foo", true)).not.toThrow();
  });

  it("claims a clean stamped snapshot and refuses post-stamp mutation", () => {
    const db: FakeBaselineDb = {
      gameState: { _id: "current", currentTurn: 10, treasury: 500 },
      docCount: 120,
      marker: null,
    };
    stampFakeBaseline(db, "snap1");
    expect(() => claimFakeBaseline(db, "snap1")).not.toThrow();

    // Turn advance after stamping (something ran against the snapshot).
    const advanced: FakeBaselineDb = {
      gameState: { _id: "current", currentTurn: 11, treasury: 500 },
      docCount: 120,
      marker: db.marker,
    };
    expect(() => claimFakeBaseline(advanced, "snap1")).toThrow(/changed since capture/);

    // Doc-count drift with the turn untouched.
    const grown: FakeBaselineDb = {
      gameState: { _id: "current", currentTurn: 10, treasury: 500 },
      docCount: 121,
      marker: db.marker,
    };
    expect(() => claimFakeBaseline(grown, "snap1")).toThrow(/changed since capture/);

    // In-place edit preserving turn AND count: the seal still trips.
    const edited: FakeBaselineDb = {
      gameState: { _id: "current", currentTurn: 10, treasury: 999999 },
      docCount: 120,
      marker: db.marker,
    };
    expect(() => claimFakeBaseline(edited, "snap1")).toThrow(/seal mismatch/);

    // Never stamped, unsealed legacy marker, and overwritten marker all fail.
    expect(() => claimFakeBaseline({ ...db, marker: null }, "snap1")).toThrow(/no simBaselines/);
    expect(() =>
      claimFakeBaseline({ ...db, marker: { _id: "snap1", sourceTurn: 10, docCount: 120 } }, "snap1")
    ).toThrow(/unsealed/);
    expect(() =>
      claimFakeBaseline(
        {
          ...db,
          marker: {
            _id: "snap1",
            sourceTurn: 10,
            docCount: 120,
            stateHash: "0".repeat(64),
          },
        },
        "snap1"
      )
    ).toThrow(/seal mismatch/);
  });

  it("re-stamps identical observations and refuses mutated ones", () => {
    const seen = { baselineId: "b", sourceTurn: 10, docCount: 5, stateHash: "h1" };
    expect(() => assertBaselineStampCompatible(null, seen)).not.toThrow();
    expect(() => assertBaselineStampCompatible(seen, { ...seen })).not.toThrow();
    expect(() => assertBaselineStampCompatible(seen, { ...seen, sourceTurn: 11 })).toThrow(
      "mutated snapshot"
    );
    expect(() => assertBaselineStampCompatible(seen, { ...seen, stateHash: "h2" })).toThrow(
      "content hash changed"
    );
    // Pre-seal marker upgrades on a matching re-stamp.
    expect(() =>
      assertBaselineStampCompatible({ baselineId: "b", sourceTurn: 10, docCount: 5 }, { ...seen })
    ).not.toThrow();
  });

  it("verifies the copied marker before the run and refuses divergence", () => {
    const db: FakeBaselineDb = {
      gameState: { _id: "current", currentTurn: 7, treasury: 42 },
      docCount: 64,
      marker: null,
    };
    stampFakeBaseline(db, "snap9");
    const source = { ...(db.marker as Record<string, unknown>) };
    // Faithful copy: the marker travels with the snapshot, verification passes.
    const copied = { ...source };
    expect(() => assertCopiedMarkerMatches(source, copied, "snap9")).not.toThrow();
    // Copy raced a mutation, landed empty, or came from the wrong source.
    expect(() => assertCopiedMarkerMatches(source, { ...copied, sourceTurn: 8 }, "snap9")).toThrow(
      /diverges|forked/
    );
    expect(() => assertCopiedMarkerMatches(source, null, "snap9")).toThrow(/without its/);
    expect(() =>
      assertCopiedMarkerMatches(source, { ...copied, stateHash: "1".repeat(64) }, "snap9")
    ).toThrow(/diverges|forked/);
  });

  it("seals deterministically: key order never matters, edits always do", () => {
    const a = { _id: "current", currentTurn: 10, nested: { x: 1, y: [1, 2] } };
    const reordered = { nested: { y: [1, 2], x: 1 }, currentTurn: 10, _id: "current" };
    expect(stableStringify(a)).toBe(stableStringify(reordered));
    expect(fingerprintBaselineState(a)).toBe(fingerprintBaselineState(reordered));
    expect(fingerprintBaselineState({ ...a, currentTurn: 11 })).not.toBe(
      fingerprintBaselineState(a)
    );
    expect(fingerprintBaselineState(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("unpaired and fresh-bootstrap behavior is untouched", () => {
  it("creation output carries no unpaired shape and fresh pairs still verify", async () => {
    const jobs = new FakeJobs();
    await runPairedBaselineTool({ ...BASE_INPUT }, fakeDb(jobs), {
      controlDbName: "sim_control",
    });
    // Every stored doc is a baselined arm; nothing here mints unbaselined jobs.
    for (const doc of jobs.docs.values()) {
      expect(doc.pairId).toBe("rs1470-01");
      expect(doc.baselineId).toBe("live-20260917");
    }
    // resolvePairedBaselineWrites ignores run-instance fields, not identity.
    const planned = planPairedBaselineCreation({ ...BASE_INPUT });
    expect(
      resolvePairedBaselineWrites(
        [
          { ...planned.control.doc, status: "running", currentTurn: 12 },
          { ...planned.treatment.doc, error: null },
        ],
        planned
      )
    ).toEqual({ missing: [] });
  });
});
