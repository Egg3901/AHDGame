import { describe, expect, it } from "vitest";

import { getCabinetPositions } from "./cabinetMechanics";
import { getCabinetMetrics } from "./cabinetMetrics";
import { getMinisterialOrders } from "./cabinetOrders";

describe("JP cabinet support", () => {
  it("registers the authentic justice portfolio in the JP cabinet roster", () => {
    const positions = getCabinetPositions("JP");

    expect(positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "justice_minister",
          name: "Minister of Justice",
          order: 4,
        }),
      ])
    );
  });

  it("exposes JP ministerial orders through the shared orders barrel", () => {
    const orders = getMinisterialOrders("JP", "justice_minister");

    expect(orders).toHaveLength(2);
    expect(orders.map((order) => order.id)).toEqual([
      "anti_corruption_raids",
      "court_backlog_clearance",
    ]);
  });

  it("derives cabinet office metrics from mechanics for parliamentary cabinets", () => {
    const jpMetrics = getCabinetMetrics("JP", "internal_affairs_minister");
    const ukMetrics = getCabinetMetrics("UK", "chancellor");

    expect(jpMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricId: "broadbandAccess",
          format: "percent",
        }),
        expect.objectContaining({
          metricId: "ruralRevitalization",
          format: "index",
        }),
      ])
    );
    expect(ukMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricId: "gdpGrowth",
          format: "percent",
        }),
      ])
    );
  });
});
