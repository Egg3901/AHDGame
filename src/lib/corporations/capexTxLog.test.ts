import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { buildCapexTxEntry, type BuildCapexTxInput } from "./capexTxLog";
import { deriveLedgerEntry, reasonForTxType } from "@/lib/ledger/deriveFromTx";
import { finalizeLedgerEntry } from "@/lib/ledger/emit";
import { reconcileLedger } from "@/lib/ledger/reconcile";
import { TX_TYPE_LABELS } from "@/lib/financialTxLog/types-extended";

const CORP_ID = new ObjectId();
const SECTOR_ID = new ObjectId();

function input(overrides: Partial<BuildCapexTxInput> = {}): BuildCapexTxInput {
  return {
    corporationId: CORP_ID,
    corporationName: "Acme Steel",
    direction: "build",
    amountLocal: 5_000_000,
    currencyCode: "GBP",
    anchorAmount: 2_500_000,
    turn: 1200,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    sectorId: SECTOR_ID,
    sectorType: "manufacturing",
    units: 40,
    ...overrides,
  };
}

describe("buildCapexTxEntry", () => {
  it("books a build as a DEBIT and a cancel refund as a CREDIT", () => {
    const build = buildCapexTxEntry(input());
    expect(build.type).toBe("corp_capacity_build");
    expect(build.amount).toBe(-5_000_000);
    expect(build.anchorAmount).toBe(-2_500_000);

    const refund = buildCapexTxEntry(input({ direction: "refund" }));
    expect(refund.type).toBe("corp_capacity_build_refund");
    expect(refund.amount).toBe(5_000_000);
    expect(refund.anchorAmount).toBe(2_500_000);
  });

  it("rejects a signed amount so a build can never be booked as income", () => {
    expect(() => buildCapexTxEntry(input({ amountLocal: -1 }))).toThrow();
    expect(() => buildCapexTxEntry(input({ anchorAmount: -1 }))).toThrow();
    expect(() => buildCapexTxEntry(input({ anchorAmount: NaN }))).toThrow();
  });

  it("stamps the sector context the forensic queries need", () => {
    const entry = buildCapexTxEntry(input());
    expect(entry.subjectType).toBe("corporation");
    expect(entry.subjectId).toBe(CORP_ID);
    expect(entry.meta).toMatchObject({
      sectorId: SECTOR_ID.toString(),
      sectorType: "manufacturing",
      units: 40,
    });
  });
});

describe("shadow ledger accepts the capex kinds", () => {
  it("attributes both directions to the shared capacity_capex reason", () => {
    expect(reasonForTxType("corp_capacity_build")).toBe("capacity_capex");
    expect(reasonForTxType("corp_capacity_build_refund")).toBe("capacity_capex");
  });

  it("derives a BALANCED two-leg entry: corp account vs the capacity_capex bucket", () => {
    const entry = deriveLedgerEntry(buildCapexTxEntry(input()) as never);
    expect(entry).not.toBeNull();
    expect(entry!.legs).toHaveLength(2);
    const [primary, contra] = entry!.legs;
    expect(primary.account).toBe(`corporation:${CORP_ID.toString()}:GBP`);
    expect(primary.anchorAmount).toBe(-2_500_000);
    // Money leaving into a physical asset = a named sink, not `unattributed`.
    expect(contra.account).toBe("sink:capacity_capex:GBP");
    expect(primary.anchorAmount + contra.anchorAmount).toBe(0);
  });

  it("books a refund against the MINT side of the same bucket so the pair nets", () => {
    const entry = deriveLedgerEntry(buildCapexTxEntry(input({ direction: "refund" })) as never);
    expect(entry!.legs[1].account).toBe("mint:capacity_capex:GBP");
  });

  it("passes the reconciler's trial-balance invariant (green, no findings)", () => {
    const entries = [
      finalizeLedgerEntry(deriveLedgerEntry(buildCapexTxEntry(input()) as never)!),
      finalizeLedgerEntry(
        deriveLedgerEntry(buildCapexTxEntry(input({ direction: "refund" })) as never)!
      ),
    ];
    expect(entries.every((e) => e.balanced)).toBe(true);
    const report = reconcileLedger({
      turn: 1200,
      entries,
      openingBalances: {},
      closingBalances: {},
      skipStockVsFlow: true,
    });
    expect(report.trialBalance.status).toBe("green");
    expect(report.trialBalance.unbalancedCount).toBe(0);
    // A build and its own refund net to zero in the money-supply view.
    expect(report.unattributed).toHaveLength(0);
  });
});

describe("admin surfaces know the new tx kinds", () => {
  it("labels both capex types", () => {
    expect(TX_TYPE_LABELS.corp_capacity_build).toBe("Capacity Build");
    expect(TX_TYPE_LABELS.corp_capacity_build_refund).toBe("Capacity Build Refund");
  });
});
