import { describe, it, expect } from "vitest";
import { summarizeSupplyConnections, supplyEstimateCsv } from "./supplyPresentation";
import { coordinationFixture } from "./testFixtures";
import { estimateGroupSupply } from "./forecast";
const receipt = {
  supplierId: "s",
  supplierSectorId: "ss",
  buyerId: "b",
  buyerSectorId: "bb",
  commodity: "steel",
  units: 10,
  amountAnchor: 20,
  discount: 0.35,
};
describe("Supply presentation", () => {
  it("groups matching counterparties and commodities without exposing sector IDs", () => {
    const result = summarizeSupplyConnections([
      receipt,
      { ...receipt, buyerSectorId: "other" },
      { ...receipt, commodity: "power" },
    ]);
    expect(result.connectionCount).toBe(2);
    expect(result.connections[0]).toEqual({
      supplierId: "s",
      buyerId: "b",
      commodity: "steel",
      units: 20,
      benchmarkValue: 40,
      rebate: 14,
      estimatedPayment: 26,
    });
    expect(JSON.stringify(result)).not.toContain("SectorId");
  });
  it("bounds summaries to the largest 100 and sorts ties deterministically", () => {
    const receipts = Array.from({ length: 101 }, (_, i) => ({
      ...receipt,
      buyerId: "b" + i,
      amountAnchor: i + 1,
    }));
    const result = summarizeSupplyConnections(receipts);
    expect(result.connectionCount).toBe(101);
    expect(result.connections).toHaveLength(100);
    expect(result.connections[0].buyerId).toBe("b100");
    expect(result.connections.some((r) => r.buyerId === "b0")).toBe(false);
    expect(
      summarizeSupplyConnections([receipt, { ...receipt, buyerId: "a" }]).connections.map(
        (r) => r.buyerId
      )
    ).toEqual(["a", "b"]);
  });
  it("does not return invalid or overflowing financial values", () => {
    expect(summarizeSupplyConnections([{ ...receipt, units: Infinity }]).connections).toEqual([]);
    expect(
      summarizeSupplyConnections([
        { ...receipt, amountAnchor: Number.MAX_VALUE },
        { ...receipt, amountAnchor: Number.MAX_VALUE },
      ]).connections
    ).toEqual([]);
  });
  it("uses the existing participation and discount rules for connection estimates", () => {
    const f = coordinationFixture();
    f.members[0].supplyDiscount = 0.35;
    const basis = {
      turn: 10,
      rootId: "r",
      memberIds: ["s", "b"],
      cashByMember: {},
      complete: true,
      books: [{ ...f, sellers: f.sellers.map((s) => ({ ...s, openFill: 1, quoteFactor: 1 })) }],
    };
    const on = estimateGroupSupply(basis, f.members, 11)!;
    expect(on.connections[0]).toMatchObject({
      units: 100,
      benchmarkValue: 200,
      rebate: 70,
      estimatedPayment: 130,
    });
    expect(on.total.internalTradingValue).toBe(130);
    f.members[1].preference!.enabled = false;
    expect(estimateGroupSupply(basis, f.members, 11)!.connections).toEqual([]);
  });
  it("exports real CSV line breaks and neutralizes formula names, quotes and invalid numbers", () => {
    const csv = supplyEstimateCsv(
      [
        {
          name: ' =HYPERLINK("x")',
          independentRevenue: 100,
          coordinatedRevenue: 110,
          revenueDifference: 10,
          operatingProfitDifference: -5,
          receivingValue: Infinity,
          supplyingValue: 0,
        },
      ],
      [["turn", 12]],
      ["Name", "Independent", "Group", "Difference", "Profit", "Receiving", "Supplying"]
    );
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv).toContain('"\' =HYPERLINK(""x"")"');
    expect(csv).toContain('"-5","","0"');
    expect(csv).not.toContain("Infinity");
  });
});
