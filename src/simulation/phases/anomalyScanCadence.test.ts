import { describe, expect, it } from "vitest";
import {
  ANOMALY_SCAN_EVERY_TURNS,
  ANTI_ABUSE_SCAN_PHASES,
  getAnomalyScanCadencePredicate,
  resolveAnomalyScanCadence,
} from "./anomalyScanCadence";

const scans = [...ANTI_ABUSE_SCAN_PHASES];

describe("anomaly scan cadence", () => {
  it("defaults to a cadence that fits inside the shortest scan window", () => {
    expect(ANOMALY_SCAN_EVERY_TURNS).toBeGreaterThan(1);
    expect(ANOMALY_SCAN_EVERY_TURNS).toBeLessThanOrEqual(6);
    expect(resolveAnomalyScanCadence({})).toBe(ANOMALY_SCAN_EVERY_TURNS);
  });

  it("lets an operator restore every-turn scanning without a deploy", () => {
    expect(resolveAnomalyScanCadence({ AHD_ANOMALY_SCAN_EVERY_TURNS: "1" })).toBe(1);
    expect(getAnomalyScanCadencePredicate(7, 1)).toBeUndefined();
  });

  it("never stretches past the shortest window, whatever the env says", () => {
    expect(resolveAnomalyScanCadence({ AHD_ANOMALY_SCAN_EVERY_TURNS: "50" })).toBe(6);
  });

  it("falls back to the default on garbage", () => {
    expect(resolveAnomalyScanCadence({ AHD_ANOMALY_SCAN_EVERY_TURNS: "soon" })).toBe(
      ANOMALY_SCAN_EVERY_TURNS
    );
    expect(resolveAnomalyScanCadence({ AHD_ANOMALY_SCAN_EVERY_TURNS: "0" })).toBe(
      ANOMALY_SCAN_EVERY_TURNS
    );
    expect(resolveAnomalyScanCadence({ AHD_ANOMALY_SCAN_EVERY_TURNS: "-3" })).toBe(
      ANOMALY_SCAN_EVERY_TURNS
    );
  });

  it("runs the scans on cadence turns and skips them otherwise", () => {
    const onCadence = getAnomalyScanCadencePredicate(9, 3)!;
    const offCadence = getAnomalyScanCadencePredicate(10, 3)!;
    for (const phase of scans) {
      expect(onCadence(phase)).toBe(true);
      expect(offCadence(phase)).toBe(false);
    }
  });

  it("never touches a gameplay phase", () => {
    const offCadence = getAnomalyScanCadencePredicate(10, 3)!;
    for (const phase of ["economy", "elections", "activityLogging", "plantsPnl"]) {
      expect(offCadence(phase)).toBe(true);
    }
  });

  it("covers every turn at the default cadence within a six-turn window", () => {
    // Every turn t must have some scan turn s with t <= s < t + 6.
    for (let t = 1; t <= 30; t++) {
      const scanned = Array.from({ length: 6 }, (_, k) => t + k).some(
        (s) =>
          getAnomalyScanCadencePredicate(s, ANOMALY_SCAN_EVERY_TURNS) === undefined ||
          getAnomalyScanCadencePredicate(s, ANOMALY_SCAN_EVERY_TURNS)!(scans[0])
      );
      expect(scanned).toBe(true);
    }
  });
});
