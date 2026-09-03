/**
 * The API's per-flag readers and the turn's policy snapshot must agree on
 * every config document. They used to be four functions with four defaults;
 * now they are one interpretation read two ways, and this proves it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  isBankContagionEnabled,
  isBankPropTradingEnabled,
  isPrivateBankingEnabled,
} from "@/lib/banking/featureFlag";
import { isLineOfCreditEnabled } from "@/lib/lineOfCredit/featureFlag";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { resolveBankingPolicy, type BankingPolicyConfig } from "@/lib/banking/rules/policy";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const TRI = [true, false, undefined] as const;

function configMatrix(): BankingPolicyConfig[] {
  const out: BankingPolicyConfig[] = [];
  for (const privateBankingEnabled of TRI)
    for (const bankPropTradingEnabled of TRI)
      for (const bankContagionEnabled of TRI)
        for (const lineOfCreditEnabled of TRI)
          out.push({
            privateBankingEnabled,
            bankPropTradingEnabled,
            bankContagionEnabled,
            lineOfCreditEnabled,
          });
  return out;
}

describe("banking policy consistency", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("gameConfig");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("per-flag readers with a preloaded config equal the snapshot", async () => {
    for (const config of configMatrix()) {
      const snapshot = resolveBankingPolicy(config);
      expect(await isPrivateBankingEnabled(config)).toBe(snapshot.privateBanking);
      expect(await isBankPropTradingEnabled(config)).toBe(snapshot.propTrading);
      expect(await isBankContagionEnabled(config)).toBe(snapshot.contagion);
      expect(await isLineOfCreditEnabled(config)).toBe(snapshot.lineOfCredit);
    }
  });

  it("per-flag readers that hit the database equal the snapshot the turn loads", async () => {
    for (const config of configMatrix()) {
      db.collectionMocks.gameConfig!.findOne.mockResolvedValue({ _id: "default", ...config });
      const turnView = await loadBankingPolicy(db as unknown as Db);
      expect(await isPrivateBankingEnabled()).toBe(turnView.privateBanking);
      expect(await isBankPropTradingEnabled()).toBe(turnView.propTrading);
      expect(await isBankContagionEnabled()).toBe(turnView.contagion);
      expect(await isLineOfCreditEnabled()).toBe(turnView.lineOfCredit);
    }
  });

  it("treats a missing config document as banking off and LOC on, both ways", async () => {
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue(null);
    const turnView = await loadBankingPolicy(db as unknown as Db);
    expect(turnView.privateBanking).toBe(false);
    expect(turnView.lineOfCredit).toBe(true);
    expect(await isPrivateBankingEnabled()).toBe(false);
    expect(await isLineOfCreditEnabled()).toBe(true);
  });
});
