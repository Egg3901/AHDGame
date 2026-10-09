import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { resumeFundCommandAudit } from "./playerCommandAudit";

vi.mock("@/lib/financialTxLog/expiresAt", async (original) => ({
  ...(await original<typeof import("@/lib/financialTxLog/expiresAt")>()),
  loadTurnLengthMinutes: vi.fn(async () => 10),
}));
vi.mock("@/lib/financialTxLog/emit", async (original) => ({
  ...(await original<typeof import("@/lib/financialTxLog/emit")>()),
  loadTxThresholds: vi.fn(
    async () => (await import("@/lib/db/types/financialTxLog")).DEFAULT_TX_THRESHOLDS
  ),
}));

describe("corporate fund order audit outbox", () => {
  it("freezes native cash, anchor fees and corporate identity without mirroring yen into a dollar fund", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    const fundId = new ObjectId();
    const corporationId = new ObjectId();
    const transactionId = new ObjectId();
    memory.seed("gameConfig", [{ _id: "default", ledgerShadow: true, auditLog: true }]);
    memory.seed("indexFundTransactions", [
      {
        _id: transactionId,
        fundId,
        corporationId,
        holderKind: "corporation",
        kind: "subscription",
        units: 2,
        amountAnchor: 200,
        navAnchor: 100,
        createdAt: new Date("2026-10-09"),
      },
    ]);
    memory.seed("indexFundCommands", [
      {
        _id: "receipt",
        state: "completed",
        audit: {
          fundId,
          fundName: "Fund",
          fundSlug: "fund",
          fundTicker: "F",
          holderId: corporationId,
          holderKind: "corporation",
          holderName: "Corporation",
          currencyCode: "JPY",
          fundCurrency: "USD",
          turn: 5,
          entries: [
            { transactionId, amountNative: -20100, anchorAmount: 201, balanceAfter: 79900 },
          ],
        },
      },
    ]);
    await resumeFundCommandAudit(db, "receipt");
    expect(memory.collection("financialTxLog").docs).toHaveLength(1);
    expect(memory.collection("financialTxLog").docs[0]).toMatchObject({
      subjectType: "corporation",
      subjectId: corporationId,
      amount: -20100,
      anchorAmount: -201,
      currencyCode: "JPY",
      meta: { fundCurrency: "USD" },
    });
    const ledger = memory.collection("ledgerEntries").docs;
    expect(ledger).toHaveLength(1);
    expect(JSON.stringify(ledger)).toContain(`corporation:${corporationId}:JPY`);
    expect(JSON.stringify(ledger)).not.toContain(`fund:${fundId}:JPY`);
    expect(memory.collection("actionAuditLog").docs[0]).toMatchObject({
      subject: { type: "corporation", id: corporationId },
    });
    await resumeFundCommandAudit(db, "receipt");
    expect(memory.collection("financialTxLog").docs).toHaveLength(1);
    expect(memory.collection("ledgerEntries").docs).toHaveLength(1);
  });
  it("leaves an unsupported persisted audit destination undelivered", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    memory.seed("indexFundCommands", [
      {
        _id: "unsupported",
        state: "completed",
        audit: { entries: [] },
        auditPlan: {
          rows: [{ collection: "unsupportedAudit", document: { _id: new ObjectId() } }],
        },
      },
    ]);
    await expect(resumeFundCommandAudit(db, "unsupported")).rejects.toThrow(
      "Fund command audit destination is unsupported"
    );
    expect(memory.collection("unsupportedAudit").docs).toHaveLength(0);
    expect(memory.collection("indexFundCommands").docs[0].auditCompletedAt).toBeUndefined();
  });
});
