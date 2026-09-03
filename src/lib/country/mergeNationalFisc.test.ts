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

  it("the winner's fiscal law takes over: tax rates, phase-ins, ceiling, wage floor, union law", async () => {
    // Where BOTH states carry a legislated version of the same lever, the
    // absorbed (winning) side's governs the unified state. Rates and ratios are
    // scale-free; the debt ceiling is money and converts.
    db.collection("federalBudget")
      .findOne.mockResolvedValueOnce({
        _id: "DD",
        treasuryBalance: -1000,
        debt: { principal: 1000, ceiling: 5000, ceilingLastRaisedYear: 1953 },
        taxRates: { incomeTax: 60, corporateTax: 80 },
        taxRatePhaseIn: { incomeTax: 62 },
        minimumWageKaitzRatio: 0.55,
        unionLawBias: 50,
        unionsBanned: false,
      })
      .mockResolvedValueOnce({
        _id: "DE",
        treasuryBalance: 5000,
        debt: { principal: 0, ceiling: 90000, ceilingLastRaisedYear: 1950 },
        taxRates: { incomeTax: 30, corporateTax: 25 },
      });

    await mergeNationalFisc(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 510,
    });

    const deSet = db.collectionMocks["federalBudget"].updateOne.mock.calls.find(
      (c) => c[0]._id === "DE"
    )![1].$set;
    expect(deSet.taxRates).toEqual({ incomeTax: 60, corporateTax: 80 }); // rates: no FX
    expect(deSet.taxRatePhaseIn).toEqual({ incomeTax: 62 }); // DD's pending ramps continue
    // The ceiling SUMS rather than replacing: it is borrowing capacity, not a
    // rule, and a state that just absorbed another has not lost the capacity of
    // the half it took on. 5000 × 2 (money converts) + Germany's own 90000.
    expect(deSet["debt.ceiling"]).toBe(100000);
    // The LATER of the two raises — the combined ceiling is new.
    expect(deSet["debt.ceilingLastRaisedYear"]).toBe(1953);
    expect(deSet.minimumWageKaitzRatio).toBe(0.55);
    expect(deSet.unionLawBias).toBe(50);
    expect(deSet.unionsBanned).toBe(false);
  });

  it("levers the absorbed side never legislated do not clobber the survivor's", async () => {
    db.collection("federalBudget")
      .findOne.mockResolvedValueOnce({
        _id: "DD",
        treasuryBalance: -1000,
        debt: { principal: 1000 },
        taxRates: { incomeTax: 60 },
      })
      .mockResolvedValueOnce({
        _id: "DE",
        treasuryBalance: 5000,
        debt: { principal: 0, ceiling: 90000 },
        taxRates: { incomeTax: 30 },
        minimumWageKaitzRatio: 0.4,
        unionLawBias: -20,
      });

    await mergeNationalFisc(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 510,
    });

    const deSet = db.collectionMocks["federalBudget"].updateOne.mock.calls.find(
      (c) => c[0]._id === "DE"
    )![1].$set;
    expect(deSet.taxRates).toEqual({ incomeTax: 60 });
    expect(deSet.minimumWageKaitzRatio).toBeUndefined(); // DD never set one
    expect(deSet.unionLawBias).toBeUndefined();
    expect(deSet["debt.ceiling"]).toBeUndefined(); // DD had no ceiling of its own
  });

  it("does not re-count a survivor's ceiling that was already merged away", async () => {
    // `mergedInto` on the SURVIVOR says its figures are remnants of a state that
    // has already been absorbed, so its ceiling is already inside the other
    // side's. Reversing a merge would otherwise hand the unified state its own
    // former ceiling a second time.
    db.collection("federalBudget")
      .findOne.mockResolvedValueOnce({
        _id: "DE",
        treasuryBalance: 0,
        debt: { principal: 0, ceiling: 30_000 },
      })
      .mockResolvedValueOnce({
        _id: "DD",
        treasuryBalance: 0,
        debt: { principal: 0, ceiling: 10_000 },
        mergedInto: { countryId: "DE", turn: 545 },
      });

    await mergeNationalFisc(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
      currentTurn: 546,
    });

    const ddSet = db.collectionMocks["federalBudget"].updateOne.mock.calls.find(
      (c) => c[0]._id === "DD"
    )![1].$set;
    // 30_000 at this harness's scale, and NOT plus the survivor's stale 10_000 —
    // which is what the unguarded sum produced.
    expect(ddSet["debt.ceiling"]).toBe(15_000);
    expect(ddSet["debt.ceiling"]).not.toBe(25_000);
  });

  it("leaves the winner's legislated levers alone when the SURVIVOR is the victor", async () => {
    // The winner's-law rule assumes the absorbed side won. When the shell is the
    // winner, carrying the absorbed side's levers imposes the LOSER's tax code on
    // the victor. Quantities still cross.
    db.collection("federalBudget")
      .findOne.mockResolvedValueOnce({
        _id: "DE",
        treasuryBalance: 2000,
        debt: { principal: 0, ceiling: 5000 },
        taxRates: { incomeTax: 30 },
        minimumWageKaitzRatio: 0.4,
        unionsBanned: false,
      })
      .mockResolvedValueOnce({
        _id: "DD",
        treasuryBalance: 1000,
        debt: { principal: 0, ceiling: 1000 },
        taxRates: { incomeTax: 60 },
      });

    await mergeNationalFisc(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
      currentTurn: 546,
      carryLegislatedLevers: false,
    });

    const ddSet = db.collectionMocks["federalBudget"].updateOne.mock.calls.find(
      (c) => c[0]._id === "DD"
    )![1].$set;
    // The rules do NOT cross.
    expect(ddSet.taxRates).toBeUndefined();
    expect(ddSet.minimumWageKaitzRatio).toBeUndefined();
    expect(ddSet.unionsBanned).toBeUndefined();
    // The quantities do, at this harness's scale: treasury 1000 + 2000×0.5,
    // ceiling 1000 + 5000×0.5.
    expect(ddSet.treasuryBalance).toBe(2000);
    expect(ddSet["debt.ceiling"]).toBe(3500);
  });

  it("sums the debt ceilings rather than letting the absorbed side's replace one three times its size", async () => {
    // The live German case, in round numbers: replacing would have cut a state
    // with 3x the GDP down to the smaller ceiling it absorbed.
    db.collection("federalBudget")
      .findOne.mockResolvedValueOnce({
        _id: "DD",
        treasuryBalance: 0,
        debt: { principal: 0, ceiling: 10_000, ceilingLastRaisedYear: 1953 },
      })
      .mockResolvedValueOnce({
        _id: "DE",
        treasuryBalance: 0,
        debt: { principal: 0, ceiling: 18_000, ceilingLastRaisedYear: 1955 },
      });

    await mergeNationalFisc(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 510,
    });

    const deSet = db.collectionMocks["federalBudget"].updateOne.mock.calls.find(
      (c) => c[0]._id === "DE"
    )![1].$set;
    // 18_000 + 10_000 × 2 — strictly more than either side alone, and never less
    // than the survivor already had.
    expect(deSet["debt.ceiling"]).toBe(38_000);
    expect(deSet["debt.ceiling"]).toBeGreaterThan(18_000);
    // The survivor's raise is the later one here, so it is the one recorded.
    expect(deSet["debt.ceilingLastRaisedYear"]).toBe(1955);
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
    const ops = db.collectionMocks["bonds"].bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(1);
    expect(String(ops[0].updateOne.filter._id)).toBe(String(bondId));
    const set = ops[0].updateOne.update.$set;
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
    const ops = db.collectionMocks["enactedLaws"].bulkWrite.mock.calls[0][0];
    expect(String(ops[0].updateOne.filter._id)).toBe(String(lawId));
    const set = ops[0].updateOne.update.$set;
    expect(set.countryId).toBe("DE");
    expect(set.annualRevenueV2).toBe(430); // × 2
    expect(set.annualCostPerCapita).toBe(20); // × 2
    expect(set.gdpCostFraction).toBeUndefined(); // fraction: scale-free
    expect(set.budgetCost).toBeUndefined(); // legacy percentage: scale-free
  });

  it("at scale 1 the whole national book moves in one updateMany", async () => {
    vi.mocked(isForexEnabled).mockResolvedValueOnce(false);
    const lawId = new ObjectId();
    db.collection("federalBudget").findOne.mockResolvedValue(null);
    db.collection("enactedLaws").find.mockReturnValue(
      cursorOf([{ _id: lawId, countryId: "DD", scope: "national", annualRevenueV2: 215 }])
    );

    await mergeNationalFisc(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 510,
    });

    const [filter, update] = db.collectionMocks["enactedLaws"].updateMany.mock.calls[0];
    expect(filter._id.$in.map(String)).toEqual([String(lawId)]);
    expect(update.$set).toEqual({ countryId: "DE" });
    expect(db.collectionMocks["enactedLaws"].bulkWrite).not.toHaveBeenCalled();
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

  it("a re-run is a no-op: the mergedInto stamp gates the whole fiscal block", async () => {
    db.collection("federalBudget")
      .findOne.mockResolvedValueOnce({
        _id: "DD",
        treasuryBalance: 0,
        debt: { principal: 0 },
        taxRates: { incomeTax: 60 },
        mergedInto: { countryId: "DE", turn: 510 },
      })
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

  it("re-bases the shell's own v2 fraction laws onto the merged base at their absolute cost", async () => {
    // The live German case: the GDR's 5.93%-of-GDP army priced at 5.93% × 70bn
    // pre-merge. Absorbing a country four times its size must not silently
    // quadruple the programme — the unified treasury inherits both states'
    // obligations at their authored sizes.
    db.collection("federalBudget")
      .findOne.mockResolvedValueOnce({
        _id: "DE",
        treasuryBalance: 0,
        debt: { principal: 0 },
      })
      .mockResolvedValueOnce({
        _id: "DD",
        treasuryBalance: 0,
        debt: { principal: 0 },
      });
    const shellLawId = new ObjectId();
    // No carried laws; the shell's own v2 law is what re-bases.
    db.collection("enactedLaws").find.mockImplementation((f: Record<string, unknown>) =>
      cursorOf(
        f.countryId === "DE"
          ? []
          : [
              {
                _id: shellLawId,
                countryId: "DD",
                scope: "national",
                legislationTypeId: "dd.defense.armedForces.primary",
                costModelV2: { gdpCostFraction: 0.0593 },
              },
            ]
      )
    );
    // countryFiscalBase(DD) post-merge: both economies. state.gdp is in
    // millions (× 1e6), so 50_000m + 30_000m = 80e9 merged against the 50e9
    // pre-merge shell base.
    db.collection("states").find.mockImplementation(() =>
      cursorOf([
        { gdp: 50_000, population: 2_000 },
        { gdp: 30_000, population: 3_000 },
      ])
    );
    db.collection("gameState").findOne.mockResolvedValue({ incomeBandIndexByCountry: {} });

    await mergeNationalFisc(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
      currentTurn: 546,
      carryLegislatedLevers: false,
      mergeBases: {
        fromGdp: 10_000_000_000,
        fromPopulation: 1_000,
        fromIncomeBand: 1,
        toGdp: 50_000_000_000,
        toPopulation: 5_000,
        toIncomeBand: 1,
      },
    });

    const ops = db.collectionMocks["enactedLaws"].bulkWrite.mock.calls[0][0];
    const set = ops.find(
      (op: { updateOne: { filter: { _id: unknown } } }) =>
        String(op.updateOne.filter._id) === String(shellLawId)
    ).updateOne.update.$set;
    // 0.0593 × 50_000 / 80_000 = 0.0370625 — same absolute cost on the merged base.
    expect(set["costModelV2.gdpCostFraction"]).toBeCloseTo(0.0593 * (50_000 / 80_000), 10);
    expect(set.mergeRebased).toEqual({ from: "DE", to: "DD", turn: 546 });
  });

  it("re-bases the carried book by the absorbed country's own base, not the shell's", async () => {
    db.collection("federalBudget")
      .findOne.mockResolvedValueOnce({
        _id: "DE",
        treasuryBalance: 0,
        debt: { principal: 0 },
      })
      .mockResolvedValueOnce({
        _id: "DD",
        treasuryBalance: 0,
        debt: { principal: 0 },
      });
    const carriedLawId = new ObjectId();
    db.collection("enactedLaws").find.mockImplementation((f: Record<string, unknown>) =>
      cursorOf(
        f.countryId === "DE"
          ? [
              {
                _id: carriedLawId,
                countryId: "DE",
                scope: "national",
                gdpPerCapitaMultiplier: 0.28,
              },
            ]
          : []
      )
    );
    db.collection("states").find.mockImplementation(() =>
      cursorOf([{ gdp: 40_000, population: 4_000 }])
    );

    await mergeNationalFisc(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
      currentTurn: 546,
      mergeBases: {
        fromGdp: 21_000_000_000,
        fromPopulation: 2_100,
        fromIncomeBand: 1,
        toGdp: 7_000_000_000,
        toPopulation: 700,
        toIncomeBand: 1,
      },
    });

    // The carried law rides the rescope bulkWrite: re-keyed AND re-based in the
    // same write, so a crash between them cannot strand either half.
    const ops = db.collectionMocks["enactedLaws"].bulkWrite.mock.calls[0][0];
    const set = ops[0].updateOne.update.$set;
    expect(set.countryId).toBe("DD");
    // 0.28 × 21_000 / 40_000 — the West German programme at its authored size.
    expect(set.gdpPerCapitaMultiplier).toBeCloseTo(0.28 * (21_000 / 40_000), 10);
  });

  it("the v2 income term re-bases by the population-and-band ratio, not the gdp ratio", async () => {
    db.collection("federalBudget")
      .findOne.mockResolvedValueOnce({
        _id: "DE",
        treasuryBalance: 0,
        debt: { principal: 0 },
      })
      .mockResolvedValueOnce({
        _id: "DD",
        treasuryBalance: 0,
        debt: { principal: 0 },
      });
    const carriedIncomeLawId = new ObjectId();
    db.collection("enactedLaws").find.mockImplementation((f: Record<string, unknown>) =>
      cursorOf(
        f.countryId === "DE"
          ? [
              {
                _id: carriedIncomeLawId,
                countryId: "DE",
                scope: "national",
                costModelV2: { incomeCostFraction: 0.01 },
              },
            ]
          : []
      )
    );
    db.collection("states").find.mockImplementation(() =>
      cursorOf([{ gdp: 40_000, population: 8_000 }])
    );
    // The survivor's live band differs from the band the carried side priced at.
    db.collection("gameState").findOne.mockResolvedValue({
      incomeBandIndexByCountry: { DD: 1.25 },
    });

    await mergeNationalFisc(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
      currentTurn: 546,
      mergeBases: {
        fromGdp: 20_000_000_000,
        fromPopulation: 2_000,
        fromIncomeBand: 1,
        toGdp: 5_000_000_000,
        toPopulation: 500,
        toIncomeBand: 1,
      },
    });

    const ops = db.collectionMocks["enactedLaws"].bulkWrite.mock.calls[0][0];
    const set = ops[0].updateOne.update.$set;
    // income term = frac × anchor × band × population. The anchor does not
    // move; the population (2000 → 8000) and the band (1 → 1.25) both do.
    expect(set["costModelV2.incomeCostFraction"]).toBeCloseTo(
      0.01 * ((2_000 * 1) / (8_000 * 1.25)),
      10
    );
  });
});
