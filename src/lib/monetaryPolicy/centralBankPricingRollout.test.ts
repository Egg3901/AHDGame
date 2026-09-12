import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";

const { createNotificationsMock } = vi.hoisted(() => ({
  createNotificationsMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/notifications", () => ({
  createNotifications: createNotificationsMock,
}));

import {
  ensureCentralBankPricingPhaseIn,
  loadCentralBankPricingAdjustment,
} from "./centralBankPricing";

describe("central-bank pricing rollout", () => {
  let db: InMemoryDb;

  beforeEach(() => {
    db = createInMemoryDb();
    createNotificationsMock.mockClear();
  });

  it("starts once, notifies exposed players, and does not repeat the notice", async () => {
    const playerId = new ObjectId();
    const otherPlayerId = new ObjectId();
    await db.collection("gameConfig").insertOne({
      _id: "default",
      centralBankPricingPhaseIn: {},
    });
    await db.collection("characters").insertMany([
      {
        _id: new ObjectId(),
        userId: playerId,
        lineOfCredit: { balances: { USD: 100 }, arrears: {} },
        currencyBalances: { savings: { USD: 200 }, savingsHolder: { USD: "centralBank" } },
      },
      {
        _id: new ObjectId(),
        userId: otherPlayerId,
        currencyBalances: { savings: { USD: 200 }, savingsHolder: { USD: "private-bank" } },
      },
    ]);

    const first = await ensureCentralBankPricingPhaseIn(db as unknown as Db, 10);
    expect(first).toMatchObject({
      spreadHikePercentPoints: 0,
      depositBonusPercentPoints: 0,
      progress: 0,
    });
    expect(createNotificationsMock).toHaveBeenCalledTimes(1);
    expect(createNotificationsMock.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        userId: playerId,
        type: "system",
        metadata: expect.objectContaining({ type: "central_bank_pricing_change" }),
      }),
    ]);

    const second = await ensureCentralBankPricingPhaseIn(db as unknown as Db, 11);
    expect(second).toMatchObject({
      spreadHikePercentPoints: 0.25,
      depositBonusPercentPoints: 0.03125,
    });
    expect(createNotificationsMock).toHaveBeenCalledTimes(1);

    await expect(loadCentralBankPricingAdjustment(db as unknown as Db, 18)).resolves.toMatchObject({
      spreadHikePercentPoints: 2,
      depositBonusPercentPoints: 0.25,
      progress: 1,
    });
  });
});
