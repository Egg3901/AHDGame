import { describe, expect, it } from "vitest";
import {
  evaluateSovereignDemandMatrix,
  evaluateSovereignDemandScenario,
  FUND_CASH_BUFFER_MIN_FRACTION,
  GOODS_FILL_MAX_DECLINE_POINTS,
  SOVEREIGN_DEMAND_SCENARIOS,
  SOVEREIGN_NO_HOLDER_MAX_SHARE,
  stressCommandsFor,
  type SovereignDemandEvidence,
  type SovereignDemandScenario,
} from "./sovereignDemandEvaluation";

function passingEvidence(
  scenarioId: string,
  overrides: Partial<SovereignDemandEvidence> = {}
): SovereignDemandEvidence {
  return {
    scenarioId,
    terminalTurn: 120,
    sovereignNoHolderShareByTurn: Array(12).fill(0.2),
    twoSidedListingShareByTurn: Array(12).fill(0.6),
    depthToMarketCapByTurn: Array(12).fill(0.02),
    funds: [
      {
        fundId: "a",
        status: "active",
        backingRatio: 1.1,
        cashAnchor: 600,
        totalBackingAnchor: 10_000,
      },
      {
        fundId: "b",
        status: "active",
        backingRatio: 1.0,
        cashAnchor: 500,
        totalBackingAnchor: 10_000,
      },
    ],
    countryGoodsFill: [
      { countryId: "US", fill: 0.9 },
      { countryId: "UK", fill: 0.8 },
    ],
    ledger: { trialBalanceUnbalancedCount: 0, unattributedCount: 3 },
    ...overrides,
  };
}

function scenario(id: string): SovereignDemandScenario {
  const found = SOVEREIGN_DEMAND_SCENARIOS.find((row) => row.id === id);
  if (!found) throw new Error(`unknown scenario ${id}`);
  return found;
}

describe("sovereign demand evaluation harness (#1001)", () => {
  it("keeps stable unique scenario identities with exact runWorld gates", () => {
    const ids = SOVEREIGN_DEMAND_SCENARIOS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "baseline-1001",
      "issuance-consolidation-1001",
      "cross-border-eligibility-1001",
      "domestic-fund-coverage-1001",
    ]);
    // Every scenario is queueable and pins all three gates; exactly one
    // scenario enables each candidate gate, the control enables none.
    expect(SOVEREIGN_DEMAND_SCENARIOS.every((row) => row.queueable)).toBe(true);
    for (const row of SOVEREIGN_DEMAND_SCENARIOS) {
      expect(row.runWorldArgs?.some((arg) => arg.startsWith("--index-fund-bond-liquidity="))).toBe(
        true
      );
      expect(
        row.runWorldArgs?.some((arg) => arg.startsWith("--sovereign-issuance-consolidation="))
      ).toBe(true);
      expect(
        row.runWorldArgs?.some((arg) => arg.startsWith("--domestic-sovereign-bond-coverage="))
      ).toBe(true);
    }
    expect(
      SOVEREIGN_DEMAND_SCENARIOS.find((row) => row.id === "baseline-1001")?.runWorldArgs
    ).toEqual([
      "--sovereign-issuance-consolidation=false",
      "--index-fund-bond-liquidity=false",
      "--domestic-sovereign-bond-coverage=false",
    ]);
    expect(
      SOVEREIGN_DEMAND_SCENARIOS.find((row) => row.id === "issuance-consolidation-1001")
        ?.runWorldArgs
    ).toContain("--sovereign-issuance-consolidation=true");
    expect(
      SOVEREIGN_DEMAND_SCENARIOS.find((row) => row.id === "cross-border-eligibility-1001")
        ?.runWorldArgs
    ).toContain("--index-fund-bond-liquidity=true");
    expect(
      SOVEREIGN_DEMAND_SCENARIOS.find((row) => row.id === "domestic-fund-coverage-1001")
        ?.runWorldArgs
    ).toEqual([
      "--sovereign-issuance-consolidation=false",
      "--index-fund-bond-liquidity=false",
      "--domestic-sovereign-bond-coverage=true",
    ]);
  });

  it("aggregates the terminal window as a median, skipping nulls", () => {
    const base = passingEvidence("baseline-1001");
    // Median of [0.5 x11, 0.1] is 0.5 -> fail; nulls never zero-fill.
    const candidate = passingEvidence("issuance-consolidation-1001", {
      sovereignNoHolderShareByTurn: [...Array(11).fill(0.5), 0.1],
    });
    const report = evaluateSovereignDemandScenario(
      scenario("issuance-consolidation-1001"),
      base,
      candidate
    );
    expect(report.status).toBe("fail");
    expect(report.firstFailure?.check).toBe("no-holder-rate");
    expect(report.firstFailure?.evidence["rate"]).toBe(0.5);

    const withNulls = passingEvidence("issuance-consolidation-1001", {
      sovereignNoHolderShareByTurn: [null, null, 0.2, 0.2],
    });
    const ok = evaluateSovereignDemandScenario(
      scenario("issuance-consolidation-1001"),
      base,
      withNulls
    );
    expect(ok.checks[0]?.status).toBe("pass");
    expect(ok.checks[0]?.evidence["observations"]).toBe(2);
  });

  it("enforces the 35% no-holder boundary strictly below", () => {
    const base = passingEvidence("baseline-1001");
    const justBelow = passingEvidence("cross-border-eligibility-1001", {
      sovereignNoHolderShareByTurn: Array(12).fill(SOVEREIGN_NO_HOLDER_MAX_SHARE - 0.0001),
    });
    expect(
      evaluateSovereignDemandScenario(scenario("cross-border-eligibility-1001"), base, justBelow)
        .checks[0]?.status
    ).toBe("pass");
    const atBoundary = passingEvidence("cross-border-eligibility-1001", {
      sovereignNoHolderShareByTurn: Array(12).fill(SOVEREIGN_NO_HOLDER_MAX_SHARE),
    });
    const report = evaluateSovereignDemandScenario(
      scenario("cross-border-eligibility-1001"),
      base,
      atBoundary
    );
    expect(report.checks[0]?.status).toBe("fail");
  });

  it("requires full backing and the 5% cash buffer on every active fund", () => {
    const base = passingEvidence("baseline-1001");
    const underBacked = passingEvidence("issuance-consolidation-1001", {
      funds: [
        {
          fundId: "a",
          status: "active",
          backingRatio: 0.99,
          cashAnchor: 900,
          totalBackingAnchor: 10_000,
        },
      ],
    });
    expect(
      evaluateSovereignDemandScenario(scenario("issuance-consolidation-1001"), base, underBacked)
        .firstFailure
    ).toMatchObject({ check: "fund-backing", status: "fail" });

    const thinCash = passingEvidence("issuance-consolidation-1001", {
      funds: [
        {
          fundId: "a",
          status: "active",
          backingRatio: 1.2,
          cashAnchor: 499,
          totalBackingAnchor: 10_000,
        },
      ],
    });
    const thin = evaluateSovereignDemandScenario(
      scenario("issuance-consolidation-1001"),
      base,
      thinCash
    );
    expect(thin.firstFailure?.check).toBe("fund-backing");
    expect(thin.firstFailure?.evidence["bufferFloor"]).toBe(FUND_CASH_BUFFER_MIN_FRACTION * 10_000);

    // Paused funds are not active: they ride along without judging the gate.
    const pausedOnly = passingEvidence("issuance-consolidation-1001", {
      funds: [
        {
          fundId: "a",
          status: "paused",
          backingRatio: 0.5,
          cashAnchor: 0,
          totalBackingAnchor: 10_000,
        },
      ],
    });
    expect(
      evaluateSovereignDemandScenario(scenario("issuance-consolidation-1001"), base, pausedOnly)
        .checks[1]?.status
    ).toBe("missing");
  });

  it("holds the 5-point goods-fill decline boundary against baseline", () => {
    const base = passingEvidence("baseline-1001");
    // 0.9 -> 0.851 is a 4.9-point decline (inside); 0.9 -> 0.849 is 5.1
    // points (outside). Exact-decimal fills avoid float-boundary flakiness.
    const atEdge = passingEvidence("issuance-consolidation-1001", {
      countryGoodsFill: [
        { countryId: "US", fill: 0.851 },
        { countryId: "UK", fill: 0.8 },
      ],
    });
    expect(
      evaluateSovereignDemandScenario(scenario("issuance-consolidation-1001"), base, atEdge)
        .checks[2]?.status
    ).toBe("pass");
    expect(GOODS_FILL_MAX_DECLINE_POINTS).toBe(0.05);
    const overEdge = passingEvidence("issuance-consolidation-1001", {
      countryGoodsFill: [
        { countryId: "US", fill: 0.849 },
        { countryId: "UK", fill: 0.8 },
      ],
    });
    const report = evaluateSovereignDemandScenario(
      scenario("issuance-consolidation-1001"),
      base,
      overEdge
    );
    expect(report.checks[2]?.status).toBe("fail");
    expect(report.checks[2]?.evidence["countryId"]).toBe("US");
  });

  it("judges trial balance, money attribution, and equity depth as no-regression vs baseline", () => {
    const base = passingEvidence("baseline-1001");
    const regressed = passingEvidence("issuance-consolidation-1001", {
      ledger: { trialBalanceUnbalancedCount: 1, unattributedCount: 3 },
    });
    const trial = evaluateSovereignDemandScenario(
      scenario("issuance-consolidation-1001"),
      base,
      regressed
    );
    expect(trial.checks[3]).toMatchObject({ check: "trial-balance", status: "fail" });

    const unattributed = passingEvidence("issuance-consolidation-1001", {
      ledger: { trialBalanceUnbalancedCount: 0, unattributedCount: 4 },
    });
    expect(
      evaluateSovereignDemandScenario(scenario("issuance-consolidation-1001"), base, unattributed)
        .checks[4]
    ).toMatchObject({ check: "money-attribution", status: "fail" });

    const thinDepth = passingEvidence("issuance-consolidation-1001", {
      twoSidedListingShareByTurn: Array(12).fill(0.6),
      depthToMarketCapByTurn: Array(12).fill(0.019),
    });
    expect(
      evaluateSovereignDemandScenario(scenario("issuance-consolidation-1001"), base, thinDepth)
        .checks[5]
    ).toMatchObject({ check: "equity-depth", status: "fail" });

    const narrowTwoSided = passingEvidence("issuance-consolidation-1001", {
      twoSidedListingShareByTurn: Array(12).fill(0.59),
      depthToMarketCapByTurn: Array(12).fill(0.02),
    });
    expect(
      evaluateSovereignDemandScenario(scenario("issuance-consolidation-1001"), base, narrowTwoSided)
        .checks[5]
    ).toMatchObject({ check: "equity-depth", status: "fail" });
  });

  it("reports missing evidence instead of fabricating a verdict", () => {
    const base = passingEvidence("baseline-1001");
    const noRun = evaluateSovereignDemandScenario(
      scenario("issuance-consolidation-1001"),
      base,
      null
    );
    expect(noRun.status).toBe("missing");
    expect(noRun.firstFailure?.detail).toMatch(/no evidence collected/i);

    // The domestic scenario is queueable now that its gate exists; without a
    // run its evidence is missing like any other unrun scenario.
    const blocked = evaluateSovereignDemandScenario(
      scenario("domestic-fund-coverage-1001"),
      base,
      null
    );
    expect(blocked.status).toBe("missing");
    expect(blocked.firstFailure?.detail).toMatch(/no evidence collected/i);

    const noBaseline = evaluateSovereignDemandScenario(
      scenario("issuance-consolidation-1001"),
      null,
      passingEvidence("issuance-consolidation-1001")
    );
    expect(noBaseline.status).toBe("missing");
    expect(noBaseline.firstFailure?.detail).toMatch(/baseline evidence is missing/i);

    const noWindows = passingEvidence("issuance-consolidation-1001", {
      sovereignNoHolderShareByTurn: [],
    });
    expect(
      evaluateSovereignDemandScenario(scenario("issuance-consolidation-1001"), base, noWindows)
        .checks[0]?.status
    ).toBe("missing");

    const noLedger = passingEvidence("issuance-consolidation-1001", { ledger: null });
    const ledgerReport = evaluateSovereignDemandScenario(
      scenario("issuance-consolidation-1001"),
      base,
      noLedger
    );
    expect(ledgerReport.checks[3]?.status).toBe("missing");
    expect(ledgerReport.checks[4]?.status).toBe("missing");
    expect(ledgerReport.status).toBe("missing");
  });

  it("refuses to judge one scenario's run as another (identity mismatch)", () => {
    const base = passingEvidence("baseline-1001");
    const swapped = passingEvidence("cross-border-eligibility-1001");
    const report = evaluateSovereignDemandScenario(
      scenario("issuance-consolidation-1001"),
      base,
      swapped
    );
    expect(report.status).toBe("missing");
    expect(report.firstFailure?.detail).toMatch(/identity mismatch/);
    expect(report.firstFailure?.evidence["expectedScenarioId"]).toBe("issuance-consolidation-1001");
  });

  it("reports the first failure in issue gate order with evidence", () => {
    const base = passingEvidence("baseline-1001");
    // Fails no-holder AND fund backing AND goods-fill: the head gate wins.
    const multi = passingEvidence("issuance-consolidation-1001", {
      sovereignNoHolderShareByTurn: Array(12).fill(0.6),
      funds: [
        {
          fundId: "a",
          status: "active",
          backingRatio: 0.5,
          cashAnchor: 0,
          totalBackingAnchor: 10_000,
        },
      ],
      countryGoodsFill: [{ countryId: "US", fill: 0.1 }],
    });
    const report = evaluateSovereignDemandScenario(
      scenario("issuance-consolidation-1001"),
      base,
      multi
    );
    expect(report.status).toBe("fail");
    expect(report.firstFailure?.check).toBe("no-holder-rate");
    expect(report.checks.map((check) => check.check)).toEqual([
      "no-holder-rate",
      "fund-backing",
      "goods-fill",
      "trial-balance",
      "money-attribution",
      "equity-depth",
    ]);
  });

  it("evaluates the full matrix with baseline self-comparison and a missing queue", () => {
    const base = passingEvidence("baseline-1001");
    const matrix = evaluateSovereignDemandMatrix(base, {
      "issuance-consolidation-1001": passingEvidence("issuance-consolidation-1001"),
    });
    const byId = new Map(matrix.scenarios.map((row) => [row.scenarioId, row]));
    // Baseline is the control: absolute gates judge it, relational gates pass trivially.
    expect(byId.get("baseline-1001")?.status).toBe("pass");
    expect(byId.get("issuance-consolidation-1001")?.status).toBe("pass");
    expect(byId.get("cross-border-eligibility-1001")?.status).toBe("missing");
    expect(byId.get("domestic-fund-coverage-1001")?.status).toBe("missing");
    expect(matrix.missingEvidence).toEqual([
      "cross-border-eligibility-1001",
      "domestic-fund-coverage-1001",
    ]);
    expect(matrix.queue).toHaveLength(4);
    expect(
      matrix.queue.find((row) => row.scenarioId === "domestic-fund-coverage-1001")
    ).toMatchObject({ queueable: true });
    expect(matrix.generatedBy).toMatch(/#1001/);
  });

  it("emits stress hooks against real sim commands with the scenario db filled in", () => {
    const commands = stressCommandsFor("ahd_sim_1001_consolidation");
    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain("ahd_sim_1001_consolidation");
    expect(commands[0]).toContain("scripts/sim/economicStressTests.ts");
    // The stress hook is fully concrete; the soak hook keeps its run-specific
    // placeholders. Neither may leak the unfilled scenario-db slot.
    expect(commands[0]?.includes("<")).toBe(false);
    expect(commands.every((command) => !command.includes("<scenarioDb>"))).toBe(true);
  });
});
