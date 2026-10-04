import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mongoState = vi.hoisted(() => ({
  clients: [] as Array<{
    uri: string;
    connect: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    db: ReturnType<typeof vi.fn>;
  }>,
  nextConnectError: null as Error | null,
  connectGate: null as Promise<void> | null,
}));

vi.mock("dotenv", () => ({ config: vi.fn() }));
vi.mock("mongodb", () => ({
  MongoClient: class MockMongoClient {
    readonly uri: string;
    readonly connect = vi.fn(async () => {
      await mongoState.connectGate;
      const error = mongoState.nextConnectError;
      mongoState.nextConnectError = null;
      if (error) throw error;
    });
    readonly close = vi.fn(async () => undefined);
    readonly db = vi.fn((databaseName?: string) => ({ databaseName }));

    constructor(uri: string) {
      this.uri = uri;
      mongoState.clients.push(this);
    }
  },
}));

async function freshDbModule() {
  vi.resetModules();
  mongoState.clients.length = 0;
  mongoState.nextConnectError = null;
  mongoState.connectGate = null;
  return import("./db");
}

describe("scripts/utils/db client URI identity", () => {
  beforeEach(() => {
    vi.stubEnv("MONGODB_URI", "mongodb://env-host/env-db");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects same-name database reuse when the requested URI changes", async () => {
    const { connectDb } = await freshDbModule();
    await connectDb("world", "mongodb://first-host/world");

    await expect(connectDb("world", "mongodb://second-host/world")).rejects.toThrow(
      "different URI"
    );

    expect(mongoState.clients).toHaveLength(1);
    expect(mongoState.clients[0]!.db).toHaveBeenCalledTimes(1);
  });

  it("rejects a different URI while the first connection is still in flight", async () => {
    const { connectDb } = await freshDbModule();
    const first = connectDb("world", "mongodb://first-host/world");

    await expect(connectDb("world", "mongodb://second-host/world")).rejects.toThrow(
      "different URI"
    );
    await first;

    expect(mongoState.clients).toHaveLength(1);
  });

  it("clears the URI identity on close so a deliberate new target can connect", async () => {
    const { closeDb, connectDb } = await freshDbModule();
    await connectDb("world", "mongodb://first-host/world");
    await closeDb();

    await connectDb("world", "mongodb://second-host/world");

    expect(mongoState.clients.map((client) => client.uri)).toEqual([
      "mongodb://first-host/world",
      "mongodb://second-host/world",
    ]);
    expect(mongoState.clients[0]!.close).toHaveBeenCalledTimes(1);
  });

  it("discards a failed initial client and retries with a fresh one", async () => {
    const { connectDb } = await freshDbModule();
    mongoState.nextConnectError = new Error("connection refused");

    const failedAttempt = connectDb("world", "mongodb://retry-host/world");
    const failedClient = mongoState.clients[0]!;
    await expect(failedAttempt).rejects.toThrow("connection refused");
    expect(failedClient.close).toHaveBeenCalledTimes(1);

    await connectDb("world", "mongodb://retry-host/world");

    expect(mongoState.clients).toHaveLength(2);
    expect(mongoState.clients[1]!.connect).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight connection for concurrent requests to the same URI", async () => {
    const { connectDb } = await freshDbModule();
    const first = connectDb("world-a", "mongodb://shared-host/world");
    const mockClient = mongoState.clients[0]!;
    const second = connectDb("world-b", "mongodb://shared-host/world");

    const [dbA, dbB] = await Promise.all([first, second]);

    expect(mockClient.connect).toHaveBeenCalledTimes(1);
    expect(dbA.databaseName).toBe("world-a");
    expect(dbB.databaseName).toBe("world-b");
  });

  it("closes an in-flight client, rejects both waiters, and permits a fresh URI afterward", async () => {
    let finishConnect!: () => void;
    const { closeDb, connectDb } = await freshDbModule();
    mongoState.connectGate = new Promise<void>((resolve) => {
      finishConnect = resolve;
    });
    const first = connectDb("world-a", "mongodb://first-host/world");
    const second = connectDb("world-b", "mongodb://first-host/world");
    const firstRejected = expect(first).rejects.toThrow("closed while connecting");
    const secondRejected = expect(second).rejects.toThrow("closed while connecting");
    const closing = closeDb();
    const pendingClient = mongoState.clients[0]!;

    finishConnect();

    await Promise.all([firstRejected, secondRejected, closing]);

    expect(pendingClient.close).toHaveBeenCalledTimes(1);

    mongoState.connectGate = null;
    await connectDb("world", "mongodb://second-host/world");

    expect(mongoState.clients).toHaveLength(2);
    expect(mongoState.clients[1]!.uri).toBe("mongodb://second-host/world");
    expect(mongoState.clients[1]!.connect).toHaveBeenCalledTimes(1);
  });
});
