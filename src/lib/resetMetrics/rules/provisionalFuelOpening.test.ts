import { describe, expect, it } from "vitest";
import { provisionalFuelOpening } from "./provisionalFuelOpening";

describe("provisional 1991 fuel exposure", () => {
  it("exposes a labeled opening risk without claiming physical-ledger verification", () => {
    expect(
      provisionalFuelOpening({
        importExposurePercent: 40,
        emergencyBufferDays: 85,
        sourceDiversity: 62,
      })
    ).toMatchObject({
      metricId: "58",
      status: "proxy",
      source: "provisional 1991 game fuel-exposure fixture",
    });
  });

  it("responds in the expected direction and rejects invalid input", () => {
    const safe = provisionalFuelOpening({
      importExposurePercent: 20,
      emergencyBufferDays: 90,
      sourceDiversity: 80,
    });
    const exposed = provisionalFuelOpening({
      importExposurePercent: 80,
      emergencyBufferDays: 10,
      sourceDiversity: 20,
    });
    expect(exposed.value).toBeGreaterThan(safe.value!);
    expect(
      provisionalFuelOpening({
        importExposurePercent: 101,
        emergencyBufferDays: 90,
        sourceDiversity: 80,
      })
    ).toMatchObject({ status: "unavailable", value: null });
  });
});
