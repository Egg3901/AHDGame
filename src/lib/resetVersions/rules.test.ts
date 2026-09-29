import { describe, expect, it } from "vitest";
import { resetSystemVersionsFrom, resolveResetSystemVersion } from "./rules";

describe("reset-era system versions", () => {
  const ready = { metrics: true, legislation: true, cabinet: true };
  const staged = { metrics: false, legislation: false, cabinet: false };

  it("keeps missing and unknown values on v1", () => {
    expect(resetSystemVersionsFrom(null, ready)).toEqual({
      metrics: "v1",
      legislation: "v1",
      cabinet: "v1",
    });
    expect(resolveResetSystemVersion("v3", true)).toBe("v1");
  });

  it("resolves each version independently once its v2 path is ready", () => {
    expect(
      resetSystemVersionsFrom(
        {
          metricsSystemVersion: "v2",
          legislationSystemVersion: "v1",
          cabinetSystemVersion: "v2",
        },
        ready
      )
    ).toEqual({ metrics: "v2", legislation: "v1", cabinet: "v2" });
  });

  it("fails closed if a stored v2 value is not released", () => {
    expect(
      resetSystemVersionsFrom(
        {
          metricsSystemVersion: "v2",
          legislationSystemVersion: "v2",
          cabinetSystemVersion: "v2",
        },
        staged
      )
    ).toEqual({ metrics: "v1", legislation: "v1", cabinet: "v1" });
  });
});
