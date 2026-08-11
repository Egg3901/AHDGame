import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/govBudgetFields", () => ({
  // Identity at rate 1 — tests pass an empty FX map (rate defaults to 1).
  writeGovBudgetLocal: vi.fn((v: number) => v),
}));

let db: MockDb;
const fx = new Map<CurrencyCode, number>();
const now = new Date("2026-05-31T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("federalBudget");
});

describe("debitTreasuryCompensation", () => {
  it("unconditionally debits the country's treasury balance", async () => {
    const { debitTreasuryCompensation } = await import("./treasury");
    const debited = await debitTreasuryCompensation(db as unknown as Db, "CN", 4000, fx, now);

    expect(debited).toBe(4000);
    const update = db.collectionMocks.federalBudget.updateOne.mock.calls[0];
    expect(update[0]).toEqual({ countryId: "CN" });
    expect(update[1].$inc.treasuryBalance).toBe(-4000);
  });

  it("debits even when the treasury is in the hole (no affordability gate / no throw)", async () => {
    const { debitTreasuryCompensation } = await import("./treasury");
    const debited = await debitTreasuryCompensation(db as unknown as Db, "CN", 9999, fx, now);

    expect(debited).toBe(9999);
    expect(db.collectionMocks.federalBudget.updateOne.mock.calls[0][1].$inc.treasuryBalance).toBe(
      -9999
    );
  });

  it("is a no-op for a zero payout (seizure tier)", async () => {
    const { debitTreasuryCompensation } = await import("./treasury");
    const debited = await debitTreasuryCompensation(db as unknown as Db, "CN", 0, fx, now);

    expect(debited).toBe(0);
    expect(db.collectionMocks.federalBudget.updateOne).not.toHaveBeenCalled();
  });
});

describe("creditTreasuryProceeds", () => {
  it("increments the treasury balance by the (already-local) proceeds", async () => {
    const { creditTreasuryProceeds } = await import("./treasury");
    const local = await creditTreasuryProceeds(db as unknown as Db, "CN", 250_000, now);

    expect(local).toBe(250_000);
    const call = db.collectionMocks.federalBudget.updateOne.mock.calls[0];
    expect(call[0]).toEqual({ countryId: "CN" });
    expect(call[1].$inc.treasuryBalance).toBe(250_000);
  });

  it("is a no-op for non-positive proceeds", async () => {
    const { creditTreasuryProceeds } = await import("./treasury");
    const local = await creditTreasuryProceeds(db as unknown as Db, "CN", 0, now);

    expect(local).toBe(0);
    expect(db.collectionMocks.federalBudget.updateOne).not.toHaveBeenCalled();
  });
});

describe("coverSoeOperatingLoss", () => {
  it("debits the treasury balance by the loss shortfall", async () => {
    const { coverSoeOperatingLoss } = await import("./treasury");
    const local = await coverSoeOperatingLoss(db as unknown as Db, "CN", 5000, fx, now);

    expect(local).toBe(5000);
    const call = db.collectionMocks.federalBudget.updateOne.mock.calls[0];
    expect(call[0]).toEqual({ countryId: "CN" });
    expect(call[1].$inc.treasuryBalance).toBe(-5000);
  });
});

describe("drawFromTreasury", () => {
  const corpId = new ObjectId();
  beforeEach(() => {
    db.collection("corporations");
  });

  it("moves the amount from the treasury → corp liquidCapital", async () => {
    const { drawFromTreasury } = await import("./treasury");
    const res = await drawFromTreasury(
      db as unknown as Db,
      { countryId: "CN", corpId, amountLocal: 3000 },
      now
    );

    expect(res).toEqual({ ok: true, amount: 3000 });
    const fb = db.collectionMocks.federalBudget.updateOne.mock.calls[0];
    expect(fb[0]).toEqual({ countryId: "CN" });
    expect(fb[1].$inc.treasuryBalance).toBe(-3000);
    const corp = db.collectionMocks.corporations.updateOne.mock.calls[0];
    expect(corp[0]).toEqual({ _id: corpId });
    expect(corp[1].$inc.liquidCapital).toBe(3000);
  });

  it("draws unconditionally even when the treasury is short — takes on debt", async () => {
    const { drawFromTreasury } = await import("./treasury");
    const res = await drawFromTreasury(
      db as unknown as Db,
      { countryId: "CN", corpId, amountLocal: 9999 },
      now
    );

    expect(res).toEqual({ ok: true, amount: 9999 });
    expect(db.collectionMocks.federalBudget.updateOne.mock.calls[0][1].$inc.treasuryBalance).toBe(
      -9999
    );
    expect(db.collectionMocks.corporations.updateOne.mock.calls[0][1].$inc.liquidCapital).toBe(
      9999
    );
  });
});

describe("remitToTreasury", () => {
  const corpId = new ObjectId();
  beforeEach(() => {
    db.collection("corporations");
  });

  it("moves the amount from corp liquidCapital → the treasury", async () => {
    const { remitToTreasury } = await import("./treasury");
    const amt = await remitToTreasury(
      db as unknown as Db,
      { countryId: "CN", corpId, amountLocal: 1200 },
      now
    );

    expect(amt).toBe(1200);
    const corp = db.collectionMocks.corporations.updateOne.mock.calls[0];
    expect(corp[0]).toEqual({ _id: corpId });
    expect(corp[1].$inc.liquidCapital).toBe(-1200);
    expect(db.collectionMocks.federalBudget.updateOne.mock.calls[0][1].$inc.treasuryBalance).toBe(
      1200
    );
  });

  it("is a no-op for a non-positive amount", async () => {
    const { remitToTreasury } = await import("./treasury");
    const amt = await remitToTreasury(
      db as unknown as Db,
      { countryId: "CN", corpId, amountLocal: 0 },
      now
    );

    expect(amt).toBe(0);
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });
});
