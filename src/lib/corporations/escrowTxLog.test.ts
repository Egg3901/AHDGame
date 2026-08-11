import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { buildEscrowFundingTxEntry, buildEscrowWithdrawalTxEntry } from "./escrowTxLog";

const corpId = new ObjectId();
const createdAt = new Date("2026-06-06T00:00:00Z");

describe("buildEscrowFundingTxEntry", () => {
  it("builds a negative corp_escrow_funding debit row", () => {
    const entry = buildEscrowFundingTxEntry({
      corpId,
      corpName: "BilliBilli",
      currencyCode: "CNY",
      turn: 155,
      createdAt,
      escrowFundingMove: 1_300_000,
      escrowBalanceAfter: 57_800_000,
    });
    expect(entry).toMatchObject({
      type: "corp_escrow_funding",
      subjectType: "corporation",
      subjectId: corpId,
      subjectName: "BilliBilli",
      amount: -1_300_000,
      currencyCode: "CNY",
      counterpartyType: "system",
      turn: 155,
      meta: { escrowBalanceAfter: 57_800_000 },
    });
  });
  it("returns null when the move is zero or negative", () => {
    const base = {
      corpId,
      corpName: "X",
      currencyCode: "CNY" as const,
      turn: 1,
      createdAt,
      escrowBalanceAfter: 0,
    };
    expect(buildEscrowFundingTxEntry({ ...base, escrowFundingMove: 0 })).toBeNull();
    expect(buildEscrowFundingTxEntry({ ...base, escrowFundingMove: -5 })).toBeNull();
  });
});

describe("buildEscrowWithdrawalTxEntry", () => {
  it("builds a positive corp_escrow_withdrawal credit row", () => {
    const entry = buildEscrowWithdrawalTxEntry({
      corpId,
      corpName: "BilliBilli",
      currencyCode: "CNY",
      turn: 155,
      createdAt,
      amount: 5_000_000,
      escrowBalanceAfter: 51_500_000,
    });
    expect(entry).toMatchObject({
      type: "corp_escrow_withdrawal",
      subjectType: "corporation",
      subjectId: corpId,
      subjectName: "BilliBilli",
      amount: 5_000_000,
      currencyCode: "CNY",
      counterpartyType: "system",
      turn: 155,
      meta: { escrowBalanceAfter: 51_500_000 },
    });
  });
  it("returns null when amount is zero or negative", () => {
    const base = {
      corpId,
      corpName: "X",
      currencyCode: "CNY" as const,
      turn: 1,
      createdAt,
      escrowBalanceAfter: 0,
    };
    expect(buildEscrowWithdrawalTxEntry({ ...base, amount: 0 })).toBeNull();
    expect(buildEscrowWithdrawalTxEntry({ ...base, amount: -5 })).toBeNull();
  });
});
