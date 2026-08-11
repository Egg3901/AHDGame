import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { trucePairId, recordTruce, activeTruceExpiry } from "../truce";
import { TRUCE_TURNS } from "@/lib/db/types/peaceOffer";

const updateSpy = vi.fn();
let found: unknown = null;

const db = {
  collection: () => ({
    updateOne: (...a: unknown[]) => {
      updateSpy(...a);
      return Promise.resolve({ upsertedCount: 1 });
    },
    findOne: async () => found,
  }),
} as unknown as Db;

beforeEach(() => {
  vi.clearAllMocks();
  found = null;
});

describe("trucePairId", () => {
  it("is order-independent", () => {
    expect(trucePairId("UK", "CN")).toBe(trucePairId("CN", "UK"));
  });

  it("is a stable sorted key", () => {
    // Deterministic so a pair cannot accumulate rows and a lookup needs no $or.
    expect(trucePairId("UK", "CN")).toBe("CN__UK");
  });
});

describe("recordTruce", () => {
  it("expires TRUCE_TURNS after the given turn", async () => {
    await recordTruce(db, "UK", "CN", 100);
    const [, update] = updateSpy.mock.calls[0];
    expect((update as { $max: { expiresTurn: number } }).$max.expiresTurn).toBe(100 + TRUCE_TURNS);
  });

  it("keys both orderings to the same document", async () => {
    await recordTruce(db, "UK", "CN", 100);
    await recordTruce(db, "CN", "UK", 150);
    expect(updateSpy.mock.calls.every((c) => (c[0] as { _id: string })._id === "CN__UK")).toBe(
      true
    );
  });

  it("uses \$max so an out-of-order write cannot SHORTEN a live truce", async () => {
    // Resolution truces every cross-side pair, and those can overlap a truce already
    // running from an earlier deal. With $set, whichever landed last would win —
    // including one carrying an earlier expiry.
    await recordTruce(db, "UK", "CN", 100);
    const [, update] = updateSpy.mock.calls[0];
    expect(update).toHaveProperty("$max");
    expect(update).not.toHaveProperty("$set");
  });

  it("upserts", async () => {
    await recordTruce(db, "UK", "CN", 100);
    expect(updateSpy.mock.calls[0][2]).toEqual({ upsert: true });
  });

  it("stores the pair sorted, so the row is self-describing", async () => {
    await recordTruce(db, "UK", "CN", 100);
    const [, update] = updateSpy.mock.calls[0];
    expect((update as { $setOnInsert: { countries: string[] } }).$setOnInsert.countries).toEqual([
      "CN",
      "UK",
    ]);
  });
});

describe("activeTruceExpiry", () => {
  it("returns the expiry while the truce holds", async () => {
    found = { expiresTurn: 200 };
    expect(await activeTruceExpiry(db, "UK", "CN", 199)).toBe(200);
  });

  it("returns null ON the expiry turn", async () => {
    // Same boundary as isOfferLive, so "240 turns" means one thing everywhere.
    found = { expiresTurn: 200 };
    expect(await activeTruceExpiry(db, "UK", "CN", 200)).toBeNull();
  });

  it("returns null after the expiry turn", async () => {
    found = { expiresTurn: 200 };
    expect(await activeTruceExpiry(db, "UK", "CN", 201)).toBeNull();
  });

  it("returns null when no truce exists", async () => {
    expect(await activeTruceExpiry(db, "UK", "CN", 1)).toBeNull();
  });
});
