/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  type ActionAuditRecord,
  formatAmount,
  formatRelative,
  humanizeAction,
  numericDelta,
  refPivots,
  summarizeRecord,
} from "./types";
import { DeltaView } from "./DeltaView";
import { FlagChips } from "./FlagChips";

function makeRecord(over: Partial<ActionAuditRecord> = {}): ActionAuditRecord {
  return {
    _id: "r1",
    ts: new Date().toISOString(),
    turn: 42,
    traceId: "trace-1",
    seq: 0,
    source: "api",
    action: "wire.send",
    category: "money",
    actor: { kind: "player", userId: "u1", name: "Alice" },
    subject: { type: "user", id: "u2", name: "Bob" },
    outcome: "ok",
    ...over,
  };
}

describe("audit helpers", () => {
  it("formats signed money with a currency symbol", () => {
    expect(formatAmount(-1250, "USD")).toBe("-$1,250");
    expect(formatAmount(500, "GBP")).toBe("+£500");
    expect(formatAmount(1000)).toBe("+₳1,000");
  });

  it("humanizes namespaced action verbs", () => {
    expect(humanizeAction("wire.send")).toBe("Wire send");
    expect(humanizeAction("corp.dividends")).toBe("Corp dividends");
  });

  it("computes numeric deltas only when both sides are numbers", () => {
    expect(numericDelta({ field: "balance", before: 100, after: 250 })).toBe(150);
    expect(numericDelta({ field: "name", before: "a", after: "b" })).toBeNull();
  });

  it("derives a domain-aware money summary instead of raw JSON", () => {
    const r = makeRecord({
      amount: -1250,
      currencyCode: "USD",
      counterparty: { type: "user", id: "u2", name: "Bob" },
    });
    const summary = summarizeRecord(r);
    expect(summary).toContain("Alice");
    expect(summary).toContain("-$1,250");
    expect(summary).toContain("Bob"); // counterparty is the money target
    expect(summary).not.toContain("{");
  });

  it("lists only the refs that are present", () => {
    const pivots = refPivots({ financialTxLogId: "tx1", billId: "b1" });
    const keys = pivots.map((p) => p.key);
    expect(keys).toContain("financialTxLogId");
    expect(keys).toContain("billId");
    expect(keys).not.toContain("ledgerEntryId");
  });

  it("produces a compact relative time", () => {
    const ts = new Date(Date.now() - 3 * 60_000).toISOString();
    expect(formatRelative(ts)).toBe("3m ago");
  });
});

describe("DeltaView", () => {
  it("highlights a numeric before/after diff", () => {
    const r = makeRecord({
      category: "governance",
      delta: [{ field: "influence", before: 10, after: 35 }],
    });
    render(<DeltaView record={r} />);
    expect(screen.getByText("influence")).toBeTruthy();
    // The signed diff chip is rendered.
    expect(screen.getByText("+25")).toBeTruthy();
  });

  it("shows the money headline and a pivot to the linked tx", () => {
    const r = makeRecord({ amount: -1250, currencyCode: "USD", refs: { financialTxLogId: "tx9" } });
    render(<DeltaView record={r} onRefPivot={() => {}} />);
    expect(screen.getByText("-$1,250")).toBeTruthy();
    expect(screen.getByText(/View Financial tx/)).toBeTruthy();
  });
});

describe("FlagChips", () => {
  it("renders one chip per flag", () => {
    render(<FlagChips flags={["circular_wire", "wash_trade"]} />);
    expect(screen.getByText("circular wire")).toBeTruthy();
    expect(screen.getByText("wash trade")).toBeTruthy();
  });

  it("renders nothing when there are no flags", () => {
    const { container } = render(<FlagChips flags={[]} />);
    expect(container.textContent).toBe("");
  });
});
