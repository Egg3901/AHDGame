import { describe, it, expect, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  computeExpiresAt,
  computeExpiresAtSync,
  loadTurnLengthMinutes,
  defaultExpiresAt,
} from "../expiresAt";
import { TX_TTL_TURNS, DEFAULT_TURN_LENGTH_MINUTES } from "@/lib/db/types/financialTxLog";

describe("computeExpiresAt (async, reads gameConfig)", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("gameConfig");
  });

  it("uses turnLengthMinutes from gameConfig when present", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({ turnLengthMinutes: 30 });
    const createdAt = new Date("2026-04-27T00:00:00Z");

    const expiresAt = await computeExpiresAt(db as never, createdAt);

    // 168 turns × 30 min × 60_000 = 302_400_000 ms = 3.5 IRL days
    const expected = new Date(createdAt.getTime() + 168 * 30 * 60_000);
    expect(expiresAt.getTime()).toBe(expected.getTime());
  });

  it("falls back to DEFAULT_TURN_LENGTH_MINUTES when gameConfig missing", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue(null);
    const createdAt = new Date("2026-04-27T00:00:00Z");

    const expiresAt = await computeExpiresAt(db as never, createdAt);

    const expected = new Date(
      createdAt.getTime() + TX_TTL_TURNS * DEFAULT_TURN_LENGTH_MINUTES * 60_000
    );
    expect(expiresAt.getTime()).toBe(expected.getTime());
  });

  it("falls back to default when turnLengthMinutes is undefined on the doc", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({ _id: "default" });
    const createdAt = new Date("2026-04-27T00:00:00Z");

    const expiresAt = await computeExpiresAt(db as never, createdAt);

    expect(expiresAt.getTime()).toBe(
      createdAt.getTime() + TX_TTL_TURNS * DEFAULT_TURN_LENGTH_MINUTES * 60_000
    );
  });
});

describe("computeExpiresAtSync", () => {
  it("multiplies turn count × turn length × 60_000 ms", () => {
    const createdAt = new Date("2026-04-27T00:00:00Z");
    const expiresAt = computeExpiresAtSync(createdAt, 60);

    // Default 168 turns × 60 min = 7 IRL days
    const expected = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    expect(expiresAt.getTime()).toBe(expected.getTime());
  });

  it("scales linearly with turn length", () => {
    const createdAt = new Date("2026-04-27T00:00:00Z");
    const at60 = computeExpiresAtSync(createdAt, 60).getTime();
    const at120 = computeExpiresAtSync(createdAt, 120).getTime();
    expect(at120 - createdAt.getTime()).toBe(2 * (at60 - createdAt.getTime()));
  });
});

describe("loadTurnLengthMinutes", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("gameConfig");
  });

  it("returns the configured value", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({ turnLengthMinutes: 45 });
    expect(await loadTurnLengthMinutes(db as never)).toBe(45);
  });

  it("falls back to default when missing", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue(null);
    expect(await loadTurnLengthMinutes(db as never)).toBe(DEFAULT_TURN_LENGTH_MINUTES);
  });
});

describe("defaultExpiresAt (no DB)", () => {
  it("uses the default 168 × 60 min cadence", () => {
    const createdAt = new Date("2026-04-27T00:00:00Z");
    const expiresAt = defaultExpiresAt(createdAt);
    const expected = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    expect(expiresAt.getTime()).toBe(expected.getTime());
  });
});
