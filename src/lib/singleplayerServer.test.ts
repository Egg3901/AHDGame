import { describe, expect, it, vi } from "vitest";
import path from "path";
import os from "os";
import type { Db } from "mongodb";
import {
  ensureSingleplayerUser,
  singleplayerCdnDir,
  singleplayerHomeDir,
} from "./singleplayerServer";

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
    expect(singleplayerCdnDir({ SINGLEPLAYER_HOME: "/tmp/ahd" })).toBe(
      path.join("/tmp/ahd", "cdn")
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
