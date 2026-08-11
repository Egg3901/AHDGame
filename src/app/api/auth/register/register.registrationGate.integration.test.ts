import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId } from "mongodb";

/** Needs Mongo + a reachable app (set TEST_SERVER_URL, e.g. http://127.0.0.1:3000). */
function registerIntegrationSuite() {
  const uri = process.env.MONGODB_URI!;
  const dbName = process.env.MONGODB_DB ?? "a-house-divided-test";
  const registerUrl = `${process.env.TEST_SERVER_URL!.replace(/\/$/, "")}/api/auth/register`;
  let client: MongoClient;

  beforeEach(async () => {
    client = await MongoClient.connect(uri);
    const db = client.db(dbName);
    await db.collection("gameConfig").deleteMany({});
    await db.collection("bannedIps").deleteMany({});
    await db.collection("users").deleteMany({});
  });

  afterAll(async () => {
    await client?.close();
  });

  it("blocks registration when registrationEnabled=false", async () => {
    const db = client.db(dbName);
    await db
      .collection("gameConfig")
      .insertOne({ _id: "default", registrationEnabled: false } as any);

    const res = await fetch(registerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "9.9.9.9",
      },
      body: JSON.stringify({
        email: "alice@test.dev",
        username: "alice",
        password: "SuperSecret123!",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("blocks when a ban row exists for the client IP", async () => {
    const db = client.db(dbName);
    await db
      .collection("gameConfig")
      .insertOne({ _id: "default", registrationEnabled: true } as any);
    await db.collection("bannedIps").insertOne({
      ip: "9.9.9.9",
      note: "test ban",
      bannedByAdminId: new ObjectId(),
      bannedByAdminUsername: "admin",
      bannedAt: new Date(),
    });

    const res = await fetch(registerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "9.9.9.9" },
      body: JSON.stringify({
        email: "bob@test.dev",
        username: "bob",
        password: "SuperSecret123!",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("blocks collision when toggle on and a prior user shares the IP", async () => {
    const db = client.db(dbName);
    await db.collection("gameConfig").insertOne({
      _id: "default",
      registrationEnabled: true,
      ipCollisionCheckEnabled: true,
    } as any);
    await db.collection("users").insertOne({
      email: "existing@test.dev",
      username: "existing",
      registrationIp: "9.9.9.9",
      createdAt: new Date(),
      updatedAt: new Date(),
      hasCompletedSetup: false,
      role: "player",
      password: "x",
    });

    const res = await fetch(registerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "9.9.9.9" },
      body: JSON.stringify({
        email: "carol@test.dev",
        username: "carol",
        password: "SuperSecret123!",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("allows when collision toggle is off, even with a prior user on that IP", async () => {
    const db = client.db(dbName);
    await db.collection("gameConfig").insertOne({
      _id: "default",
      registrationEnabled: true,
      ipCollisionCheckEnabled: false,
    } as any);
    await db.collection("users").insertOne({
      email: "existing2@test.dev",
      username: "existing2",
      registrationIp: "9.9.9.9",
      createdAt: new Date(),
      updatedAt: new Date(),
      hasCompletedSetup: false,
      role: "player",
      password: "x",
    });

    const res = await fetch(registerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "9.9.9.9" },
      body: JSON.stringify({
        email: "dave@test.dev",
        username: "dave",
        password: "SuperSecret123!",
      }),
    });
    expect(res.status).toBe(201);
  });
}

if (!process.env.MONGODB_URI || !process.env.TEST_SERVER_URL) {
  describe.skip("POST /api/auth/register — registration gate", () => {
    it("skipped — set MONGODB_URI and TEST_SERVER_URL to run", () => {});
  });
} else {
  describe("POST /api/auth/register — registration gate", registerIntegrationSuite);
}
