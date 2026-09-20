import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient } from "mongodb";
import * as Sentry from "@sentry/nextjs";
import { attachMongoCommandMonitor, __resetMongoMonitorForTest } from "./mongoMonitor";
import {
  beginPhaseProfiling,
  phaseRoundTrips,
  resetRoundTripProfiler,
  totalDocumentsReturned,
  totalBytesReturned,
} from "./mongoRoundTrips";

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
  getActiveSpan: vi.fn(),
  startInactiveSpan: vi.fn(),
}));

const eventContext = {
  address: "127.0.0.1:27018",
  databaseName: "simulation",
  serverConnectionId: null,
  hasServiceId: false,
};

describe("simulation command monitoring", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AHD_TURN_ROUNDTRIP_MONITOR", "1");
    vi.stubEnv("OBSERVABILITY_DB_MONITOR", "false");
    __resetMongoMonitorForTest();
    resetRoundTripProfiler();
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("counts sandbox commands under test mode without remote telemetry", () => {
    const client = new MongoClient("mongodb://127.0.0.1:27018");
    attachMongoCommandMonitor(client);
    attachMongoCommandMonitor(client);
    beginPhaseProfiling("indexFunds");
    client.emit("commandStarted", {
      ...eventContext,
      commandName: "find",
      requestId: 1,
      command: { find: "indexFunds" },
    });
    client.emit("commandSucceeded", {
      ...eventContext,
      commandName: "find",
      requestId: 1,
      duration: 2,
      reply: { cursor: { firstBatch: [{ cashAnchor: 10 }] } },
    });
    expect(phaseRoundTrips("indexFunds")).toBe(1);
    expect(totalDocumentsReturned()).toBe(1);
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
    expect(Sentry.getActiveSpan).not.toHaveBeenCalled();
  });

  it("profiles BSON and attaches a replacement client independently", () => {
    vi.stubEnv("AHD_TURN_ROUNDTRIP_PROFILE", "1");
    resetRoundTripProfiler();
    beginPhaseProfiling("indexFunds");
    for (let i = 0; i < 2; i++) {
      const client = new MongoClient("mongodb://127.0.0.1:27018");
      attachMongoCommandMonitor(client);
      client.emit("commandStarted", {
        ...eventContext,
        commandName: "find",
        requestId: 1,
        command: { find: "indexFunds" },
      });
      client.emit("commandSucceeded", {
        ...eventContext,
        commandName: "find",
        requestId: 1,
        duration: 1,
        reply: { cursor: { firstBatch: [{ cashAnchor: 10 }] } },
      });
    }
    expect(phaseRoundTrips("indexFunds")).toBe(2);
    expect(totalDocumentsReturned()).toBe(2);
    expect(totalBytesReturned()).toBeGreaterThan(0);
  });

  it("leaves ordinary unit test clients uninstrumented", () => {
    vi.stubEnv("AHD_TURN_ROUNDTRIP_MONITOR", "");
    const client = new MongoClient("mongodb://127.0.0.1:27018");
    attachMongoCommandMonitor(client);
    expect(client.listenerCount("commandStarted")).toBe(0);
  });
});
