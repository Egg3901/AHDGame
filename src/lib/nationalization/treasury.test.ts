import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/govBudgetFields", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/currency/govBudgetFields")>()),
  // Identity at rate 1 — tests pass an empty FX map (rate defaults to 1).
  // The anchor-aware credit passes a real rate, so honour it when present.
  writeGovBudgetLocal: vi.fn((v: number, _code: string, rate?: number) =>
    typeof rate === "number" && rate > 0 ? v * rate : v
  ),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  getCurrencyFxRate: vi.fn(),
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

describe("2027 EUR treasury denomination", () => {
  it("converts compensation, SOE loss cover and capex grants using the persisted budget currency", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      countryId: "FR",
      currencyCode: "EUR",
    });
    const { debitTreasuryCompensation, coverSoeOperatingLoss, debitTreasurySoeCapex } =
      await import("./treasury");
    const rates = new Map<CurrencyCode, number>([
      ["EUR", 1.2],
      ["FRF", 6],
    ]);

    expect(await debitTreasuryCompensation(db as unknown as Db, "FR", 100, rates, now)).toBe(120);
    expect(await coverSoeOperatingLoss(db as unknown as Db, "FR", 50, rates, now)).toBe(60);
    expect(await debitTreasurySoeCapex(db as unknown as Db, "FR", 25, rates, now)).toBe(30);
    expect(
      db.collectionMocks.federalBudget.updateOne.mock.calls.map(
        (call) => call[1].$inc.treasuryBalance
      )
    ).toEqual([-120, -60, -30]);
  });

  it("credits cross-border anchor proceeds in the receiving treasury's EUR", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      countryId: "FR",
      currencyCode: "EUR",
    });
    const { getCurrencyFxRate } = await import("@/lib/currency/corporationCapital");
    vi.mocked(getCurrencyFxRate).mockResolvedValue(1.2);
    const { creditTreasuryProceedsFromAnchor } = await import("./treasury");

    expect(await creditTreasuryProceedsFromAnchor(db as unknown as Db, "FR", 100, now)).toBe(120);
    expect(getCurrencyFxRate).toHaveBeenCalledWith(db, "EUR");
    expect(db.collectionMocks.federalBudget.updateOne.mock.calls[0][1].$inc.treasuryBalance).toBe(
      120
    );
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
      { countryId: "CN", corpId, amountLocal: 3000, corpCurrency: "CNY" },
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
      { countryId: "CN", corpId, amountLocal: 9999, corpCurrency: "CNY" },
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
      { countryId: "CN", corpId, amountLocal: 1200, corpCurrency: "CNY" },
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
      { countryId: "CN", corpId, amountLocal: 0, corpCurrency: "CNY" },
      now
    );

    expect(amt).toBe(0);
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });
});

describe("creditTreasuryProceedsFromAnchor", () => {
  it("converts the anchor amount into the RECEIVING country's currency (#808)", async () => {
    // A fine debited from a GBP corporation must not be banked by the US
    // treasury as the same raw number: it is an ₳ amount, converted for the
    // country that is actually receiving it.
    const { getCurrencyFxRate } = await import("@/lib/currency/corporationCapital");
    vi.mocked(getCurrencyFxRate).mockResolvedValue(0.75);

    const { creditTreasuryProceedsFromAnchor } = await import("./treasury");
    const credited = await creditTreasuryProceedsFromAnchor(db as unknown as Db, "UK", 1000, now);

    expect(credited).toBe(750);
    const update = db.collectionMocks.federalBudget.updateOne.mock.calls[0];
    expect(update[0]).toEqual({ countryId: "UK" });
    expect(update[1].$inc.treasuryBalance).toBe(750);
  });

  it("credits the anchor amount unchanged at parity", async () => {
    const { getCurrencyFxRate } = await import("@/lib/currency/corporationCapital");
    vi.mocked(getCurrencyFxRate).mockResolvedValue(1);

    const { creditTreasuryProceedsFromAnchor } = await import("./treasury");
    expect(await creditTreasuryProceedsFromAnchor(db as unknown as Db, "US", 500, now)).toBe(500);
  });

  it("is a no-op for a non-positive amount and never touches the ledger", async () => {
    const { getCurrencyFxRate } = await import("@/lib/currency/corporationCapital");
    vi.mocked(getCurrencyFxRate).mockResolvedValue(1);

    const { creditTreasuryProceedsFromAnchor } = await import("./treasury");
    expect(await creditTreasuryProceedsFromAnchor(db as unknown as Db, "US", 0, now)).toBe(0);
    expect(await creditTreasuryProceedsFromAnchor(db as unknown as Db, "US", -5, now)).toBe(0);
    expect(db.collectionMocks.federalBudget.updateOne).not.toHaveBeenCalled();
  });

  it("does not credit a sub-unit amount that rounds to zero", async () => {
    const { getCurrencyFxRate } = await import("@/lib/currency/corporationCapital");
    vi.mocked(getCurrencyFxRate).mockResolvedValue(0.0001);

    const { creditTreasuryProceedsFromAnchor } = await import("./treasury");
    expect(await creditTreasuryProceedsFromAnchor(db as unknown as Db, "UK", 1, now)).toBe(0);
    expect(db.collectionMocks.federalBudget.updateOne).not.toHaveBeenCalled();
  });
});
