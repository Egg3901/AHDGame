import { describe, it, expect } from "vitest";
import {
  STOCK_FLOW_WINDOW_TURNS,
  validateStockFlowWindow,
  type StockFlowEvidenceInput,
  type StockFlowProvenance,
  type StockFlowTurnEvidence,
} from "@/lib/ledger/stockFlowEvidence";

const REVISION = "5b34bd6f32eaa000950b1fa47d44ca14351d12ce";
const OTHER_REVISION = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function provenance(overrides: Partial<StockFlowProvenance> = {}): StockFlowProvenance {
  return {
    runId: "run-992-evidence",
    dbName: "ahd_sim_992",
    codeRevision: REVISION,
    codeRevisionSource: "simExperimentReport",
    gitDirty: false,
    sourceWorktree: "muse-992",
    sourceRequestedCommit: REVISION,
    sourceExecutedPath: "/root/projects/AHDGame/worktrees/muse-992",
    sourceExecutedCommit: REVISION,
    ...overrides,
  };
}

function turn(
  turnNumber: number,
  overrides: Partial<StockFlowTurnEvidence> = {}
): StockFlowTurnEvidence {
  return {
    turn: turnNumber,
    bankingMode: "authoritative",
    trialBalanceStatus: "green",
    trialBalanceUnbalancedCount: 0,
    stockVsFlowSkipped: false,
    stockVsFlowDivergentCount: 0,
    moneySupplyStatus: "green",
    unattributedCount: 0,
    overallStatus: "green",
    ...overrides,
  };
}

function cleanTwelve(start = 101): StockFlowTurnEvidence[] {
  return Array.from({ length: STOCK_FLOW_WINDOW_TURNS }, (_, i) => turn(start + i));
}

function input(
  turns: StockFlowTurnEvidence[],
  prov: Partial<StockFlowProvenance> = {},
  expected = REVISION
): StockFlowEvidenceInput {
  return { provenance: provenance(prov), expectedCodeRevision: expected, turns };
}

describe("validateStockFlowWindow", () => {
  it("accepts 12 consecutive genuine post-activation clean turns", () => {
    const result = validateStockFlowWindow(input(cleanTwelve(101)));
    expect(result.ok).toBe(true);
    expect(result.qualifyingWindow).toEqual({ startTurn: 101, endTurn: 112 });
    expect(result.failures).toEqual([]);
  });

  it("rejects a skipped stock-vs-flow check (null count reads as failure, not zero)", () => {
    const turns = cleanTwelve(101);
    turns[5] = turn(106, {
      stockVsFlowSkipped: true,
      stockVsFlowDivergentCount: null,
      overallStatus: "amber",
    });
    const result = validateStockFlowWindow(input(turns));
    expect(result.ok).toBe(false);
    expect(result.qualifyingWindow).toBeNull();
    expect(result.failures.some((f) => f.turn === 106 && f.reason.includes("skipped"))).toBe(true);
  });

  it("rejects any divergent account", () => {
    const turns = cleanTwelve(101);
    turns[11] = turn(112, { stockVsFlowDivergentCount: 3, overallStatus: "amber" });
    const result = validateStockFlowWindow(input(turns));
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.turn === 112 && f.reason.includes("3 divergent"))).toBe(
      true
    );
  });

  it("rejects trial-balance breaks", () => {
    const turns = cleanTwelve(101);
    turns[0] = turn(101, {
      trialBalanceStatus: "red",
      trialBalanceUnbalancedCount: 2,
      overallStatus: "red",
    });
    const result = validateStockFlowWindow(input(turns));
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.turn === 101 && f.reason.includes("trial balance"))).toBe(
      true
    );
  });

  it("rejects money-supply amber and non-empty unattributed buckets", () => {
    const turns = cleanTwelve(101);
    turns[3] = turn(104, {
      moneySupplyStatus: "amber",
      unattributedCount: 4,
      overallStatus: "amber",
    });
    const result = validateStockFlowWindow(input(turns));
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.turn === 104 && f.reason.includes("money supply"))).toBe(
      true
    );
    expect(result.failures.some((f) => f.turn === 104 && f.reason.includes("unattributed"))).toBe(
      true
    );
  });

  it("rejects a turn stamped with a non-authoritative banking mode", () => {
    for (const bankingMode of ["shadow", "off"]) {
      const turns = cleanTwelve(101);
      turns[7] = turn(108, { bankingMode, overallStatus: "amber" });
      const result = validateStockFlowWindow(input(turns));
      expect(result.ok).toBe(false);
      expect(result.qualifyingWindow).toBeNull();
      expect(
        result.failures.some((f) => f.turn === 108 && f.reason.includes("not authoritative"))
      ).toBe(true);
    }
  });

  it("rejects legacy turn docs that predate the banking-mode stamp (null is unknown, not passing)", () => {
    const turns = cleanTwelve(101);
    turns[0] = turn(101, { bankingMode: null });
    const result = validateStockFlowWindow(input(turns));
    expect(result.ok).toBe(false);
    expect(result.qualifyingWindow).toBeNull();
    expect(
      result.failures.some((f) => f.turn === 101 && f.reason.includes("not authoritative"))
    ).toBe(true);
  });

  it("accepts clean turns at any turn number: each stamped turn proves itself post-activation", () => {
    const result = validateStockFlowWindow(input(cleanTwelve(7)));
    expect(result.ok).toBe(true);
    expect(result.qualifyingWindow).toEqual({ startTurn: 7, endTurn: 18 });
  });

  it("rejects a gap in turn consecutiveness", () => {
    const turns = [...cleanTwelve(101).slice(0, 6), ...cleanTwelve(108).slice(0, 6)];
    const result = validateStockFlowWindow(input(turns));
    expect(result.ok).toBe(false);
    expect(result.qualifyingWindow).toBeNull();
  });

  it("rejects fewer than 12 turns", () => {
    const result = validateStockFlowWindow(input(cleanTwelve(101).slice(0, 11)));
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.reason.includes("only 11 turns"))).toBe(true);
  });

  it("rejects executing-code mismatch against the expected branch revision", () => {
    const prov = provenance({
      codeRevision: OTHER_REVISION,
      sourceRequestedCommit: OTHER_REVISION,
      sourceExecutedCommit: OTHER_REVISION,
    });
    const result = validateStockFlowWindow({
      provenance: prov,
      expectedCodeRevision: REVISION,
      turns: cleanTwelve(101),
    });
    expect(result.ok).toBe(false);
    expect(
      result.failures.some(
        (f) => f.reason.includes("does not match") && f.reason.includes("expected branch revision")
      )
    ).toBe(true);
  });

  it("rejects a pinned source that moved between request and execution", () => {
    const result = validateStockFlowWindow(
      input(cleanTwelve(101), { sourceRequestedCommit: OTHER_REVISION })
    );
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.reason.includes("pinned source moved"))).toBe(true);
  });

  it("rejects a code revision substituted over a different executed commit", () => {
    const result = validateStockFlowWindow(
      input(cleanTwelve(101), { codeRevision: OTHER_REVISION })
    );
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.reason.includes("mixed report refused"))).toBe(true);
  });

  it("rejects machine-recorded provenance without a full-SHA executed commit", () => {
    for (const sourceExecutedCommit of [null, "b55eda0b4", ""]) {
      const result = validateStockFlowWindow(
        input(cleanTwelve(101), { codeRevision: "b55eda0b4", sourceExecutedCommit })
      );
      expect(result.ok).toBe(false);
      expect(
        result.failures.some((f) => f.reason.includes("without a pinned full-SHA executed commit"))
      ).toBe(true);
    }
  });

  it("rejects pinned provenance without a proven source path", () => {
    for (const overrides of [
      { sourceWorktree: null },
      { sourceExecutedPath: null },
      { sourceWorktree: "", sourceExecutedPath: "" },
    ]) {
      const result = validateStockFlowWindow(input(cleanTwelve(101), overrides));
      expect(result.ok).toBe(false);
      expect(result.failures.some((f) => f.reason.includes("source path unproven"))).toBe(true);
    }
  });

  it("rejects operator-asserted provenance (genuine means machine-recorded)", () => {
    const result = validateStockFlowWindow(
      input(cleanTwelve(101), { codeRevisionSource: "operator" })
    );
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.reason.includes("not machine-recorded"))).toBe(true);
  });

  it("rejects dirty or unknown executing checkouts", () => {
    for (const gitDirty of [true, null]) {
      const result = validateStockFlowWindow(input(cleanTwelve(101), { gitDirty }));
      expect(result.ok).toBe(false);
      expect(result.failures.some((f) => f.reason.includes("dirty"))).toBe(true);
    }
  });

  it("reports the earliest qualifying subwindow in longer input", () => {
    const bad = turn(101, { stockVsFlowDivergentCount: 9, overallStatus: "amber" });
    const result = validateStockFlowWindow(input([bad, ...cleanTwelve(102)]));
    expect(result.ok).toBe(true);
    expect(result.qualifyingWindow).toEqual({ startTurn: 102, endTurn: 113 });
  });

  it("sorts unsorted input deterministically", () => {
    const turns = cleanTwelve(101).reverse();
    const result = validateStockFlowWindow(input(turns));
    expect(result.ok).toBe(true);
    expect(result.qualifyingWindow).toEqual({ startTurn: 101, endTurn: 112 });
  });
});
