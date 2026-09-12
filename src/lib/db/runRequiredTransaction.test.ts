import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, statfsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId } from "mongodb";
import type { ClientSession } from "mongodb";

const { getMongoClientMock } = vi.hoisted(() => ({
  getMongoClientMock: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({
  getMongoClient: getMongoClientMock,
}));

type FakeSession = Pick<ClientSession, "withTransaction" | "endSession">;

function makeClient(session: FakeSession): {
  client: MongoClient;
  startSession: ReturnType<typeof vi.fn>;
} {
  const startSession = vi.fn(() => session);
  return { client: { startSession } as unknown as MongoClient, startSession };
}

describe("runRequiredTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the callback with the active session and strict transaction options", async () => {
    const endSession = vi.fn().mockResolvedValue(undefined);
    const withTransaction = vi.fn(async (callback: (session: ClientSession) => Promise<string>) =>
      callback(session as unknown as ClientSession)
    );
    const session = { withTransaction, endSession } as unknown as FakeSession;
    const { client, startSession } = makeClient(session);
    const body = vi.fn(async (activeSession: ClientSession) => {
      expect(activeSession).toBe(session);
      return "committed";
    });

    await expect(
      (async () => {
        const { runRequiredTransaction } = await import("./runRequiredTransaction");
        return runRequiredTransaction(body, { client });
      })()
    ).resolves.toBe("committed");

    expect(startSession).toHaveBeenCalledOnce();
    expect(withTransaction).toHaveBeenCalledOnce();
    const transactionOptions = (withTransaction.mock.calls[0] as unknown[] | undefined)?.[1];
    expect(transactionOptions).toMatchObject({
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
      readPreference: expect.objectContaining({ mode: "primary" }),
      timeoutMS: 15_000,
      maxCommitTimeMS: 5_000,
    });
    expect(body).toHaveBeenCalledWith(session);
    expect(endSession).toHaveBeenCalledOnce();
  });

  it("uses the pooled client when no explicit client is provided", async () => {
    const endSession = vi.fn().mockResolvedValue(undefined);
    const withTransaction = vi.fn(async (callback: () => Promise<number>) => callback());
    const session = { withTransaction, endSession } as unknown as FakeSession;
    const { client } = makeClient(session);
    getMongoClientMock.mockResolvedValue(client);

    const { runRequiredTransaction } = await import("./runRequiredTransaction");
    await expect(runRequiredTransaction(async () => 7)).resolves.toBe(7);

    expect(getMongoClientMock).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
  });

  it("preserves callback errors and still ends the session", async () => {
    const endSession = vi.fn().mockResolvedValue(undefined);
    const failure = new Error("body failed");
    const withTransaction = vi.fn().mockRejectedValue(failure);
    const session = { withTransaction, endSession } as unknown as FakeSession;
    const { client } = makeClient(session);
    const { runRequiredTransaction } = await import("./runRequiredTransaction");

    await expect(runRequiredTransaction(async () => "unused", { client })).rejects.toBe(failure);
    expect(endSession).toHaveBeenCalledOnce();
  });

  it("does not mask an unknown commit outcome or replay the callback", async () => {
    const endSession = vi.fn().mockResolvedValue(undefined);
    const unknownCommit = Object.assign(new Error("commit result unknown"), {
      errorLabels: ["UnknownTransactionCommitResult"],
    });
    const withTransaction = vi.fn().mockRejectedValue(unknownCommit);
    const session = { withTransaction, endSession } as unknown as FakeSession;
    const { client } = makeClient(session);
    const body = vi.fn().mockResolvedValue("unobserved");
    const { runRequiredTransaction } = await import("./runRequiredTransaction");

    await expect(runRequiredTransaction(body, { client })).rejects.toBe(unknownCommit);
    expect(body).not.toHaveBeenCalled();
    expect(withTransaction).toHaveBeenCalledOnce();
  });

  it("preserves the transaction error when session cleanup also fails", async () => {
    const failure = new Error("transaction failed");
    const endSession = vi.fn().mockRejectedValue(new Error("cleanup failed"));
    const session = {
      withTransaction: vi.fn().mockRejectedValue(failure),
      endSession,
    } as unknown as FakeSession;
    const { client } = makeClient(session);
    const { runRequiredTransaction } = await import("./runRequiredTransaction");

    await expect(runRequiredTransaction(async () => "unused", { client })).rejects.toBe(failure);
  });

  it("surfaces cleanup errors after a successful transaction", async () => {
    const cleanupFailure = new Error("cleanup failed");
    const session = {
      withTransaction: vi.fn(async (callback: () => Promise<string>) => callback()),
      endSession: vi.fn().mockRejectedValue(cleanupFailure),
    } as unknown as FakeSession;
    const { client } = makeClient(session);
    const { RequiredTransactionCleanupError, runRequiredTransaction } =
      await import("./runRequiredTransaction");

    const failure = await runRequiredTransaction(async () => "committed", { client }).catch(
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(RequiredTransactionCleanupError);
    expect(failure).toMatchObject({
      committedResult: "committed",
      cause: cleanupFailure,
    });
  });

  it.each([
    { timeoutMS: 0 },
    { timeoutMS: 60_001 },
    { maxCommitTimeMS: 0 },
    { timeoutMS: 5_000, maxCommitTimeMS: 5_000 },
  ])("rejects unbounded transaction deadlines: %o", async (options) => {
    const { runRequiredTransaction } = await import("./runRequiredTransaction");
    const body = vi.fn().mockResolvedValue("unused");

    await expect(runRequiredTransaction(body, options)).rejects.toThrow(RangeError);
    expect(getMongoClientMock).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

interface RunningMongo {
  child: ChildProcess;
  pid: number;
  dbPath: string;
  port: number;
  client: MongoClient;
}

const isolatedMongoEnabled = process.env.AHD_REQUIRED_TRANSACTION_MONGO_TEST === "true";
const isolatedMongoDescribe = isolatedMongoEnabled ? describe : describe.skip;
const FIXTURE_TEMP_ROOT = "/dev/shm";
const MIN_FIXTURE_FREE_BYTES = 2 * 1024 * 1024 * 1024;
const spawnErrors = new WeakMap<ChildProcess, Error>();

class FixtureSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixtureSafetyError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertFixtureFreeSpace(): void {
  const stats = statfsSync(FIXTURE_TEMP_ROOT);
  const availableBytes = Number(stats.bavail) * Number(stats.bsize);
  if (availableBytes < MIN_FIXTURE_FREE_BYTES) {
    throw new Error(
      `isolated Mongo fixture requires 2 GiB free at ${FIXTURE_TEMP_ROOT}; ` +
        `found ${availableBytes} bytes`
    );
  }
}

async function unusedLocalPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("isolated Mongo fixture did not receive a TCP port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return port;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function waitForChildExit(child: ChildProcess, timeoutMS: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const deadline = Date.now() + timeoutMS;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await waitFor(50);
  }
  if (child.exitCode === null && child.signalCode === null) {
    throw new Error(`isolated mongod ${child.pid ?? "unknown"} did not exit in time`);
  }
}

async function waitForMongo(
  child: ChildProcess,
  uri: string,
  expectedReplicaSet?: string
): Promise<MongoClient> {
  const deadline = Date.now() + 25_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const spawnError = spawnErrors.get(child);
    if (spawnError) {
      throw new FixtureSafetyError(`isolated mongod failed to spawn: ${spawnError.message}`);
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`isolated mongod exited before readiness (pid ${child.pid ?? "unknown"})`);
    }
    const client = new MongoClient(uri, {
      connectTimeoutMS: 500,
      serverSelectionTimeoutMS: 500,
      directConnection: true,
      retryWrites: false,
    });
    try {
      await client.connect();
      const hello = await assertOwnedServer(client, child);
      if (expectedReplicaSet && hello.setName !== expectedReplicaSet) {
        await client.close();
        await waitFor(100);
        continue;
      }
      if (expectedReplicaSet && hello.isWritablePrimary !== true) {
        await client.close();
        await waitFor(100);
        continue;
      }
      return client;
    } catch (error) {
      lastError = error;
      await client.close().catch(() => undefined);
      if (error instanceof FixtureSafetyError) throw error;
      await waitFor(100);
    }
  }
  throw new Error(`isolated mongod did not become ready: ${String(lastError)}`);
}

async function assertOwnedServer(
  client: MongoClient,
  child: ChildProcess
): Promise<{ setName?: string; isWritablePrimary?: boolean }> {
  const pid = child.pid;
  const spawnError = spawnErrors.get(child);
  if (spawnError) {
    throw new FixtureSafetyError(`isolated mongod failed: ${spawnError.message}`);
  }
  if (!pid || child.exitCode !== null || child.signalCode !== null || !processIsAlive(pid)) {
    throw new FixtureSafetyError(`isolated mongod PID ${pid ?? "unknown"} is not live`);
  }
  const status = (await client.db("admin").command({ serverStatus: 1 })) as { pid?: unknown };
  const serverPid = Number(status.pid);
  if (!Number.isInteger(serverPid) || serverPid !== pid) {
    throw new FixtureSafetyError(
      `isolated Mongo PID mismatch: child ${pid}, server ${String(status.pid)}`
    );
  }
  return (await client.db("admin").command({ hello: 1 })) as {
    setName?: string;
    isWritablePrimary?: boolean;
  };
}

async function assertOwnedPrimary(instance: RunningMongo): Promise<void> {
  const hello = await assertOwnedServer(instance.client, instance.child);
  if (hello.isWritablePrimary !== true) {
    throw new FixtureSafetyError(`isolated Mongo PID ${instance.pid} is not primary`);
  }
}

async function startIsolatedMongo(replicaSet: boolean): Promise<RunningMongo> {
  assertFixtureFreeSpace();
  const dbPath = mkdtempSync(join(FIXTURE_TEMP_ROOT, "ahd-required-auth-tx-"));
  let child: ChildProcess | undefined;
  let pid: number | undefined;
  try {
    const port = await unusedLocalPort();
    child = spawn(
      "mongod",
      [
        "--dbpath",
        dbPath,
        "--bind_ip",
        "127.0.0.1",
        "--port",
        String(port),
        ...(replicaSet ? ["--replSet", "rs0", "--oplogSize", "64"] : []),
        "--setParameter",
        "enableTestCommands=1",
        "--quiet",
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    child.once("error", (error) => spawnErrors.set(child!, error));
    child.stdout?.resume();
    child.stderr?.resume();
    if (!child.pid) {
      throw new Error("isolated mongod did not provide an owned PID");
    }
    pid = child.pid;
    const bootstrapUri = `mongodb://127.0.0.1:${port}/?directConnection=true`;
    const bootstrap = await waitForMongo(child, bootstrapUri);
    let client = bootstrap;
    if (replicaSet) {
      await assertOwnedServer(bootstrap, child);
      try {
        await bootstrap.db("admin").command({
          replSetInitiate: {
            _id: "rs0",
            members: [{ _id: 0, host: `127.0.0.1:${port}` }],
          },
        });
      } finally {
        await bootstrap.close();
      }
      const replicaUri = `mongodb://127.0.0.1:${port}/?replicaSet=rs0&directConnection=true`;
      client = await waitForMongo(child, replicaUri, "rs0");
    }
    return { child, pid, dbPath, port, client };
  } catch (error) {
    let cleanupError: unknown;
    if (child && pid) {
      try {
        await terminateOwnedProcess(child, pid);
      } catch (cleanupFailure) {
        cleanupError = cleanupFailure;
      }
    }
    if (!pid || !cleanupError) {
      rmSync(dbPath, { recursive: true, force: false });
    }
    if (cleanupError) {
      throw new AggregateError([error, cleanupError], "isolated Mongo setup and cleanup failed");
    }
    throw error;
  }
}

async function terminateOwnedProcess(child: ChildProcess, pid: number): Promise<void> {
  if (child.exitCode === null && child.signalCode === null && processIsAlive(pid)) {
    child.kill("SIGTERM");
  }
  try {
    await waitForChildExit(child, 8_000);
  } catch {
    if (processIsAlive(pid)) child.kill("SIGKILL");
    await waitForChildExit(child, 8_000);
  }
  const deadline = Date.now() + 3_000;
  while (processIsAlive(pid) && Date.now() < deadline) await waitFor(50);
  if (processIsAlive(pid)) {
    throw new Error(`isolated mongod ${pid} survived cleanup`);
  }
}

async function stopIsolatedMongo(instance: RunningMongo): Promise<void> {
  let closeError: unknown;
  try {
    await instance.client.close();
  } catch (error) {
    closeError = error;
  }

  let processError: unknown;
  try {
    await terminateOwnedProcess(instance.child, instance.pid);
  } catch (error) {
    processError = error;
  }

  if (processError || processIsAlive(instance.pid)) {
    throw processError ?? new Error(`isolated mongod ${instance.pid} survived cleanup`);
  }
  rmSync(instance.dbPath, { recursive: true, force: false });
  if (closeError) {
    throw closeError;
  }
}

isolatedMongoDescribe("runRequiredTransaction against isolated Mongo", () => {
  let replica: RunningMongo | undefined;
  let databaseName: string;

  beforeAll(async () => {
    try {
      execFileSync("mongod", ["--version"], { stdio: "ignore" });
    } catch (error) {
      throw new Error(`AHD_REQUIRED_TRANSACTION_MONGO_TEST=true requires mongod: ${String(error)}`);
    }
    replica = await startIsolatedMongo(true);
    databaseName = `required_auth_tx_${new ObjectId().toHexString()}`;
  }, 60_000);

  afterAll(async () => {
    if (replica) await stopIsolatedMongo(replica);
  }, 30_000);

  it("commits two documents and rolls both back on a callback failure", async () => {
    expect(replica).toBeDefined();
    await assertOwnedPrimary(replica!);
    const db = replica!.client.db(databaseName);
    const accounts = db.collection<{ _id: string; state: string }>("syntheticAccounts");
    const ledger = db.collection<{ _id: string; accountId: string }>("syntheticLedger");
    const { runRequiredTransaction } = await import("./runRequiredTransaction");

    const commitIds = {
      account: new ObjectId().toHexString(),
      ledger: new ObjectId().toHexString(),
    };
    await runRequiredTransaction(
      async (session) => {
        await accounts.insertOne({ _id: commitIds.account, state: "created" }, { session });
        await ledger.insertOne(
          { _id: commitIds.ledger, accountId: commitIds.account },
          { session }
        );
      },
      { client: replica!.client }
    );
    expect(await accounts.countDocuments({ _id: commitIds.account })).toBe(1);
    expect(await ledger.countDocuments({ _id: commitIds.ledger })).toBe(1);

    const rollbackIds = {
      account: new ObjectId().toHexString(),
      ledger: new ObjectId().toHexString(),
    };
    const failure = new Error("synthetic rollback");
    await expect(
      runRequiredTransaction(
        async (session) => {
          await accounts.insertOne({ _id: rollbackIds.account, state: "temporary" }, { session });
          await ledger.insertOne(
            { _id: rollbackIds.ledger, accountId: rollbackIds.account },
            { session }
          );
          throw failure;
        },
        { client: replica!.client }
      )
    ).rejects.toBe(failure);
    expect(await accounts.countDocuments({ _id: rollbackIds.account })).toBe(0);
    expect(await ledger.countDocuments({ _id: rollbackIds.ledger })).toBe(0);
  }, 30_000);

  it("lets the driver retry one transient transaction failure with frozen IDs", async () => {
    expect(replica).toBeDefined();
    await assertOwnedPrimary(replica!);
    const db = replica!.client.db(databaseName);
    const accounts = db.collection<{ _id: string; state: string }>("syntheticAccounts");
    const ledger = db.collection<{ _id: string; accountId: string }>("syntheticLedger");
    const { runRequiredTransaction } = await import("./runRequiredTransaction");
    const accountId = new ObjectId().toHexString();
    const ledgerId = new ObjectId().toHexString();
    let callbackRuns = 0;

    await replica!.client.db("admin").command({
      configureFailPoint: "failCommand",
      mode: { times: 1 },
      data: {
        failCommands: ["insert"],
        errorCode: 112,
        errorLabels: ["TransientTransactionError"],
        closeConnection: false,
      },
    });
    try {
      await runRequiredTransaction(
        async (session) => {
          callbackRuns += 1;
          await accounts.insertOne({ _id: accountId, state: "retried" }, { session });
          await ledger.insertOne({ _id: ledgerId, accountId }, { session });
        },
        { client: replica!.client }
      );
    } finally {
      await assertOwnedPrimary(replica!);
      await replica!.client.db("admin").command({
        configureFailPoint: "failCommand",
        mode: "off",
      });
    }

    expect(callbackRuns).toBeGreaterThanOrEqual(2);
    expect(await accounts.countDocuments({ _id: accountId })).toBe(1);
    expect(await ledger.countDocuments({ _id: ledgerId })).toBe(1);
  }, 30_000);

  it("rejects a standalone without leaving a partial write", async () => {
    const standalone = await startIsolatedMongo(false);
    const database = `required_auth_standalone_${new ObjectId().toHexString()}`;
    const { runRequiredTransaction } = await import("./runRequiredTransaction");
    const collection = standalone.client.db(database).collection<{ _id: string }>("syntheticOnly");
    const id = new ObjectId().toHexString();
    let callbackRuns = 0;
    try {
      await assertOwnedServer(standalone.client, standalone.child);
      let failure: unknown;
      try {
        await runRequiredTransaction(
          async (session) => {
            callbackRuns += 1;
            await collection.insertOne({ _id: id }, { session });
          },
          { client: standalone.client }
        );
      } catch (error) {
        failure = error;
      }
      const unsupportedCode =
        (failure as { code?: unknown; originalError?: { code?: unknown } } | undefined)?.code ??
        (failure as { originalError?: { code?: unknown } } | undefined)?.originalError?.code;
      expect(unsupportedCode).toBe(20);
      expect(callbackRuns).toBeLessThanOrEqual(1);
      expect(await collection.countDocuments({ _id: id })).toBe(0);
    } finally {
      await stopIsolatedMongo(standalone);
    }
  }, 30_000);
});
