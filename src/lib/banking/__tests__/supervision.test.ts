import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { BankCharter } from "@/lib/db/types/bank";
import type { Corporation } from "@/lib/db/types";
import { RECAP_GRACE_TURNS } from "../capitalAdequacy";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/news", () => ({
  createSystemNewsPost: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
}));

const TURN = 118;

function makeCharter(overrides: Partial<BankCharter> = {}): BankCharter {
  return {
    type: "investment",
    status: "active",
    currency: "USD",
    charteredTurn: 90,
    postedCapital: 143_333,
    depositOffset: 0,
    lendingOffset: 0,
    totalDeposits: 0,
    totalLoans: 0,
    propBook: [],
    propBookMarkValue: 0,
    undercapitalizedSinceTurn: TURN - RECAP_GRACE_TURNS,
    ...overrides,
  };
}

function makeCorp(charter: BankCharter, overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    name: "Oppenheimer Property Trust",
    type: "financial",
    liquidCapital: 63_000,
    liquidCurrencyCode: "USD",
    countryId: "US",
    ceoId: new ObjectId(),
    userId: new ObjectId(),
    headquartersState: "NY",
    bankCharter: charter,
    ...overrides,
  } as unknown as Corporation;
}

function applyCorpUpdate(
  corp: Corporation,
  update: {
    $inc?: Record<string, number>;
    $set?: Record<string, unknown>;
    $unset?: Record<string, string>;
  }
) {
  if (update.$inc?.liquidCapital) {
    corp.liquidCapital = (corp.liquidCapital ?? 0) + update.$inc.liquidCapital;
  }
  if (corp.bankCharter && update.$set) {
    for (const [key, value] of Object.entries(update.$set)) {
      if (key.startsWith("bankCharter.")) {
        const field = key.slice("bankCharter.".length);
        (corp.bankCharter as unknown as Record<string, unknown>)[field] = value;
      }
    }
  }
  if (corp.bankCharter && update.$unset) {
    for (const key of Object.keys(update.$unset)) {
      if (key.startsWith("bankCharter.")) {
        const field = key.slice("bankCharter.".length);
        delete (corp.bankCharter as unknown as Record<string, unknown>)[field];
      }
    }
  }
}

describe("processBankSupervision undercapitalized revoke", () => {
  let db: MockDb;
  let liveCorp: Corporation;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collection("corporations");
    db.collection("bankCharterHistory");
    db.collection("gameState");
    db.collection("gameConfig");
    db.collection("notifications");

    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: TURN,
      preset: "1953-default",
    });
  });

  function wireLiveCorp(corp: Corporation) {
    liveCorp = corp;
    db.collectionMocks.corporations!.find.mockImplementation(() => ({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([liveCorp]),
    }));
    db.collectionMocks.corporations!.findOne.mockImplementation(async () => liveCorp);
    db.collectionMocks.corporations!.updateOne.mockImplementation(
      async (
        _filter: unknown,
        update: {
          $inc?: Record<string, number>;
          $set?: Record<string, unknown>;
          $unset?: Record<string, string>;
        }
      ) => {
        applyCorpUpdate(liveCorp, update);
        return { matchedCount: 1, modifiedCount: 1 };
      }
    );
  }

  async function run() {
    const { processBankSupervision } = await import("../supervision");
    return processBankSupervision(db as unknown as Db, TURN);
  }

  it("refunds posted capital when an investment bank's recap deadline expires", async () => {
    const posted = 143_333;
    const liquid = 63_000;
    wireLiveCorp(
      makeCorp(
        makeCharter({
          postedCapital: posted,
          // Well above 8% of (posted+liquid) so this is undercapitalized on the book.
          propBookMarkValue: 3_000_000,
          propBook: [
            { asset: "equity", ref: "x", units: 1, costBasis: 3_000_000, markValue: 3_000_000 },
          ],
        }),
        { liquidCapital: liquid }
      )
    );

    const summary = await run();
    expect(summary.chartersRevoked).toBe(1);
    expect(liveCorp.bankCharter?.status).toBe("revoked");
    expect(liveCorp.bankCharter?.revokedReason).toBe("undercapitalized");
    // Prop book converted to cash, then posted capital refunded. Deposits were 0.
    expect(liveCorp.liquidCapital).toBe(liquid + 3_000_000 + posted);
    expect(liveCorp.bankCharter?.propBook).toEqual([]);
    expect(liveCorp.bankCharter?.propBookMarkValue).toBe(0);

    expect(db.collectionMocks.bankCharterHistory!.insertOne).toHaveBeenCalledTimes(1);
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    expect(emitTx).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        type: "bank_prop_trade_sell",
        amount: 3_000_000,
        meta: { reason: "supervision_revoke_unwind" },
      })
    );
    const { recordAudit } = await import("@/lib/audit/recordAudit");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "bank.charter.revoke_undercapitalized",
        meta: expect.objectContaining({
          refundedCapital: posted,
          unwoundPropBook: 3_000_000,
        }),
      })
    );
  });

  it("does not revoke while the recap clock is still running", async () => {
    const liquid = 63_000;
    wireLiveCorp(
      makeCorp(
        makeCharter({
          undercapitalizedSinceTurn: TURN - (RECAP_GRACE_TURNS - 1),
          propBookMarkValue: 3_000_000,
        }),
        { liquidCapital: liquid }
      )
    );

    const summary = await run();
    expect(summary.chartersRevoked).toBe(0);
    expect(summary.undercapitalized).toBe(1);
    expect(liveCorp.bankCharter?.status).toBe("active");
    expect(liveCorp.liquidCapital).toBe(liquid);
  });

  it("does not refund posted capital when deposits still back the book", async () => {
    const posted = 143_333;
    const liquid = 50_000;
    wireLiveCorp(
      makeCorp(
        makeCharter({
          type: "retail",
          postedCapital: posted,
          totalDeposits: 500_000,
          totalLoans: 3_000_000,
          propBookMarkValue: 0,
        }),
        { liquidCapital: liquid }
      )
    );

    const summary = await run();
    expect(summary.chartersRevoked).toBe(1);
    expect(liveCorp.bankCharter?.status).toBe("revoked");
    expect(liveCorp.liquidCapital).toBe(liquid);
    const { recordAudit } = await import("@/lib/audit/recordAudit");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ refundedCapital: 0, unwoundPropBook: 0 }),
      })
    );
  });
});
