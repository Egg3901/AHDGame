import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { EventEmitter } from "events";

const addBreadcrumb = vi.fn();
const captureMessage = vi.fn();
const spanEnd = vi.fn();
const spanSetStatus = vi.fn();
const startInactiveSpan = vi.fn((..._a: unknown[]) => ({ end: spanEnd, setStatus: spanSetStatus }));
// Default: an active recording span, so span paths are exercised under test.
// Individual cases can override getActiveSpan.mockReturnValue(...) as needed.
const getActiveSpan = vi.fn((..._a: unknown[]) => ({ isRecording: () => true }));

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: (...a: unknown[]) => addBreadcrumb(...a),
  captureMessage: (...a: unknown[]) => captureMessage(...a),
  startInactiveSpan: (...a: unknown[]) => startInactiveSpan(...a),
  getActiveSpan: (...a: unknown[]) => getActiveSpan(...a),
}));

import { attachMongoCommandMonitor, __resetMongoMonitorForTest } from "./mongoMonitor";
import type { MongoClient } from "mongodb";

// attachMongoCommandMonitor early-returns under NODE_ENV=test; flip it so the
// listeners actually attach for these tests, then restore.
const origEnv = process.env.NODE_ENV;

function makeClient() {
  return new EventEmitter() as unknown as MongoClient;
}

describe("mongoMonitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetMongoMonitorForTest();
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.OBSERVABILITY_DB_MONITOR;
  });

  it("adds a db breadcrumb for a successful command with its collection", () => {
    const client = makeClient();
    attachMongoCommandMonitor(client);
    (client as unknown as EventEmitter).emit("commandStarted", {
      requestId: 1,
      commandName: "find",
      command: { find: "corporations" },
    });
    (client as unknown as EventEmitter).emit("commandSucceeded", {
      requestId: 1,
      commandName: "find",
      duration: 12,
    });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "db",
        message: "find corporations",
        data: expect.objectContaining({ durationMS: 12, collection: "corporations" }),
      })
    );
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("opens+ends a db span when inside a recording trace", () => {
    const client = makeClient();
    attachMongoCommandMonitor(client);
    const ee = client as unknown as EventEmitter;
    ee.emit("commandStarted", { requestId: 3, commandName: "find", command: { find: "users" } });
    expect(startInactiveSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "db.find.users", op: "db.query" })
    );
    ee.emit("commandSucceeded", { requestId: 3, commandName: "find", duration: 5 });
    expect(spanSetStatus).toHaveBeenCalledWith({ code: 1 });
    expect(spanEnd).toHaveBeenCalledTimes(1);
  });

  it("does NOT open a span when there is no recording trace (hot-path safety)", () => {
    getActiveSpan.mockReturnValueOnce(undefined as never);
    const client = makeClient();
    attachMongoCommandMonitor(client);
    const ee = client as unknown as EventEmitter;
    ee.emit("commandStarted", { requestId: 4, commandName: "find", command: { find: "users" } });
    ee.emit("commandSucceeded", { requestId: 4, commandName: "find", duration: 5 });
    expect(startInactiveSpan).not.toHaveBeenCalled();
    // Breadcrumbs still recorded regardless of sampling.
    expect(addBreadcrumb).toHaveBeenCalled();
  });

  it("records a slow query as a breadcrumb only — no standalone GlitchTip issue", () => {
    const client = makeClient();
    attachMongoCommandMonitor(client);
    const ee = client as unknown as EventEmitter;
    ee.emit("commandStarted", {
      requestId: 7,
      commandName: "aggregate",
      command: { aggregate: "bonds" },
    });
    ee.emit("commandSucceeded", { requestId: 7, commandName: "aggregate", duration: 5000 });
    // Slow queries are a perf signal, not an error: they enrich real errors as
    // a breadcrumb (with durationMS) but must not mint their own issue, which
    // flooded the error tracker with non-actionable noise.
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "db",
        data: expect.objectContaining({ collection: "bonds", durationMS: 5000 }),
      })
    );
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("adds an error breadcrumb for a failed command", () => {
    const client = makeClient();
    attachMongoCommandMonitor(client);
    const ee = client as unknown as EventEmitter;
    ee.emit("commandStarted", {
      requestId: 3,
      commandName: "update",
      command: { update: "characters" },
    });
    ee.emit("commandFailed", {
      requestId: 3,
      commandName: "update",
      duration: 4,
      failure: new Error("E11000 dup"),
    });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        message: "FAILED update characters",
        data: expect.objectContaining({ error: "E11000 dup" }),
      })
    );
  });

  it("ignores driver chatter (hello/ping)", () => {
    const client = makeClient();
    attachMongoCommandMonitor(client);
    const ee = client as unknown as EventEmitter;
    ee.emit("commandSucceeded", { requestId: 9, commandName: "hello", duration: 1 });
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  afterAll(() => {
    (process.env as Record<string, string>).NODE_ENV = origEnv as string;
  });
});
