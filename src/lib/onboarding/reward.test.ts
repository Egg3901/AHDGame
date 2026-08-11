import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn() }));

const CHARACTER = {
  _id: new ObjectId(),
  name: "Test Founder",
  countryId: "US" as const,
  sequentialId: 42,
};

describe("grantOnboardingReward", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();

    db.collection("gameConfig").findOne.mockResolvedValue({ startingFunds: 250_000 });
    db.collection("exchangeRates").findOne.mockResolvedValue({ rate: 2 });
    db.collection("characters").updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);
  });

  it("pays 20% of starting funds, credits both mirrors, and stamps atomically", async () => {
    const { grantOnboardingReward } = await import("./reward");
    const result = await grantOnboardingReward(db as unknown as Db, CHARACTER, 900);

    expect(result.granted).toBe(true);
    expect(result.amount).toBe(50_000);

    const [filter, update] = db.collectionMocks.characters!.updateOne.mock.calls[0];
    expect(filter._id).toBe(CHARACTER._id);
    expect(filter["onboarding.rewardGrantedAt"]).toEqual({ $exists: false });
    expect(update.$inc.funds).toBe(50_000);
    expect(update.$inc["currencyBalances.campaign"]).toBe(100_000); // rate = 2
    expect(update.$set["onboarding.rewardGrantedAt"]).toBeInstanceOf(Date);
    expect(update.$set["onboarding.rewardAmount"]).toBe(50_000);
  });

  it("logs the payout to financialTxLog as onboarding_reward in home currency", async () => {
    const { grantOnboardingReward } = await import("./reward");
    await grantOnboardingReward(db as unknown as Db, CHARACTER, 900);

    const { emitTx } = await import("@/lib/financialTxLog/emit");
    expect(emitTx).toHaveBeenCalledTimes(1);
    const entry = vi.mocked(emitTx).mock.calls[0][1];
    expect(entry).toMatchObject({
      type: "onboarding_reward",
      turn: 900,
      subjectType: "character",
      subjectId: CHARACTER._id,
      subjectName: "Test Founder",
      amount: 100_000,
      anchorAmount: 50_000,
      currencyCode: "USD",
    });
  });

  it("never pays twice: a granted stamp makes the update match nothing and skips the ledger", async () => {
    db.collection("characters").updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

    const { grantOnboardingReward } = await import("./reward");
    const result = await grantOnboardingReward(db as unknown as Db, CHARACTER, 900);

    expect(result.granted).toBe(false);
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    expect(emitTx).not.toHaveBeenCalled();
  });

  it("skips the currencyBalances mirror when forex is disabled", async () => {
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(false);

    const { grantOnboardingReward } = await import("./reward");
    await grantOnboardingReward(db as unknown as Db, CHARACTER, 900);

    const [, update] = db.collectionMocks.characters!.updateOne.mock.calls[0];
    expect(update.$inc).toEqual({ funds: 50_000 });

    const { emitTx } = await import("@/lib/financialTxLog/emit");
    const entry = vi.mocked(emitTx).mock.calls[0][1];
    expect(entry.amount).toBe(50_000);
    expect(entry.anchorAmount).toBe(50_000);
  });

  it("falls back to the default starting funds when gameConfig is missing", async () => {
    db.collection("gameConfig").findOne.mockResolvedValue(null);

    const { grantOnboardingReward } = await import("./reward");
    const result = await grantOnboardingReward(db as unknown as Db, CHARACTER, 900);
    expect(result.amount).toBe(50_000);
  });
});
