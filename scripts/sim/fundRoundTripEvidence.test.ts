import { describe, expect, it } from "vitest";
import { assertSandboxTarget } from "./collectFundRoundTripEvidence";
import { evaluateFundRoundTrip, type EvidenceInput } from "./fundRoundTripEvidence";

const SHA = "a".repeat(40);
const oid = (value: string) => ({ toString: () => value });

function fixture(): EvidenceInput {
  return {
    requestedCommit: SHA,
    executedCommit: SHA,
    collectorCommit: SHA,
    requestedRedemptionFlag: true,
    initialRedemptionFlag: true,
    finalRedemptionFlag: true,
    indexFundsMode: "full",
    equityLiquidityFacilityEnabled: true,
    indexFundBondLiquidityEnabled: false,
    corporationIds: ["corp"],
    nppIds: ["npp"],
    funds: [
      {
        _id: oid("fund"),
        kind: "broad",
        status: "active",
        quotedNav: 100,
        unitSupply: 100,
        cashAnchor: 2500,
        backingRatio: 1,
        holdings: [{ corporationId: oid("corp"), shares: 75, lastValueAnchor: 7500 }],
      },
    ],
    transactions: [
      {
        fundId: oid("fund"),
        nppId: oid("npp"),
        kind: "subscription",
        units: 10,
        navAnchor: 100,
        amountAnchor: 1000,
      },
      {
        fundId: oid("fund"),
        nppId: oid("npp"),
        kind: "redemption",
        units: 2,
        navAnchor: 100,
        amountAnchor: 200,
      },
    ],
    queue: [
      {
        fundId: oid("fund"),
        nppId: oid("npp"),
        status: "paid",
        units: 0,
        unitsBurnedAtRequest: true,
        paidAmountAnchor: 200,
      },
    ],
    positions: [{ fundId: oid("fund"), holderKind: "npp", nppId: oid("npp"), units: 8 }],
    orders: [
      {
        placerFundId: oid("fund"),
        type: "buy",
        liquidityProvider: true,
        status: "filled",
        shares: 2,
        sharesRemaining: 0,
        pricePerShare: 100,
        escrowAnchor: 0,
      },
    ],
    facility: [{ enabled: true, bidQuotesPlaced: 1, bidDepthAnchor: 200 }],
    bondValueByFund: { fund: 0 },
  };
}

describe("#2120 sandbox evidence", () => {
  it("accepts a source-pinned NPP round trip with NAV payout and backed fund", () => {
    const report = evaluateFundRoundTrip(fixture());
    expect(report.passed).toBe(true);
    expect(report.counts).toMatchObject({ subscriptions: 1, nppRedemptions: 1, filledBids: 1 });
    expect(report.backing[0]).toMatchObject({ ratio: 1, reserveShare: 0.25 });
  });

  it("fails provenance, disabled redemption, and missing NPP activity", () => {
    const input = fixture();
    input.collectorCommit = "b".repeat(40);
    input.initialRedemptionFlag = false;
    input.transactions = [];
    const report = evaluateFundRoundTrip(input);
    expect(report.passed).toBe(false);
    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("source pin"),
        expect.stringContaining("redemption flag"),
        expect.stringContaining("no persisted NPP subscription"),
      ])
    );
  });

  it("detects mismatched NAV, unfinished queue, orphan positions, and weak backing", () => {
    const input = fixture();
    input.transactions[1]!.amountAnchor = 250;
    input.queue[0]!.status = "processing";
    input.positions[0]!.fundId = oid("missing");
    input.funds[0]!.cashAnchor = 100;
    const report = evaluateFundRoundTrip(input);
    expect(report.failures.join(" ")).toMatch(/NAV matched/);
    expect(report.failures.join(" ")).toMatch(/queue did not finish/);
    expect(report.failures.join(" ")).toMatch(/orphan/);
    expect(report.failures.join(" ")).toMatch(/backing/);
  });

  it("rejects a payout backed by a different fund's queue and a missing constituent", () => {
    const input = fixture();
    input.queue[0]!.fundId = oid("another-fund");
    input.corporationIds = [];
    const report = evaluateFundRoundTrip(input);
    expect(report.failures.join(" ")).toMatch(/no paid queue row/);
    expect(report.failures.join(" ")).toMatch(/orphan or invalid corporation holding/);
  });

  it("reports a standing bid separately from a proven fill", () => {
    const input = fixture();
    input.orders[0]!.status = "open";
    input.orders[0]!.sharesRemaining = 2;
    const report = evaluateFundRoundTrip(input);
    expect(report.passed).toBe(false);
    expect(report.failures.join(" ")).toMatch(/no persisted fund bid fill/);
    expect(report.unavailable.join(" ")).toMatch(/sell-flow fill is not proven/);
  });

  it("checks the 5 percent cash buffer only for the enabled bond-liquidity arm", () => {
    const input = fixture();
    input.indexFundBondLiquidityEnabled = true;
    input.funds[0]!.cashAnchor = 400;
    input.funds[0]!.holdings[0]!.lastValueAnchor = 7500;
    input.bondValueByFund.fund = 2100;
    input.funds[0]!.backingRatio = 1;
    expect(evaluateFundRoundTrip(input).failures.join(" ")).toMatch(/cash buffer below/);
  });
});

describe("sandbox target guard", () => {
  it("accepts only an explicit dedicated loopback sandbox", () => {
    expect(() =>
      assertSandboxTarget("mongodb://127.0.0.1:27018/", "ahd_sim_issue2120_a")
    ).not.toThrow();
    expect(() =>
      assertSandboxTarget("mongodb://prod.example:27017/", "ahd_sim_issue2120_a")
    ).toThrow();
    expect(() => assertSandboxTarget("mongodb://127.0.0.1:27018/", "a-house-divided")).toThrow();
  });
});
