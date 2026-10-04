import { describe, expect, it } from "vitest";
import {
  buildAnnualFiscalPanel,
  buildCountryTurnRow,
  buildTradeTelemetryRow,
  bondUnitsByHolderClass,
  classifyPolicyAuthority,
  classifyRateDecision,
  debtRatioDenominator,
  expandTradePanel,
  parseResearchQuery,
  securitiesMarketMetrics,
  sovereignFlowsForTurn,
  summarizeBook,
  summarizeExecutions,
  totalReturnSeries,
  tradeObserverMetrics,
  buildSecurityTelemetryRow,
  weightedMean,
  RESEARCH_MAX_TURN_SPAN,
  type CountryTurnInput,
  type CountryTurnRow,
  type SecurityTurnRow,
} from "./rules";

const observedAt = new Date("2026-10-01T00:00:00Z");
const provenance = {
  worldId: "w1",
  sourceClass: "sandbox" as const,
  runId: "run-1",
  seed: "s",
  codeVersion: "abc",
  year: 1991,
  foundingTurn: false,
  observedAt,
};

function countryInput(turn: number, over: Partial<CountryTurnInput["fiscal"]> = {}) {
  return {
    ...provenance,
    turn,
    country: "US",
    currencyCode: "USD",
    macro: {
      inflationRate: 3,
      targetInflation: 2,
      primeRate: 5,
      effectiveRate: 4.8,
      gdpGrowth: 2,
      outputGap: 0.5,
      unemploymentRate: 6,
      wageGrowth: 3,
      tradeGrowth: 1,
      gdp: 1000,
    },
    monetary: { hasBank: true, chairIsPlayer: false, hasCommittee: true, exchangeRate: 1 },
    fiscal: {
      hasBudget: true,
      fiscalYear: 1,
      revenue: { total: 100, incomeTax: 60, payrollTax: 40 },
      spending: { byCategory: { defense: 50 }, stateGrants: 10, debtInterest: 5, total: 95 },
      surplus: 5,
      treasuryBalance: 20,
      debtPrincipal: 500,
      debtInterestRate: 4,
      debtToGdpRatio: 0.5,
      gdpSmoothed: 1000,
      creditRating: "AA",
      issuedFace: 0,
      retiredFace: 0,
      defaultedFace: 0,
      scheduledCoupon: 1,
      ...over,
    },
    conflictIds: [],
  } satisfies CountryTurnInput;
}

describe("policy classification", () => {
  it("resolves who set the rate", () => {
    expect(
      classifyPolicyAuthority({
        governmentControlled: true,
        hasCommittee: true,
        chairIsPlayer: true,
      })
    ).toBe("government");
    expect(
      classifyPolicyAuthority({
        governmentControlled: false,
        hasCommittee: true,
        chairIsPlayer: false,
      })
    ).toBe("committee");
    expect(
      classifyPolicyAuthority({
        governmentControlled: false,
        hasCommittee: false,
        chairIsPlayer: true,
      })
    ).toBe("chair");
    expect(
      classifyPolicyAuthority({
        governmentControlled: false,
        hasCommittee: false,
        chairIsPlayer: false,
      })
    ).toBe("autonomous-chair");
  });

  it("classifies a rate decision and leaves a no-change turn as a hold", () => {
    expect(classifyRateDecision({ previousRate: 4, newRate: 4.25 })).toEqual({
      decision: "hike",
      delta: 0.25,
    });
    expect(classifyRateDecision({ previousRate: 4, newRate: 3.5 }).decision).toBe("cut");
    expect(classifyRateDecision(null)).toEqual({ decision: "hold", delta: 0 });
  });
});

describe("buildCountryTurnRow", () => {
  it("stamps provenance and derives the primary balance and denominator", () => {
    const row = buildCountryTurnRow(countryInput(10));
    expect(row).toMatchObject({
      worldId: "w1",
      runId: "run-1",
      seed: "s",
      codeVersion: "abc",
      turn: 10,
      retentionPolicy: expect.any(String),
    });
    expect(row.fiscal.primaryBalance).toBe(10);
    expect(row.fiscal.debtToGdpDenominator).toBe("gdpSmoothed");
    expect(row.monetary.authority).toBe("committee");
    expect(row.missing).toEqual([]);
  });

  it("keeps absent values null and names them instead of writing zero", () => {
    const input = countryInput(10);
    const row = buildCountryTurnRow({
      ...input,
      macro: { ...input.macro, inflationRate: undefined, unemploymentRate: Number.NaN },
    });
    expect(row.macro.inflationRate).toBeNull();
    expect(row.macro.unemploymentRate).toBeNull();
    expect(row.missing).toEqual(
      expect.arrayContaining(["macro.inflationRate", "macro.unemploymentRate"])
    );
  });

  it("marks monetary authority missing when the country has no bank", () => {
    const row = buildCountryTurnRow({
      ...countryInput(10),
      monetary: { hasBank: false },
    });
    expect(row.monetary.authority).toBeNull();
    expect(row.missing).toEqual(
      expect.arrayContaining(["monetary.authority", "monetary.decision"])
    );
  });

  it("falls back to raw GDP only when the smoothed GDP is not positive", () => {
    expect(debtRatioDenominator(900, 0)).toEqual({ source: "gdp", value: 900 });
    expect(debtRatioDenominator(null, null)).toBeNull();
  });

  it("records the executed rate change and its actor", () => {
    const row = buildCountryTurnRow({
      ...countryInput(10),
      monetary: {
        hasBank: true,
        hasCommittee: false,
        chairIsPlayer: false,
        changeThisTurn: { previousRate: 5, newRate: 5.25, bySystem: true },
      },
    });
    expect(row.monetary).toMatchObject({
      authority: "autonomous-chair",
      decision: "hike",
      rateChange: 0.25,
      rateChangeActor: "system",
    });
  });
});

describe("weightedMean", () => {
  it("ignores unusable rows and returns null with no weight", () => {
    expect(
      weightedMean([
        { value: 2, weight: 1 },
        { value: 4, weight: 3 },
        { value: undefined, weight: 5 },
        { value: 9, weight: 0 },
      ])
    ).toBe(3.5);
    expect(weightedMean([])).toBeNull();
  });
});

describe("sovereignFlowsForTurn", () => {
  const bonds = [
    { countryId: "US", totalIssued: 1000, couponRate: 4.8, issuedAtTurn: 5 },
    { countryId: "US", totalIssued: 200, couponRate: 4, matured: true, redeemedAtTurn: 5 },
    { countryId: "US", totalIssued: 300, couponRate: 6, defaulted: true, defaultedAtTurn: 5 },
    { countryId: "UK", totalIssued: 999, couponRate: 4, issuedAtTurn: 5 },
  ];
  it("matches flows on the stamped turn and ignores other countries", () => {
    expect(sovereignFlowsForTurn(bonds, "US", 5, 48)).toEqual({
      issuedFace: 1000,
      retiredFace: 200,
      defaultedFace: 300,
      scheduledCoupon: 1,
    });
    expect(sovereignFlowsForTurn(bonds, "US", 6, 48).issuedFace).toBe(0);
  });
});

describe("buildAnnualFiscalPanel", () => {
  function rowsFor(turns: number[], year = 1) {
    return turns.map((t) => {
      const row = buildCountryTurnRow(
        countryInput(t, {
          fiscalYear: year,
          debtPrincipal: 500 + (t - turns[0] + 1) * 10,
          issuedFace: 10,
        })
      );
      return row;
    });
  }

  it("reconciles opening debt plus named flows to closing debt", () => {
    const [annual] = buildAnnualFiscalPanel(rowsFor([1, 2, 3, 4]));
    expect(annual.openingDebt).toBe(500);
    expect(annual.openingDebtSource).toBe("derived-from-first-turn-flows");
    expect(annual.closingDebt).toBe(540);
    expect(annual.issued).toBe(40);
    expect(annual.reconciliationResidual).toBe(0);
    expect(annual.debtToGdpReproduced).toBeCloseTo(0.54, 6);
    expect(annual.retainedTurns).toBe(4);
  });

  it("reports a nonzero residual instead of hiding an unexplained move", () => {
    const rows = rowsFor([1, 2]);
    rows[1] = buildCountryTurnRow(
      countryInput(2, { fiscalYear: 1, debtPrincipal: 700, issuedFace: 10 })
    );
    const [annual] = buildAnnualFiscalPanel(rows);
    expect(annual.reconciliationResidual).toBe(180);
  });

  it("lists missing turns and chains the next year from the prior close", () => {
    const rows = [...rowsFor([1, 2, 4]), ...rowsFor([5, 6], 2)];
    const [y1, y2] = buildAnnualFiscalPanel(rows);
    expect(y1.missingTurns).toEqual([3]);
    expect(y2.openingDebtSource).toBe("prior-turn-close");
    expect(y2.openingDebt).toBe(y1.closingDebt);
    expect(y2.nominalGdpGrowth).toBe(0);
  });

  it("aligns paired worlds on turn without private data", () => {
    const a = buildAnnualFiscalPanel(rowsFor([1, 2]));
    expect(Object.keys(a[0])).not.toContain("characterId");
  });
});

describe("trade panel", () => {
  const row = buildTradeTelemetryRow({
    ...provenance,
    turn: 7,
    commodity: "oil",
    summary: {
      demandUnitsIntent: 100,
      intraStateUnits: 40,
      interStateUnits: 20,
      importUnits: 10,
      unmetUnits: 30,
      toleranceBoundUnits: 12,
      capacityBoundUnits: 18,
    },
    pairs: [
      {
        exporter: "US",
        importer: "UK",
        deliveredUnits: 10,
        dispatchedUnits: 12,
        askValue: 120,
        freightPaid: 5,
        tariffPaid: 3,
        landedValue: 130,
        tariffRateUnits: 50,
        legs: 2,
      },
    ],
    destinations: [
      {
        country: "UK",
        demandUnits: 60,
        supplyUnits: 10,
        foreignOfferUnits: 40,
        localUnits: 20,
        interStateUnits: 10,
        importUnits: 10,
        unmetUnits: 20,
        toleranceBoundUnits: 12,
        capacityBoundUnits: 8,
      },
      {
        country: "US",
        demandUnits: 40,
        supplyUnits: 90,
        foreignOfferUnits: 0,
        localUnits: 20,
        interStateUnits: 10,
        importUnits: 0,
        unmetUnits: 10,
        toleranceBoundUnits: 0,
        capacityBoundUnits: 10,
      },
    ],
  });

  it("expands to explicit zero-flow pairs with no imputed price", () => {
    const panel = expandTradePanel(row);
    const usUk = panel.find((p) => p.exporter === "US" && p.importer === "UK");
    const ukUs = panel.find((p) => p.exporter === "UK" && p.importer === "US");
    expect(usUk).toMatchObject({ traded: true, deliveredUnits: 10 });
    expect(usUk?.unitAsk).toBe(10);
    expect(usUk?.unitLanded).toBe(13);
    expect(usUk?.tariffRatePct).toBe(5);
    expect(ukUs).toMatchObject({
      traded: false,
      deliveredUnits: 0,
      unitAsk: null,
      unitLanded: null,
    });
    expect(panel.some((p) => p.exporter === p.importer)).toBe(false);
  });

  it("reproduces the observer decomposition from destination rows", () => {
    const m = tradeObserverMetrics([row]);
    expect(m.intentFulfillmentRate).toBeCloseTo(70 / 100, 6);
    expect(m.nonlocalShare).toBeCloseTo(30 / 70, 6);
    expect(m.toleranceBoundShareOfUnmet).toBeCloseTo(12 / 30, 6);
    expect(m.capacityBoundShareOfUnmet).toBeCloseTo(18 / 30, 6);
  });
});

describe("securities panel", () => {
  it("summarizes a book with the observer spread definition", () => {
    const book = summarizeBook([
      { type: "buy", pricePerShare: 99, sharesRemaining: 10 },
      { type: "sell", pricePerShare: 101, sharesRemaining: 5, liquidityProvider: true },
    ]);
    expect(book.twoSided).toBe(true);
    expect(book.spreadPct).toBeCloseTo(2, 6);
    expect(book.facilityQuoted).toBe(true);
    expect(book.organicTwoSided).toBe(false);
    expect(summarizeBook([]).twoSided).toBe(false);
  });

  it("keeps no-trade as null price rather than zero", () => {
    expect(summarizeExecutions([]).vwapAnchor).toBeNull();
    const ex = summarizeExecutions([
      { shares: 10, totalAnchor: 100 },
      { shares: 10, totalAnchor: 120 },
    ]);
    expect(ex.vwapAnchor).toBe(11);
    expect(ex.count).toBe(2);
  });

  function equity(id: string, trades: number, twoSided: boolean): SecurityTurnRow {
    return {
      securityId: id,
      assetClass: "equity",
      issuerType: "corporation",
      issuerCountry: "US",
      currencyCode: "USD",
      fxRate: 1,
      fxStatus: "converted",
      price: 10,
      priceBasis: trades > 0 ? "executed" : "model",
      modelPrice: 10,
      lastExecutedPriceAnchor: trades > 0 ? 10 : null,
      executions: {
        count: trades,
        units: trades,
        valueAnchor: trades * 10,
        vwapAnchor: trades ? 10 : null,
      },
      book: twoSided
        ? summarizeBook([
            { type: "buy", pricePerShare: 9.9, sharesRemaining: 10 },
            { type: "sell", pricePerShare: 10.1, sharesRemaining: 10 },
          ])
        : summarizeBook([]),
      unitsOutstanding: 100,
      publicFloat: 10,
      distributionPerUnit: null,
      fundamentals: { revenue: null, income: null, liquidCapital: null },
      bond: null,
    };
  }
  function bond(id: string, hasHolders: boolean, defaulted = false): SecurityTurnRow {
    return {
      ...equity(id, 0, false),
      assetClass: "bond",
      book: null,
      bond: {
        couponRate: 4,
        maturityTurn: 100,
        defaulted,
        matured: false,
        unitsByHolderClass: hasHolders ? { fund: 5 } : {},
        hasHolders,
      },
    };
  }

  it("reproduces traded share, two-sided share, spread and bond coverage", () => {
    const rows = [1, 2].map((turn) =>
      buildSecurityTelemetryRow({
        ...provenance,
        turn,
        securities: [
          equity("e1", turn === 1 ? 1 : 0, true),
          equity("e2", 0, false),
          bond("b1", true),
          bond("b2", false),
          bond("b3", false, true),
        ],
        pools: [],
      })
    );
    const m = securitiesMarketMetrics(rows);
    expect(m.equitiesObserved).toBe(2);
    expect(m.tradedShare).toBe(0.5);
    expect(m.zeroTradeShare).toBe(0.5);
    expect(m.twoSidedShare).toBe(0.5);
    expect(m.valueWeightedSpreadPct).toBeCloseTo(2, 4);
    expect(m.bondHolderCoverage).toBe(0.5);
  });

  it("computes total return with distributions and breaks the chain on a gap", () => {
    const series = totalReturnSeries([
      { turn: 1, price: 100, distributionPerUnit: null },
      { turn: 2, price: 99, distributionPerUnit: 2 },
      { turn: 4, price: 120, distributionPerUnit: 0 },
    ]);
    expect(series[0].totalReturn).toBeNull();
    expect(series[1].totalReturn).toBeCloseTo(0.01, 6);
    expect(series[2].totalReturn).toBeNull();
  });

  it("aggregates bond holders to classes without identities", () => {
    expect(
      bondUnitsByHolderClass(
        [
          { units: 3, fundId: "f" },
          { units: 2, characterId: "c" },
          { units: 1, corporationId: "k" },
        ],
        4,
        1
      )
    ).toEqual({ fund: 3, player: 2, corporation: 1, market_pool: 4, central_bank: 1 });
  });
});

describe("parseResearchQuery", () => {
  it("defaults to a bounded window ending at the latest turn", () => {
    const parsed = parseResearchQuery({ panel: "country-turn" }, 1000);
    expect(parsed.ok && parsed.query).toMatchObject({
      toTurn: 1000,
      fromTurn: 1000 - RESEARCH_MAX_TURN_SPAN + 1,
      limit: 500,
    });
  });

  it("rejects an unbounded or malformed request", () => {
    expect(parseResearchQuery({ panel: "nope" }, 10).ok).toBe(false);
    expect(parseResearchQuery({ panel: "trade", fromTurn: "0", toTurn: "5000" }, 5000).ok).toBe(
      false
    );
    expect(parseResearchQuery({ panel: "trade", fromTurn: "9", toTurn: "3" }, 10).ok).toBe(false);
    expect(parseResearchQuery({ panel: "trade", limit: "-1" }, 10).ok).toBe(false);
    expect(parseResearchQuery({ panel: "trade", after: "x" }, 10).ok).toBe(false);
  });

  it("parses lists, caps the limit and reads the cursor", () => {
    const parsed = parseResearchQuery(
      { panel: "trade", countries: "US, UK,US", limit: "99999", after: "12:oil" },
      100
    );
    expect(parsed.ok && parsed.query).toMatchObject({
      countries: ["US", "UK"],
      limit: 2000,
      after: { turn: 12, key: "oil" },
    });
  });
});

describe("row type", () => {
  it("is exported for consumers", () => {
    const row: CountryTurnRow = buildCountryTurnRow(countryInput(1));
    expect(row.schemaVersion).toBeGreaterThan(0);
  });
});
