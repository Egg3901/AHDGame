import { describe, expect, it, vi } from "vitest";
import path from "path";
import os from "os";
import type { Db } from "mongodb";
import {
  ensureSingleplayerUser,
  setSingleplayerConfig,
  singleplayerCdnDir,
  singleplayerHomeDir,
  singleplayerStatus,
} from "./singleplayerServer";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { reconcileSingleplayerHeadOfState } from "@/lib/singleplayerHeadOfState";

vi.mock("@/lib/singleplayerHeadOfState", () => ({
  reconcileSingleplayerHeadOfState: vi.fn().mockResolvedValue(false),
}));

describe("singleplayer data directory", () => {
  it("defaults to a dotfolder in the home directory", () => {
    expect(singleplayerHomeDir({})).toBe(path.join(os.homedir(), ".a-house-divided"));
  });

  it("honours SINGLEPLAYER_HOME and resolves it", () => {
    expect(singleplayerHomeDir({ SINGLEPLAYER_HOME: "./worlds " })).toBe(path.resolve("./worlds"));
  });

  it("ignores a blank override", () => {
    expect(singleplayerHomeDir({ SINGLEPLAYER_HOME: "   " })).toBe(
      path.join(os.homedir(), ".a-house-divided")
    );
  });

  it("keeps the CDN mirror inside the data directory", () => {
    // Against the RESOLVED home, which is what singleplayerHomeDir returns and
    // what the test above pins. On a POSIX box resolve("/tmp/ahd") is itself,
    // so joining the raw string passed by coincidence; on Windows the same
    // path resolves against the current drive and the two stop matching.
    expect(singleplayerCdnDir({ SINGLEPLAYER_HOME: "/tmp/ahd" })).toBe(
      path.join(path.resolve("/tmp/ahd"), "cdn")
    );
  });
});

describe("singleplayer account", () => {
  it("creates the fixed local user with one atomic upsert", async () => {
    const updateOne = vi.fn().mockResolvedValue({ upsertedCount: 1 });
    const db = { collection: vi.fn(() => ({ updateOne })) } as unknown as Db;

    await expect(ensureSingleplayerUser(db)).resolves.toEqual({ created: true });
    expect(updateOne).toHaveBeenCalledOnce();
    expect(updateOne.mock.calls[0]?.[1]).toHaveProperty("$setOnInsert");
    expect(updateOne.mock.calls[0]?.[2]).toEqual({ upsert: true });
  });
});

describe("singleplayer maintenance recovery", () => {
  it("repairs a head-of-state world during the launcher status handshake", async () => {
    const db = createMockDb();
    vi.mocked(reconcileSingleplayerHeadOfState).mockClear();
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 3,
      preset: "2019-default",
      singleplayerConfig: { mode: "head-of-state" },
    });

    await singleplayerStatus(db as unknown as Db);

    expect(reconcileSingleplayerHeadOfState).toHaveBeenCalledWith(db, {
      preset: "2019-default",
    });
  });

  it("clears hosted maintenance when an existing local world reports status", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 1,
      preset: "modern",
    });

    await singleplayerStatus(db as unknown as Db);

    expect(db.collectionMocks.gameConfig.updateOne).toHaveBeenCalledWith(
      { _id: "default", maintenanceMode: { $ne: "off" } },
      {
        $set: { maintenanceMode: "off" },
        $unset: {
          maintenanceReason: "",
          maintenanceExpectedEnd: "",
          maintenanceEnabledBy: "",
          maintenanceEnabledAt: "",
        },
      }
    );
  });

  it("clears reset maintenance when a new local world is configured", async () => {
    const db = createMockDb();

    await setSingleplayerConfig(db as unknown as Db, {
      mode: "normal",
      difficulty: "normal",
      nppAutonomyLevel: "v4",
      permanentHeadOfState: false,
    });

    expect(db.collectionMocks.gameConfig.updateOne).toHaveBeenCalledWith(
      { _id: "default", maintenanceMode: { $ne: "off" } },
      expect.objectContaining({ $set: { maintenanceMode: "off" } })
    );
  });
});
