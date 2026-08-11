import { describe, expect, it } from "vitest";
import { legislationTypes } from "./legislationTypes";

/**
 * §4.7 sweep guard. The pure-stock readouts populationGrowth / medianAge /
 * demographicDecline are RECOMPUTED each turn from the cohort flows (§4.3), so a
 * direct legislation `metricEffect` on them double-counts the engine-computed
 * change via the coexistence contract. A law must target its upstream DRIVER
 * (birthRate / migrationRate / laborParticipation / lifeExpectancy), never the
 * derived readout. urbanizationRate is EXEMPT (policy-drivable hybrid, §4.7).
 */
const READOUT_TRIO = new Set(["populationGrowth", "medianAge", "demographicDecline"]);

describe("§4.7 demographic readout sweep", () => {
  it("no legislation effect targets a pure-stock readout (populationGrowth/medianAge/demographicDecline)", () => {
    const offenders: string[] = [];
    for (const lt of legislationTypes) {
      for (const w of lt.effectTargetsWeighted ?? []) {
        if (w.metricCategoryId === "population" && READOUT_TRIO.has(w.metricId)) {
          offenders.push(`${lt._id} → weighted ${w.metricId} (${w.weight})`);
        }
      }
      if (
        lt.effectTarget?.metricCategoryId === "population" &&
        READOUT_TRIO.has(lt.effectTarget.metricId)
      ) {
        offenders.push(`${lt._id} → effectTarget ${lt.effectTarget.metricId}`);
      }
    }
    expect(offenders, `readout double-counts still present:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("urbanizationRate law targets remain (exempt — NOT swept)", () => {
    const urban = legislationTypes.filter((lt) =>
      (lt.effectTargetsWeighted ?? []).some((w) => w.metricId === "urbanizationRate")
    );
    expect(urban.length).toBeGreaterThanOrEqual(2); // us_housing + at least one more survive
  });
});
