import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { makeCorporation } from "@/lib/test-utils/factories";
import { assertCeoAcquisitionWithinCap } from "@/lib/corporations/ceoShareAcquisitionCap";
import { loadCeoViewFlags } from "./ceoView";

describe("CEO purchase allowance", () => {
  it.each([false, true])(
    "shares reservations with enforcement (imperial: %s)",
    async (imperial) => {
      const db = createInMemoryDb();
      const ceoId = new ObjectId();
      const userId = new ObjectId();
      const corporation = makeCorporation({ ceoId, userId, totalShares: 1_000_000 });
      const holderField = imperial ? "imperialCharacterId" : "characterId";
      db.seed("shareTradeHistory", [
        {
          corporationId: corporation._id,
          to: { [holderField]: ceoId },
          shares: 40_000,
          turn: 130,
          kind: "market_buy",
        },
        {
          corporationId: corporation._id,
          to: { [holderField]: ceoId },
          shares: 500_000,
          turn: 79,
          kind: "market_buy",
        },
        {
          corporationId: corporation._id,
          to: { [holderField]: new ObjectId() },
          shares: 500_000,
          turn: 130,
          kind: "market_buy",
        },
      ]);
      const order = {
        corporationId: corporation._id,
        characterId: ceoId,
        type: "buy",
        status: "open",
        sharesRemaining: 20_000,
      };
      db.seed("shareOrders", [
        order,
        { ...order, status: "cancelled" },
        { ...order, type: "sell" },
        { ...order, characterId: new ObjectId() },
        { ...order, corporationId: new ObjectId() },
      ]);
      const offer = {
        corporationId: corporation._id,
        buyerCharacterId: ceoId,
        status: "pending",
        shares: 15_000,
      };
      db.seed("shareOffers", [
        offer,
        { ...offer, status: "accepted" },
        { ...offer, buyerCharacterId: new ObjectId() },
        { ...offer, corporationId: new ObjectId() },
      ]);
      const flags = await loadCeoViewFlags(
        db as never,
        corporation,
        userId.toString(),
        imperial,
        200
      );
      expect(flags.ceoShareWindow).toMatchObject({
        acquiredShares: 40_000,
        reservedShares: 35_000,
        remainingShares: 25_000,
        capShares: 100_000,
        freesUpInTurns: 50,
      });
      expect(
        await assertCeoAcquisitionWithinCap(
          db as never,
          corporation,
          ceoId,
          holderField,
          25_000,
          200
        )
      ).toBeNull();
      expect(
        await assertCeoAcquisitionWithinCap(
          db as never,
          corporation,
          ceoId,
          holderField,
          25_001,
          200
        )
      ).toMatchObject({ status: 400 });
    }
  );

  it.each(["private", "vacant", "other viewer", "anonymous"] as const)(
    "does not expose a window for %s",
    async (mode) => {
      const db = createInMemoryDb();
      const userId = new ObjectId();
      const ceoId = new ObjectId();
      const corporation = makeCorporation({
        userId,
        ceoId,
        isPrivate: mode === "private",
        ceoVacant: mode === "vacant",
      });
      const viewer =
        mode === "anonymous"
          ? null
          : mode === "other viewer"
            ? new ObjectId().toString()
            : userId.toString();
      expect(
        (await loadCeoViewFlags(db as never, corporation, viewer, false, 200)).ceoShareWindow
      ).toBeNull();
      if (mode === "private" || mode === "vacant") {
        expect(
          await assertCeoAcquisitionWithinCap(
            db as never,
            corporation,
            ceoId,
            "characterId",
            1_000_000,
            200
          )
        ).toBeNull();
      }
    }
  );
});

describe("ceoIsInactive banner", () => {
  const STALE = new Date(Date.now() - 200 * 60 * 60 * 1000);

  async function flagFor(overrides: Parameters<typeof makeCorporation>[0]) {
    const db = createInMemoryDb();
    const userId = new ObjectId();
    db.seed("users", [{ _id: userId, lastActivity: STALE, createdAt: STALE }]);
    const corporation = makeCorporation({ userId, ceoId: new ObjectId(), ...overrides });
    return (await loadCeoViewFlags(db as never, corporation, null, false, 200)).ceoIsInactive;
  }

  it("flags a human CEO whose user has been away past the threshold", async () => {
    expect(await flagFor({ ceoType: "character" })).toBe(true);
  });

  it("never flags an NPP caretaker corp that keeps the owner's userId", async () => {
    expect(await flagFor({ ceoType: "npp" })).toBe(false);
  });

  it("does not flag vacant or nationalized corps", async () => {
    expect(await flagFor({ ceoType: "character", ceoVacant: true })).toBe(false);
    expect(await flagFor({ ceoType: "character", isNationalized: true })).toBe(false);
  });
});
