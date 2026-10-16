import { describe, expect, it } from "vitest";
import { sectorReceipt } from "./__fixtures__/sectorReceipt";
import { producerSectorView } from "./sectorViewRules";

describe("producer receipt views", () => {
  it("keeps full sell-through separate from low production and the real operating loss", () => {
    const view = producerSectorView({
      receipt: sectorReceipt(),
      commodities: ["financial_services"],
      policies: {},
      canManage: true,
    });
    expect(view.products[0]).toMatchObject({
      offeredUnits: 2,
      soldUnits: 2,
      sellThrough: 1,
      realizedUnitPrice: 3,
    });
    expect(view.operations).toMatchObject({
      activeUnits: 100,
      producedUnits: 2,
      labourCost: 20,
      revenue: 6,
      breakEvenRevenue: 20,
      profit: -14,
      cashFlow: -14,
    });
  });

  it("does not expose operating costs or pricing intent to another player", () => {
    const view = producerSectorView({
      receipt: sectorReceipt(),
      commodities: ["financial_services"],
      policies: { financial_services: { kind: "costPlus", markup: 0.1 } },
      canManage: false,
    });
    expect(view.operations).toBeUndefined();
    expect(view.products[0].policy).toBeUndefined();
    expect(view.products[0].askingUnitPrice).toBe(3);
  });

  it("preserves the last asking and paid prices when the next asking policy changes", () => {
    const view = producerSectorView({
      receipt: sectorReceipt(),
      commodities: ["financial_services"],
      policies: { financial_services: { kind: "manual", unitPrice: 100 } },
      canManage: true,
    });
    expect(view.products[0]).toMatchObject({
      policy: { kind: "manual", unitPrice: 100 },
      askingUnitPrice: 3,
      realizedUnitPrice: 3,
    });
    const empty = producerSectorView({
      commodities: ["financial_services"],
      policies: {},
      canManage: true,
    });
    expect(empty.products[0].soldUnits).toBeNull();
    expect(empty.operations).toBeUndefined();
  });
});
