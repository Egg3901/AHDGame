import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  getSingleplayerWorldAvailability,
  setSingleplayerWorldAvailability,
} from "./singleplayerOperator";

beforeEach(() => {
  vi.stubEnv("SINGLEPLAYER", "1");
  vi.stubEnv("MONGODB_URI", "mongodb://127.0.0.1:27099/ahd-singleplayer");
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "http://127.0.0.1:3111");
});

afterEach(() => vi.unstubAllEnvs());

describe("singleplayer operator world availability", () => {
  it("ignores hosted maintenance inherited from a seed", async () => {
    const db = createMockDb();
    db.collection("gameConfig").findOne.mockResolvedValue({ maintenanceMode: "full" });
    await expect(getSingleplayerWorldAvailability(db as unknown as Db)).resolves.toBe("off");
    expect(db.collectionMocks.gameConfig.updateOne).not.toHaveBeenCalled();
  });

  it("opens only the local world through an explicit operation", async () => {
    const db = createMockDb();
    await expect(setSingleplayerWorldAvailability(db as unknown as Db, "open")).resolves.toBe(
      "off"
    );
    expect(db.collectionMocks.singleplayerRuntime.updateOne).toHaveBeenCalledWith(
      { _id: "current" },
      expect.objectContaining({ $set: { paused: false } }),
      { upsert: true }
    );
  });

  it("seals the local world without granting hosted admin", async () => {
    const db = createMockDb();
    await expect(setSingleplayerWorldAvailability(db as unknown as Db, "sealed")).resolves.toBe(
      "full"
    );
    expect(db.collectionMocks.singleplayerRuntime.updateOne).toHaveBeenCalledWith(
      { _id: "current" },
      expect.objectContaining({
        $set: expect.objectContaining({
          paused: true,
        }),
      }),
      { upsert: true }
    );
  });

  it("cannot operate when the process is not a valid singleplayer runtime", async () => {
    vi.stubEnv("SINGLEPLAYER", "0");
    const db = createMockDb();
    await expect(getSingleplayerWorldAvailability(db as unknown as Db)).rejects.toThrow(
      "Singleplayer operator is unavailable"
    );
  });
});
