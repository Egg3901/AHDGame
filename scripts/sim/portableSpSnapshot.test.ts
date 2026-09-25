/**
 * Portable SP export at the public local-world boundary (#301).
 * This test uses only a disposable ahd_sim_* Mongo database. It opens a real
 * 1953 US Head-of-State world through setup, advances the real turn engine,
 * then asks the source exporter to produce a versioned snapshot.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoClient } from "mongodb";
import { expect, it } from "vitest";

const MONGO_HOST = "mongodb://127.0.0.1:27018";

it("exports a versioned local SP world after a real 1953 US turn without account secrets", async () => {
  const dbName = `ahd_sim_sp_export_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const uri = `${MONGO_HOST}/${dbName}`;
  const previous = {
    MONGODB_URI: process.env.MONGODB_URI,
    MONGODB_DB: process.env.MONGODB_DB,
    SINGLEPLAYER: process.env.SINGLEPLAYER,
    NODE_ENV: process.env.NODE_ENV,
  };
  const scratch = mkdtempSync(join(tmpdir(), "ahd-sp-export-"));
  const output = join(scratch, "world.snapshot.json");
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = dbName;
  process.env.SINGLEPLAYER = "1";
  process.env.NODE_ENV = "test";

  try {
    // Dynamic imports are required: getDb binds its Mongo URI on first use.
    const [{ POST: setup }, { GET: status }, { processTurn }] = await Promise.all([
      import("@/app/api/singleplayer/setup/route"),
      import("@/app/api/singleplayer/status/route"),
      import("@/lib/turnSystem"),
    ]);
    const request = new Request("http://127.0.0.1/api/singleplayer/setup", {
      method: "POST",
      headers: { host: "127.0.0.1", "content-type": "application/json" },
      body: JSON.stringify({ preset: "1953-default", mode: "head-of-state", displayName: "Snapshot Test" }),
    });
    const setupResponse = await setup(request);
    expect(setupResponse.status, await setupResponse.text()).toBe(200);

    const statusRequest = new Request("http://127.0.0.1/api/singleplayer/status", {
      headers: { host: "127.0.0.1" },
    });
    const before = await (await status(statusRequest)).json();
    expect(before).toMatchObject({ hasWorld: true, preset: "1953-default", mode: "head-of-state" });
    expect(typeof before.turn).toBe("number");
    const turn = await processTurn();
    const after = await (await status(statusRequest)).json();
    expect(turn.turn).toBe(before.turn + 1);
    expect(after.turn).toBe(turn.turn);
    expect(after.turnInProgress).toBe(false);

    const run = spawnSync(process.execPath, [
      "--import", "tsx", "scripts/sim/exportPortableSpSnapshot.ts",
      "--db", dbName, "--output", output,
    ], { cwd: process.cwd(), env: { ...process.env, MONGODB_URI: uri, MONGODB_DB: dbName }, encoding: "utf8", timeout: 180_000 });
    expect(run.status, `${run.stderr}\n${run.error?.message ?? ""}`).toBe(0);
    const snapshot = JSON.parse(readFileSync(output, "utf8"));
    expect(snapshot).toMatchObject({ format: "ahd-current-sp-snapshot", version: 2,
      source: { product: "AHDGame" } });
    expect(snapshot.manifest).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "gameState", documentCount: 1 }),
    ]));
    expect(snapshot.collections).not.toHaveProperty("users");
    expect(JSON.stringify(snapshot)).not.toMatch(/password|authSecret|sessionToken|cookie/i);
  } finally {
    const cleanup = new MongoClient(uri);
    try {
      await cleanup.connect();
      await cleanup.db(dbName).dropDatabase();
    } finally {
      await cleanup.close();
      const pooled = globalThis._mongoClientPromise;
      if (pooled) await (await pooled).close();
      globalThis._mongoClientPromise = undefined;
      rmSync(scratch, { recursive: true, force: true });
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }
}, 1_800_000);
