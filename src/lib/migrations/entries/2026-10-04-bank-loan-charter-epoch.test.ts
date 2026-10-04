import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { migration } from "./2026-10-04-bank-loan-charter-epoch";

describe("2026-10-04-bank-loan-charter-epoch migration", () => {
  it("backfills from archived and current charter windows without changing loan balances", async () => {
    const db = createInMemoryDb();
    const bankId = new ObjectId();
    const archivedLoan = new ObjectId();
    const sameTurnLoan = new ObjectId();
    const unmatchedLoan = new ObjectId();
    const currentLoan = new ObjectId();
    const existingTag = new ObjectId();
    db.seed("bankCharterHistory", [
      {
        _id: new ObjectId(),
        corporationId: bankId,
        charter: { status: "failed", charteredTurn: 1 },
        archivedTurn: 20,
        reason: "recharter",
      },
      {
        _id: new ObjectId(),
        corporationId: bankId,
        charter: { status: "active", charteredTurn: 1 },
        archivedTurn: 10,
        reason: "recharter",
      },
    ]);
    db.seed("corporations", [
      { _id: bankId, bankCharter: { status: "active", charteredTurn: 30 } },
    ]);
    db.seed("bankLoans", [
      { _id: archivedLoan, bankCorporationId: bankId, originatedTurn: 5, outstanding: 400 },
      { _id: sameTurnLoan, bankCorporationId: bankId, originatedTurn: 20, outstanding: 350 },
      { _id: unmatchedLoan, bankCorporationId: bankId, originatedTurn: 0, outstanding: 300 },
      { _id: currentLoan, bankCorporationId: bankId, originatedTurn: 31, outstanding: 200 },
      {
        _id: existingTag,
        bankCorporationId: bankId,
        originatedTurn: 31,
        charteredTurn: 30,
        outstanding: 100,
      },
    ]);

    const result = await migration.execute(db as unknown as Db, { dryRun: false });
    const loans = db.collection("bankLoans").docs;
    const epochById = new Map(loans.map((loan) => [loan._id.toString(), loan.charteredTurn]));

    expect(result.documentsUpdated).toBe(3);
    expect(epochById.get(archivedLoan.toString())).toBe(1);
    expect(epochById.get(sameTurnLoan.toString())).toBe(1);
    expect(epochById.get(unmatchedLoan.toString())).toBeUndefined();
    expect(epochById.get(currentLoan.toString())).toBe(30);
    expect(epochById.get(existingTag.toString())).toBe(30);
    expect(result.notes).toContain("1 loans had no trustworthy charter match and remain untagged");
    expect(loans.map((loan) => loan.outstanding)).toEqual([400, 350, 300, 200, 100]);
  });

  it("does not write on a dry run", async () => {
    const db = createInMemoryDb();
    const bankId = new ObjectId();
    db.seed("bankLoans", [
      { _id: new ObjectId(), bankCorporationId: bankId, originatedTurn: 5, outstanding: 400 },
    ]);

    const result = await migration.execute(db as unknown as Db, { dryRun: true });

    expect(result.documentsScanned).toBe(1);
    expect(result.documentsUpdated).toBe(0);
    expect(db.collection("bankLoans").docs[0].charteredTurn).toBeUndefined();
  });
});
