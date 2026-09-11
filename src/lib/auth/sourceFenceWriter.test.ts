import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";
import { createSourceOwnershipProofStore, type SourceOwnershipProof } from "./sourceOwnershipProof";
import {
  centralAttestationDigest,
  createSourceFenceWriter,
  type CentralFenceAttestation,
} from "./sourceFenceWriter";

const enabled = process.env.AHD_SOURCE_FENCE_MONGO_TEST === "true";
const suite = enabled ? describe : describe.skip;
const ISSUER = "https://source.test.lakesidegames.invalid";
const CANONICAL = "abcdef12-abcd-4abc-8abc-abcdef123456";
const OPERATION = "12345678-90ab-4cde-b123-456789abcdef";
const PASSWORD = "source-fence-test-password";
const HASH = bcrypt.hashSync(PASSWORD, 12);

async function unusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("no port"));
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForMongo(uri: string, child: ChildProcess): Promise<MongoClient> {
  const deadline = Date.now() + 25_000;
  let last: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("owned mongod exited");
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 500 });
    try {
      await client.connect();
      const hello = await client.db("admin").command({ hello: 1 });
      if (uri.includes("replicaSet=rs0") && hello["isWritablePrimary"] !== true) {
        throw new Error("replica set has no writable primary yet");
      }
      return client;
    } catch (error) {
      last = error;
      await client.close().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw last;
}

function attestation(proof: SourceOwnershipProof): CentralFenceAttestation {
  const unsigned = {
    version: 1 as const,
    sourceIssuer: proof.sourceIssuer,
    sourceAccountId: proof.sourceAccountId,
    canonicalAccountId: proof.canonicalAccountId,
    enrollmentOperationId: proof.enrollmentOperationId,
    fenceGeneration: "1",
    fenceAuthority: "source-fence-test",
    fenceTokenHash: "f".repeat(64),
    leaseExpiresAtMs: Date.now() + 60_000,
    targetIssuer: "https://issuer.test.lakesidegames.invalid/realms/lakeside",
    targetSubject: "target-user",
  };
  return Object.freeze({ ...unsigned, attestationDigest: centralAttestationDigest(unsigned) });
}

suite("source migration fence against an isolated replica set", () => {
  let child: ChildProcess;
  let client: MongoClient;
  let dbPath: string;
  let database: string;

  beforeAll(async () => {
    dbPath = mkdtempSync(join("/dev/shm", "ahd-source-fence-"));
    const port = await unusedPort();
    child = spawn(
      "mongod",
      [
        "--dbpath",
        dbPath,
        "--bind_ip",
        "127.0.0.1",
        "--port",
        String(port),
        "--replSet",
        "rs0",
        "--oplogSize",
        "64",
        "--quiet",
      ],
      { stdio: "ignore" }
    );
    const direct = await waitForMongo(`mongodb://127.0.0.1:${port}/?directConnection=true`, child);
    await direct.db("admin").command({
      replSetInitiate: { _id: "rs0", members: [{ _id: 0, host: `127.0.0.1:${port}` }] },
    });
    await direct.close();
    client = await waitForMongo(
      `mongodb://127.0.0.1:${port}/?replicaSet=rs0&directConnection=true`,
      child
    );
    database = `source_fence_${new ObjectId().toHexString()}`;
    const db = client.db(database);
    await db.collection("sourceFenceReceipts").createIndexes([
      { key: { sourceAccountId: 1 }, name: "source_fence_receipt_account_unique", unique: true },
      {
        key: { enrollmentOperationId: 1 },
        name: "source_fence_receipt_operation_unique",
        unique: true,
      },
      { key: { proofId: 1 }, name: "source_fence_receipt_proof_unique", unique: true },
    ]);
  }, 60_000);

  afterAll(async () => {
    await client?.close().catch(() => undefined);
    if (child?.pid) child.kill("SIGTERM");
    await new Promise((resolve) => child?.once("exit", resolve));
    if (dbPath) rmSync(dbPath, { recursive: true, force: false });
  }, 30_000);

  async function issue(operation = OPERATION) {
    const id = new ObjectId();
    const db = client.db(database);
    await db
      .collection("users")
      .insertOne({ _id: id, password: HASH, role: "player", isAdmin: false, isBanned: false });
    const store = createSourceOwnershipProofStore({
      sourceIssuer: ISSUER,
      client,
      databaseName: database,
    });
    const proof = await store.issuePasswordProof({
      sourceAccountId: id.toHexString(),
      password: PASSWORD,
      reserveEnrollment: async () => ({
        version: 1,
        sourceIssuer: ISSUER,
        sourceSubject: id.toHexString(),
        canonicalAccountId: CANONICAL,
        enrollmentOperationId: operation,
      }),
    });
    return { id, proof, store };
  }

  function writer(
    proof: SourceOwnershipProof,
    load = async () => {
      const value = await createSourceOwnershipProofStore({
        sourceIssuer: ISSUER,
        client,
        databaseName: database,
      }).loadProof({ proofId: proof.proofId });
      return value;
    }
  ) {
    const db = client.db(database);
    return createSourceFenceWriter({
      client,
      db,
      sourceIssuer: ISSUER,
      clockSkewBoundMs: 50,
      clockSkewEvidence: "isolated single-host fixture only",
      loadSourceProof: async () => load(),
      loadCentralFenceAttestation: async () => attestation(proof),
    });
  }

  it("commits consumption, denial, revocation, and receipt together, then replays without mutation", async () => {
    const { id, proof } = await issue();
    const first = await writer(proof).applySourceFence({
      proofId: proof.proofId,
      provenance: "test:first",
    });
    expect(first.status).toBe("COMMITTED");
    const db = client.db(database);
    const before = await db.collection("users").findOne({ _id: id });
    expect(before?.["authMigrationFence"]).toMatchObject({
      proofId: proof.proofId,
      receiptId: first.receiptId,
    });
    expect(before?.["authRevokedAt"]).toBeInstanceOf(Date);
    expect(
      await db.collection("sourceFenceConsumptions").countDocuments({ _id: proof.proofId })
    ).toBe(1);
    const receipt = await db.collection("sourceFenceReceipts").findOne({ proofId: proof.proofId });
    expect(receipt?.["passwordDigest"]).toBe(HASH);

    const expiredLoader = async () => ({ proof, sourceNowMs: proof.expiresAtMs, expired: true });
    const replay = await writer(proof, expiredLoader).applySourceFence({
      proofId: proof.proofId,
      provenance: "test:replay",
    });
    expect(replay).toMatchObject({ status: "REPLAY_NO_MUTATION", receiptId: first.receiptId });
    expect(await db.collection("users").findOne({ _id: id })).toEqual(before);
  });

  it("rolls every fence record back when the live credential changed", async () => {
    const { id, proof } = await issue("22345678-90ab-4cde-b123-456789abcdef");
    await client
      .db(database)
      .collection("users")
      .updateOne({ _id: id }, { $set: { password: bcrypt.hashSync("changed", 12) } });
    const result = await writer(proof).applySourceFence({
      proofId: proof.proofId,
      provenance: "test:stale",
    });
    expect(result.status).toBe("STALE");
    const db = client.db(database);
    expect(
      await db.collection("sourceFenceConsumptions").countDocuments({ _id: proof.proofId })
    ).toBe(0);
    expect(
      await db.collection("sourceFenceReceipts").countDocuments({ proofId: proof.proofId })
    ).toBe(0);
    expect(await db.collection("users").findOne({ _id: id })).not.toHaveProperty(
      "authMigrationFence"
    );
  });

  it("consumes one proof once across concurrent identical fence attempts", async () => {
    const { id, proof } = await issue("32345678-90ab-4cde-b123-456789abcdef");
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        writer(proof).applySourceFence({ proofId: proof.proofId, provenance: "test:race" })
      )
    );
    expect(attempts.filter((result) => result.status === "COMMITTED")).toHaveLength(1);
    for (const result of attempts) {
      if (result.status === "UNAVAILABLE" || result.status === "COMMIT_UNKNOWN") {
        await expect(
          writer(proof).applySourceFence({ proofId: proof.proofId, provenance: "test:race-retry" })
        ).resolves.toMatchObject({ status: "REPLAY_NO_MUTATION" });
      } else {
        expect(["COMMITTED", "REPLAY_NO_MUTATION"]).toContain(result.status);
      }
    }
    const db = client.db(database);
    expect(
      await db.collection("sourceFenceConsumptions").countDocuments({ _id: proof.proofId })
    ).toBe(1);
    expect(
      await db.collection("sourceFenceReceipts").countDocuments({ proofId: proof.proofId })
    ).toBe(1);
    expect(
      await db
        .collection("users")
        .countDocuments({ _id: id, authMigrationFence: { $exists: true } })
    ).toBe(1);
  });
});
