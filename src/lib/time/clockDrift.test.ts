import { describe, expect, it } from "vitest";
import { AUTO_PAUSE_DRIFT_MS, formatDriftHours, isAutoPauseDrift } from "./clockDrift";

describe("clockDrift", () => {
  it("exposes the 4h cron-stall auto-pause threshold in ms", () => {
    expect(AUTO_PAUSE_DRIFT_MS).toBe(4 * 3_600_000);
  });

  it("formatDriftHours rounds to whole hours with unit", () => {
    expect(formatDriftHours(0)).toBe("0 h");
    expect(formatDriftHours(1_799_999)).toBe("0 h"); // <30m → 0h
    expect(formatDriftHours(1_800_000)).toBe("1 h"); // 30m → 1h (round up at half)
    expect(formatDriftHours(3_600_000)).toBe("1 h");
    expect(formatDriftHours(2 * 3_600_000)).toBe("2 h");
    expect(formatDriftHours(14_400_000)).toBe("4 h");
  });

  it("isAutoPauseDrift returns true at >= 4h", () => {
    expect(isAutoPauseDrift(2 * 3_600_000)).toBe(false);
    expect(isAutoPauseDrift(AUTO_PAUSE_DRIFT_MS - 1)).toBe(false);
    expect(isAutoPauseDrift(AUTO_PAUSE_DRIFT_MS)).toBe(true);
  });
});
