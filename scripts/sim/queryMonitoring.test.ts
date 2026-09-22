import { describe, expect, it } from "vitest";
import { worldsimQueryMonitoringRequested } from "./queryMonitoring";

describe("worldsim query monitoring", () => {
  it("leaves ordinary simulations uninstrumented", () => {
    expect(worldsimQueryMonitoringRequested(["--turns=3"], {})).toBe(false);
    expect(worldsimQueryMonitoringRequested([], { AHD_TURN_ROUNDTRIP_MONITOR: "0" })).toBe(false);
  });
  it("honors explicit CLI, command-counter, and byte-profiler requests", () => {
    expect(worldsimQueryMonitoringRequested(["--profile-queries"], {})).toBe(true);
    expect(worldsimQueryMonitoringRequested([], { AHD_TURN_ROUNDTRIP_MONITOR: "1" })).toBe(true);
    expect(worldsimQueryMonitoringRequested([], { AHD_TURN_ROUNDTRIP_PROFILE: "1" })).toBe(true);
  });
});
