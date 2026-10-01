import { describe, expect, it } from "vitest";
import {
  LEGACY_ORPHAN_RECOVERY_ERROR,
  STALE_LEASE_RECOVERY_ERROR,
  buildClaimUpdate,
  claimNextJob,
  createHandoffController,
  findLiveEngineRunIdsFromCmdlines,
  isUnleasedRunningJob,
  recoverLegacyOrphans,
  recoverStaleLeases,
  type ClaimFilter,
  type ClaimUpdate,
  type HandoffJob,
  type HandoffStore,
} from "./simJobHandoff";

/** In-memory fake of the simJobs queue with the same match semantics the
 * worker's Mongo adapter implements: oldest-first atomic claim, conditional
 * legacy requeue, stale-lease sweep. */
class FakeJobStore implements HandoffStore {
  docs: HandoffJob[];

  constructor(docs: HandoffJob[]) {
    this.docs = docs.map((doc) => ({ ...doc }));
  }

  get(id: string): HandoffJob {
    const doc = this.docs.find((candidate) => candidate._id === id);
    if (!doc) throw new Error(`missing job ${id}`);
    return doc;
  }

  private applyUpdate(doc: HandoffJob, update: ClaimUpdate): void {
    const record = doc as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(update.set)) {
      record[key] = value;
    }
    for (const key of update.unset) {
      delete record[key];
    }
  }

  async claimOne(filter: ClaimFilter, update: ClaimUpdate): Promise<HandoffJob | null> {
    const candidates = this.docs
      .filter(
        (doc) =>
          doc.status === "queued" &&
          (filter.startPolicy === undefined || doc.startPolicy === filter.startPolicy) &&
          !filter.excludeDbNames.includes(doc.dbName)
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const winner = candidates[0];
    if (!winner) return null;
    this.applyUpdate(winner, update);
    return { ...winner };
  }

  async requeueStaleLeases(staleBefore: Date, error: string, now: Date): Promise<number> {
    let count = 0;
    for (const doc of this.docs) {
      if (
        doc.status === "running" &&
        doc.workerInstanceId !== undefined &&
        doc.heartbeatAt !== undefined &&
        doc.heartbeatAt !== null &&
        doc.heartbeatAt < staleBefore
      ) {
        doc.status = "queued";
        doc.error = error;
        doc.updatedAt = now;
        delete doc.workerInstanceId;
        delete doc.workerSlotId;
        delete doc.workerPhase;
        count += 1;
      }
    }
    return count;
  }

  async listUnleasedRunning(): Promise<HandoffJob[]> {
    return this.docs
      .filter((doc) => doc.status === "running" && doc.workerInstanceId === undefined)
      .map((doc) => ({ ...doc }));
  }

  async requeueLegacyOrphan(id: string, error: string, now: Date): Promise<boolean> {
    const doc = this.docs.find((candidate) => candidate._id === id);
    if (!doc || doc.status !== "running" || doc.workerInstanceId !== undefined) return false;
    doc.status = "queued";
    doc.error = error;
    doc.updatedAt = now;
    delete doc.workerInstanceId;
    delete doc.workerSlotId;
    delete doc.workerPhase;
    return true;
  }
}

const BASE = new Date("2026-09-17T12:00:00Z");

function terminalJob(): HandoffJob {
  return {
    _id: "audit-allflags-1953-r2",
    status: "completed",
    createdAt: new Date(BASE.getTime() - 3600_000),
    dbName: "ahd_sim_audit_1953",
  };
}

/** Legacy claim: running, no lease metadata, engine process gone. */
function legacyOrphanedSuccessor(): HandoffJob {
  return {
    _id: "audit-allflags-2019-r3",
    status: "running",
    createdAt: new Date(BASE.getTime() - 60_000),
    dbName: "ahd_sim_audit_2019",
    startPolicy: "immediate",
  };
}

describe("sim job handoff recovery", () => {
  it("drains instead of claiming after shutdown is requested", async () => {
    const store = new FakeJobStore([
      { _id: "next", status: "queued", createdAt: BASE, dbName: "ahd_sim_next" },
    ]);
    const handoff = createHandoffController();
    handoff.requestShutdown();
    expect(handoff.canClaim()).toBe(false);
    const claimed = await claimNextJob(store, {
      filter: { excludeDbNames: [] },
      slotId: 1,
      workerInstanceId: "host:1",
      now: BASE,
      shutdownRequested: handoff.isShutdownRequested(),
    });
    expect(claimed).toBeNull();
    expect(store.get("next").status).toBe("queued");
  });

  it("clears stale error text when a recovered job is claimed", async () => {
    const store = new FakeJobStore([
      {
        _id: "recovered",
        status: "queued",
        createdAt: BASE,
        dbName: "ahd_sim_rec",
        error: LEGACY_ORPHAN_RECOVERY_ERROR,
      },
    ]);
    const claimed = await claimNextJob(store, {
      filter: { excludeDbNames: [] },
      slotId: 2,
      workerInstanceId: "host:7",
      now: BASE,
      shutdownRequested: false,
    });
    expect(claimed?.workerInstanceId).toBe("host:7");
    expect(claimed?.workerSlotId).toBe(2);
    expect("error" in store.get("recovered")).toBe(false);
  });

  it("still sweeps stale leased rows and leaves fresh leases alone", async () => {
    const store = new FakeJobStore([
      {
        _id: "stale",
        status: "running",
        createdAt: BASE,
        dbName: "ahd_sim_stale",
        workerInstanceId: "dead:1",
        heartbeatAt: new Date(BASE.getTime() - 3_600_000),
      },
      {
        _id: "fresh",
        status: "running",
        createdAt: BASE,
        dbName: "ahd_sim_fresh",
        workerInstanceId: "live:1",
        heartbeatAt: BASE,
      },
      legacyOrphanedSuccessor(),
    ]);
    const count = await recoverStaleLeases(store, new Date(BASE.getTime() - 600_000), BASE);
    expect(count).toBe(1);
    expect(store.get("stale").status).toBe("queued");
    expect(store.get("stale").error).toBe(STALE_LEASE_RECOVERY_ERROR);
    expect(store.get("fresh").status).toBe("running");
    expect(store.get("audit-allflags-2019-r3").status).toBe("running");
  });

  it("recovers an unleased row only with proven engine absence", async () => {
    const store = new FakeJobStore([legacyOrphanedSuccessor()]);
    expect(isUnleasedRunningJob(store.get("audit-allflags-2019-r3"))).toBe(true);

    const recovered = await recoverLegacyOrphans(store, new Set(), BASE);
    expect(recovered).toEqual(["audit-allflags-2019-r3"]);
    expect(store.get("audit-allflags-2019-r3").status).toBe("queued");
    expect(store.get("audit-allflags-2019-r3").error).toBe(LEGACY_ORPHAN_RECOVERY_ERROR);
  });

  it("never requeues a genuinely active legacy process", async () => {
    const store = new FakeJobStore([legacyOrphanedSuccessor()]);
    const live = findLiveEngineRunIdsFromCmdlines([
      "npx tsx scripts/sim/runWorld.ts --seed=x --preset=y --run-id=audit-allflags-2019-r3",
    ]);
    const recovered = await recoverLegacyOrphans(store, live, BASE);
    expect(recovered).toEqual([]);
    expect(store.get("audit-allflags-2019-r3").status).toBe("running");
  });

  it("fails closed when the process table cannot be listed", async () => {
    const store = new FakeJobStore([legacyOrphanedSuccessor()]);
    const recovered = await recoverLegacyOrphans(store, null, BASE);
    expect(recovered).toEqual([]);
    expect(store.get("audit-allflags-2019-r3").status).toBe("running");
  });

  it("does not clobber a fresh claim that lands before the requeue", async () => {
    const store = new FakeJobStore([legacyOrphanedSuccessor()]);
    const listed = await store.listUnleasedRunning();
    expect(listed).toHaveLength(1);
    // A corrected worker claims the row concurrently via the atomic claim path.
    // Simulate the race at the document level: the row gains a lease, so the
    // conditional requeue must refuse.
    const doc = store.docs.find((candidate) => candidate._id === "audit-allflags-2019-r3");
    if (!doc) throw new Error("missing successor");
    const update = buildClaimUpdate({ slotId: 1, workerInstanceId: "host:9", now: BASE });
    const record = doc as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(update.set)) {
      record[key] = value;
    }
    const ok = await store.requeueLegacyOrphan(
      "audit-allflags-2019-r3",
      LEGACY_ORPHAN_RECOVERY_ERROR,
      BASE
    );
    expect(ok).toBe(false);
    expect(store.get("audit-allflags-2019-r3").status).toBe("running");
    expect(store.get("audit-allflags-2019-r3").workerInstanceId).toBe("host:9");
  });

  it("hands a terminal job to its successor exactly once across a controlled restart", async () => {
    // Observed 2026-09-17 shape: predecessor terminal, successor claimed by a
    // legacy worker with no lease, then the outgoing worker stopped.
    const store = new FakeJobStore([terminalJob(), legacyOrphanedSuccessor()]);
    const launched: string[] = [];

    // Outgoing worker: shutdown requested while it awaited the predecessor.
    // It must not claim anything after the handoff point.
    const outgoing = createHandoffController();
    outgoing.requestShutdown();
    const outgoingClaim = await claimNextJob(store, {
      filter: { excludeDbNames: [] },
      slotId: 1,
      workerInstanceId: "old-host:100",
      now: BASE,
      shutdownRequested: outgoing.isShutdownRequested(),
    });
    expect(outgoingClaim).toBeNull();

    // Corrected worker startup: lease sweep finds nothing new, then the legacy
    // probe proves no engine process matches the orphan and requeues it.
    const staleCount = await recoverStaleLeases(store, new Date(BASE.getTime() - 600_000), BASE);
    expect(staleCount).toBe(0);
    const recovered = await recoverLegacyOrphans(store, new Set(), BASE);
    expect(recovered).toEqual(["audit-allflags-2019-r3"]);

    // Corrected worker claims the successor; the claim clears the recovery note
    // and stamps a lease, and the engine runs it to completion exactly once.
    const successor = await claimNextJob(store, {
      filter: { startPolicy: "immediate", excludeDbNames: [] },
      slotId: 1,
      workerInstanceId: "new-host:200",
      now: BASE,
      shutdownRequested: false,
    });
    expect(successor?._id).toBe("audit-allflags-2019-r3");
    expect("error" in store.get("audit-allflags-2019-r3")).toBe(false);

    launched.push(successor?._id ?? "missing");
    store.get("audit-allflags-2019-r3").status = "completed";

    // Nothing left to claim or recover: the successor ran exactly once.
    const secondClaim = await claimNextJob(store, {
      filter: { excludeDbNames: [] },
      slotId: 1,
      workerInstanceId: "new-host:200",
      now: BASE,
      shutdownRequested: false,
    });
    expect(secondClaim).toBeNull();
    expect(launched).toEqual(["audit-allflags-2019-r3"]);
    expect(store.get("audit-allflags-1953-r2").status).toBe("completed");
    expect(store.get("audit-allflags-2019-r3").status).toBe("completed");
  });
});
