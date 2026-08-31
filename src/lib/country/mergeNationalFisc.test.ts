import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(
    new Map([
      ["DDM", 4.2],
      ["EUR", 8.4],
    ])
  ),
}));

const { mergeNationalFisc } = await import("./mergeNationalFisc");
const { isForexEnabled } = await import("@/lib/currency/featureFlag");

function cursorOf<T>(docs: T[]) {
  const c = { project: vi.fn(() => c), toArray: vi.fn().mockResolvedValue(docs) };
  return c;
}

// DD currency is DDM, DE currency maps to EUR in COUNTRY_CURRENCY_MAP; the
// mocked rates make the scale an exact 2 so every conversion is easy to eyeball.
describe("mergeNationalFisc", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("bonds").find.mockReturnValue(cursorOf([]));
    db.collection("enactedLaws").find.mockReturnValue(cursorOf([]));
  });

  it("moves the signed treasury at the FX scale and recomputes both debt mirrors", async () => {
    db.collection("federalBudget")
      .findOne.mockResolvedValueOnce({
        _id: "DD",
        treasuryBalance: -1000,
        debt: { principal: 1000 },
        defenseAppropriation: { balance: 50 },
      })
      .mockResolvedValueOnce({ _id: "DE", treasuryBalance: 5000, debt: { principal: 0 } });

    const res = await mergeNationalFisc(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 510,
    });

    expect(res.fxScale).toBe(2);
    expect(res.treasuryMoved).toBe(-2000);
    const calls = db.collectionMocks["federalBudget"].updateOne.mock.calls;
    const deSet = calls.find((c) => c[0]._id === "DE")![1];
    expect(deSet.$set.treasuryBalance).toBe(3000); // 5000 + (−1000 × 2)
    expect(deSet.$set["debt.principal"]).toBe(0);
    expect(deSet.$inc["defenseAppropriation.balance"]).toBe(100); // 50 × 2
    const ddSet = calls.find((c) => c[0]._id === "DD")![1].$set;
    expect(ddSet.treasuryBalance).toBe(0);
    expect(ddSet["debt.principal"]).toBe(0);
    expect(ddSet["defenseAppropriation.balance"]).toBe(0);
    expect(ddSet.mergedInto).toEqual({ countryId: "DE", turn: 510 });
  });

  it("a deficit large enough to sink the survivor sets the survivor's debt mirror", async () => {
    db.collection("federalBudget")
      .findOne.mockResolvedValueOnce({
        _id: "DD",
        treasuryBalance: -4000,
        debt: { principal: 4000 },
      })
      .mockResolvedValueOnce({ _id: "DE", treasuryBalance: 5000, debt: { principal: 0 } });

    await mergeNationalFisc(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 510,
    });

    const calls = db.collectionMocks["federalBudget"].updateOne.mock.calls;
    const deSet = calls.find((c) => c[0]._id === "DE")![1].$set;
    expect(deSet.treasuryBalance).toBe(-3000); // 5000 + (−4000 × 2)
    expect(deSet["debt.principal"]).toBe(3000); // mirror of the new negative balance
  });

  it("rescopes sovereign bonds value-preservingly: units scale, per-unit face does not", async () => {
    const bondId = new ObjectId();
    db.collection("federalBudget").findOne.mockResolvedValue(null);
    db.collection("bonds").find.mockReturnValue(
      cursorOf([
        {
          _id: bondId,
          issuerType: "sovereign",
          countryId: "DD",
          faceValue: 1000,
          totalIssued: 500_000,
          publicFloat: 100,
          centralBankHoldings: 20,
          holders: [
            { characterId: new ObjectId(), units: 400, avgCostPerUnit: 950 },
            { nppId: new ObjectId(), units: 10 },
          ],
          matured: false,
        },
      ])
    );

    const res = await mergeNationalFisc(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 510,
    });

    expect(res.bondsRescoped).toBe(1);
    const set = db.collectionMocks["bonds"].updateOne.mock.calls[0][1].$set;
    expect(set.countryId).toBe("DE");
    expect(set.totalIssued).toBe(1_000_000); // × 2
    expect(set.publicFloat).toBe(200);
    expect(set.centralBankHoldings).toBe(40);
    expect(set.holders[0].units).toBe(800);
    // avgCostPerUnit is invariant: total cost and unit count scale together.
    expect(set.holders[0].avgCostPerUnit).toBe(950);
    expect(set.holders[1].units).toBe(20);
    expect(set.currencyCode).toBe("EUR");
    // faceValue is the global 1,000-per-unit contract and must NOT be scaled.
    expect(set.faceValue).toBeUndefined();
  });

  it("moves the national law book with money fields converted and fractions untouched", async () => {
    const lawId = new ObjectId();
    db.collection("federalBudget").findOne.mockResolvedValue(null);
    db.collection("enactedLaws").find.mockReturnValue(
      cursorOf([
        {
          _id: lawId,
          countryId: "DD",
          scope: "national",
          annualRevenueV2: 215,
          annualCostPerCapita: 10,
          gdpCostFraction: 0.02,
          budgetCost: 5,
        },
      ])
    );

    const res = await mergeNationalFisc(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 510,
    });

    expect(res.lawsRescoped).toBe(1);
    const [filter, update] = db.collectionMocks["enactedLaws"].updateOne.mock.calls[0];
    expect(filter._id).toBe(lawId);
    expect(update.$set.countryId).toBe("DE");
    expect(update.$set.annualRevenueV2).toBe(430); // × 2
    expect(update.$set.annualCostPerCapita).toBe(20); // × 2
    expect(update.$set.gdpCostFraction).toBeUndefined(); // fraction: scale-free
    expect(update.$set.budgetCost).toBeUndefined(); // legacy percentage: scale-free
  });

  it("queries the WHOLE national book, repealed history included, and never region laws", async () => {
    db.collection("federalBudget").findOne.mockResolvedValue(null);
    await mergeNationalFisc(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 510,
    });
    const findFilter = db.collectionMocks["enactedLaws"].find.mock.calls[0][0];
    expect(findFilter.countryId).toBe("DD");
    expect(findFilter.$or).toEqual([{ stateId: { $exists: false } }, { stateId: null }]);
    expect(findFilter.repealedAt).toBeUndefined();
  });

  it("with forex off everything still moves, at scale 1", async () => {
    vi.mocked(isForexEnabled).mockResolvedValueOnce(false);
    db.collection("federalBudget")
      .findOne.mockResolvedValueOnce({
        _id: "DD",
        treasuryBalance: -1000,
        debt: { principal: 1000 },
      })
      .mockResolvedValueOnce({ _id: "DE", treasuryBalance: 500, debt: { principal: 0 } });

    const res = await mergeNationalFisc(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 510,
    });

    expect(res.fxScale).toBe(1);
    const deSet = db.collectionMocks["federalBudget"].updateOne.mock.calls.find(
      (c) => c[0]._id === "DE"
    )![1].$set;
    expect(deSet.treasuryBalance).toBe(-500);
    expect(deSet["debt.principal"]).toBe(500);
  });

  it("a re-run is a no-op: zeroed treasury, no absorbed bonds or laws left", async () => {
    db.collection("federalBudget")
      .findOne.mockResolvedValueOnce({ _id: "DD", treasuryBalance: 0, debt: { principal: 0 } })
      .mockResolvedValueOnce({ _id: "DE", treasuryBalance: 3000, debt: { principal: 0 } });

    const res = await mergeNationalFisc(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 511,
    });

    expect(res.treasuryMoved).toBe(0);
    expect(res.bondsRescoped).toBe(0);
    expect(res.lawsRescoped).toBe(0);
    expect(db.collection("federalBudget").updateOne).not.toHaveBeenCalled();
  });
});
