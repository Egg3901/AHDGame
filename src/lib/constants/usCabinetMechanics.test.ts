import { describe, expect, it } from "vitest";
import { US_CABINET_MECHANICS } from "./usCabinetMechanics";
import { US_MINISTERIAL_ORDERS } from "./usCabinetOrders";

describe("US cabinet mechanics", () => {
  it("treats corruption as a lower-is-better metric for relevant offices", () => {
    expect(
      US_CABINET_MECHANICS.attorney_general.nationalMetrics.find(
        (metric) => metric.metricId === "corruptionIndex"
      )?.higherIsBetter
    ).toBe(false);

    expect(
      US_CABINET_MECHANICS.attorney_general.regionalMetrics.find(
        (metric) => metric.metricId === "corruptionIndex"
      )?.higherIsBetter
    ).toBe(false);

    expect(
      US_CABINET_MECHANICS.secretary_of_homeland.nationalMetrics.find(
        (metric) => metric.metricId === "corruptionIndex"
      )?.higherIsBetter
    ).toBe(false);
  });

  it("uses negative modifiers for anti-corruption actions", () => {
    expect(
      US_CABINET_MECHANICS.attorney_general.regionalTarget?.effects["governance.corruptionIndex"]
    ).toBeLessThan(0);

    expect(
      US_MINISTERIAL_ORDERS.attorney_general.find((order) => order.id === "anti_corruption_drive")
        ?.effects[0]?.modifier
    ).toBeLessThan(0);
  });
});
