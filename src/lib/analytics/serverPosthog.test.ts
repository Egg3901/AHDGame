import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";

const sdk = vi.hoisted(() => ({
  capture: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("posthog-node", () => ({
  PostHog: class {
    capture = sdk.capture;
    flush = sdk.flush;
  },
}));

function fakeDb() {
  const markers = new Set<string>();
  const bulkWrite = vi.fn(async (operations: Array<{ updateOne: { filter: { _id: string } } }>) => {
    const upsertedIds: Record<number, string> = {};
    operations.forEach((operation, index) => {
      const id = operation.updateOne.filter._id;
      if (!markers.has(id)) {
        markers.add(id);
        upsertedIds[index] = id;
      }
    });
    return { upsertedIds };
  });
  const findOne = vi.fn().mockResolvedValue({ iteration: { type: "Alpha", number: 3 } });
  const collection = vi.fn(() => ({ bulkWrite, findOne }));
  return { db: { collection } as unknown as Db, bulkWrite, findOne, collection };
}

function outcome(db: Db, insertId = "election:1") {
  return {
    db,
    event: "election_resolved",
    distinctId: "system:election-outcomes",
    turn: 42,
    insertId,
    iteration: { type: "Alpha" as const, number: 3, startDate: new Date() },
    nationId: "US",
    properties: { candidate_count: 2 },
  };
}

describe("server PostHog batching and outcome claims", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sdk.capture.mockReset();
    sdk.flush.mockReset().mockResolvedValue(undefined);
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("keeps uncommitted turn outcomes isolated from concurrent request flushes", async () => {
    const analytics = await import("./serverPosthog");
    const { db, bulkWrite } = fakeDb();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let started!: () => void;
    const ready = new Promise<void>((resolve) => (started = resolve));
    const turn = analytics.withServerTurnAnalytics(async () => {
      await analytics.captureServerGameEvent(outcome(db));
      started();
      await gate;
      analytics.markServerTurnAnalyticsCommitted();
      await analytics.flushServerPosthog();
    });
    await ready;
    await analytics.captureServerGameEvent({ ...outcome(db, "request"), flush: true });
    expect(sdk.capture).toHaveBeenCalledTimes(1);
    expect(sdk.capture.mock.calls[0][0].properties.$insert_id).toBe("request");
    release();
    await turn;
    expect(sdk.capture).toHaveBeenCalledTimes(2);
    expect(bulkWrite).toHaveBeenCalledTimes(2);
  });

  it("does not flush network or request queues from an uncommitted turn phase", async () => {
    const analytics = await import("./serverPosthog");
    const { db } = fakeDb();
    await analytics.captureServerGameEvent(outcome(db, "request"));
    await analytics.withServerTurnAnalytics(async () => {
      await analytics.captureServerGameEvent({ ...outcome(db, "phase"), flush: true });
      await analytics.flushServerPosthog();
      expect(sdk.flush).not.toHaveBeenCalled();
      expect(sdk.capture).not.toHaveBeenCalled();
    });
    await analytics.flushServerPosthog();
    expect(sdk.capture).toHaveBeenCalledTimes(1);
    expect(sdk.capture.mock.calls[0][0].properties.$insert_id).toBe("request");
  });

  it("drops failed or disabled turn scopes and does not leak them into later request flushes", async () => {
    const analytics = await import("./serverPosthog");
    const { db, bulkWrite } = fakeDb();
    await expect(
      analytics.withServerTurnAnalytics(async () => {
        await analytics.captureServerGameEvent(outcome(db));
        throw new Error("turn failed before commit");
      })
    ).rejects.toThrow("turn failed before commit");
    await analytics.withServerTurnAnalytics(async () => {
      await analytics.captureServerGameEvent(outcome(db, "sandbox"));
      analytics.markServerTurnAnalyticsCommitted({ emit: false });
      await analytics.captureServerGameEvent(outcome(db, "disabled"));
    });
    await analytics.flushServerPosthog();
    expect(bulkWrite).not.toHaveBeenCalled();
    expect(sdk.capture).not.toHaveBeenCalled();
  });

  it("allows a detached continuation after a successful turn commit", async () => {
    const analytics = await import("./serverPosthog");
    const { db } = fakeDb();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let continuation!: Promise<void>;
    await analytics.withServerTurnAnalytics(async () => {
      analytics.markServerTurnAnalyticsCommitted();
      continuation = gate.then(async () => {
        await analytics.captureServerGameEvent({ ...outcome(db), flush: true });
      });
    });
    release();
    await continuation;
    expect(sdk.capture).toHaveBeenCalledTimes(1);
  });

  it("batches multiple outcome claims in one database command and suppresses duplicate items", async () => {
    const { captureServerGameEvent, flushServerPosthog } = await import("./serverPosthog");
    const { db, bulkWrite } = fakeDb();
    await captureServerGameEvent(outcome(db));
    await captureServerGameEvent(outcome(db));
    await captureServerGameEvent(outcome(db, "election:2"));
    expect(sdk.capture).not.toHaveBeenCalled();
    await flushServerPosthog();
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    expect(bulkWrite.mock.calls[0][0]).toHaveLength(2);
    expect(sdk.capture).toHaveBeenCalledTimes(2);
    expect(sdk.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "election_resolved",
        distinctId: "system:election-outcomes",
        properties: expect.objectContaining({
          candidate_count: 2,
          iteration_id: "alpha-3",
          turn_number: 42,
          nation_id: "US",
          $process_person_profile: false,
        }),
      })
    );
  });

  it("uses durable claims across module instances and separates iterations", async () => {
    const { db } = fakeDb();
    let analytics = await import("./serverPosthog");
    await analytics.captureServerGameEvent({ ...outcome(db), flush: true });
    vi.resetModules();
    analytics = await import("./serverPosthog");
    await analytics.captureServerGameEvent({ ...outcome(db), flush: true });
    expect(sdk.capture).toHaveBeenCalledTimes(1);
    await analytics.captureServerGameEvent({
      ...outcome(db),
      iteration: { ...outcome(db).iteration, number: 4 },
      flush: true,
    });
    expect(sdk.capture).toHaveBeenCalledTimes(2);
  });

  it("serializes overlapping flushes and preserves events queued during a flush", async () => {
    const analytics = await import("./serverPosthog");
    const { db, bulkWrite } = fakeDb();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    bulkWrite.mockImplementationOnce(async () => {
      await gate;
      return { upsertedIds: { 0: "first" } };
    });
    await analytics.captureServerGameEvent(outcome(db));
    const first = analytics.flushServerPosthog();
    await Promise.resolve();
    await analytics.captureServerGameEvent(outcome(db, "election:2"));
    const second = analytics.flushServerPosthog();
    release();
    await Promise.all([first, second]);
    expect(bulkWrite).toHaveBeenCalledTimes(2);
    expect(sdk.capture).toHaveBeenCalledTimes(2);
  });

  it("contains claim failures and still emits events without a deduplication key", async () => {
    const analytics = await import("./serverPosthog");
    const { db, bulkWrite } = fakeDb();
    bulkWrite.mockRejectedValueOnce(new Error("database unavailable"));
    await analytics.captureServerGameEvent(outcome(db));
    await analytics.captureServerGameEvent({
      ...outcome(db),
      insertId: undefined,
      event: "office_transition",
    });
    await expect(analytics.flushServerPosthog()).resolves.toBeUndefined();
    expect(sdk.capture).toHaveBeenCalledTimes(1);
    expect(sdk.capture.mock.calls[0][0].event).toBe("office_transition");
  });

  it("contains SDK failures and can flush a later batch", async () => {
    const analytics = await import("./serverPosthog");
    const { db } = fakeDb();
    sdk.flush.mockRejectedValueOnce(new Error("network unavailable"));
    await expect(
      analytics.captureServerGameEvent({ ...outcome(db), flush: true })
    ).resolves.toBeUndefined();
    await analytics.captureServerGameEvent({ ...outcome(db, "election:2"), flush: true });
    expect(sdk.capture).toHaveBeenCalledTimes(2);
    expect(sdk.flush).toHaveBeenCalledTimes(2);
  });

  it("shares one projected iteration read for an entire same-turn batch", async () => {
    const analytics = await import("./serverPosthog");
    const { db, findOne } = fakeDb();
    await Promise.all([
      analytics.captureServerGameEvent({ ...outcome(db), iteration: undefined }),
      analytics.captureServerGameEvent({ ...outcome(db, "election:2"), iteration: undefined }),
    ]);
    await analytics.flushServerPosthog();
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledWith(
      { _id: "current" },
      { projection: { currentTurn: 1, iteration: 1 } }
    );
  });

  it("does not write claims or call the SDK when PostHog is disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    const analytics = await import("./serverPosthog");
    const { db, collection } = fakeDb();
    await analytics.captureServerGameEvent({ ...outcome(db), flush: true });
    await analytics.flushServerPosthog();
    expect(collection).not.toHaveBeenCalled();
    expect(sdk.capture).not.toHaveBeenCalled();
  });

  it("suppresses idempotent events when no database claim can be made", async () => {
    const analytics = await import("./serverPosthog");
    await analytics.captureServerGameEvent({ ...outcome(fakeDb().db), db: undefined, flush: true });
    expect(sdk.capture).not.toHaveBeenCalled();
  });
});
