import { describe, expect, it } from "vitest";
import {
  CORPORATE_NO_HOLDER_BOND_SHARE_TARGET,
  evaluateCorporateNoHolderAlert,
  summarizeCorporateNoHolderAlert,
  type CorporateNoHolderAlertInput,
} from "@/lib/economy/corporateNoHolderAlert/rules";

function withMedian(
  value: number | null,
  observations: number,
  basis = "unmatured_corporate_issue_count_median_12"
): CorporateNoHolderAlertInput {
  return {
    turn: 100,
    securitiesRecent12: { corporateNoHolderBondShareMedian: { value, observations, basis } },
  };
}

describe("evaluateCorporateNoHolderAlert", () => {
  it("clears when the rolling median sits below the 35% target", () => {
    const alert = evaluateCorporateNoHolderAlert(withMedian(0.3, 12));
    expect(alert.status).toBe("within-target");
    expect(alert.warn).toBe(false);
    expect(alert.threshold).toBe(CORPORATE_NO_HOLDER_BOND_SHARE_TARGET);
    expect(alert.median).toBe(0.3);
    expect(alert.observations).toBe(12);
  });

  it("warns when the rolling median sits above the target", () => {
    const alert = evaluateCorporateNoHolderAlert(withMedian(0.672, 11));
    expect(alert.status).toBe("above-target");
    expect(alert.warn).toBe(true);
    expect(alert.median).toBe(0.672);
  });

  it("warns at exactly the threshold because the target is strictly below 35%", () => {
    const alert = evaluateCorporateNoHolderAlert(withMedian(0.35, 12));
    expect(alert.status).toBe("above-target");
    expect(alert.warn).toBe(true);
  });

  it("fails closed on thin history even when the point value spikes", () => {
    for (const observations of [1, 2]) {
      const alert = evaluateCorporateNoHolderAlert(withMedian(0.9, observations));
      expect(alert.status).toBe("insufficient-data");
      expect(alert.warn).toBe(false);
      expect(alert.median).toBeNull();
      expect(alert.reasons).toContain("corporate_no_holder_median_insufficient_history");
    }
  });

  it("trusts the first median that escapes single-spike range", () => {
    const alert = evaluateCorporateNoHolderAlert(withMedian(0.9, 3));
    expect(alert.status).toBe("above-target");
    expect(alert.warn).toBe(true);
  });

  it("fails closed on a null median with zero observations", () => {
    const alert = evaluateCorporateNoHolderAlert(withMedian(null, 0));
    expect(alert.status).toBe("insufficient-data");
    expect(alert.warn).toBe(false);
    expect(alert.median).toBeNull();
    expect(alert.reasons).toContain("corporate_no_holder_median_null");
  });

  it("fails closed on a non-finite median", () => {
    const alert = evaluateCorporateNoHolderAlert(withMedian(Number.NaN, 5));
    expect(alert.status).toBe("insufficient-data");
    expect(alert.warn).toBe(false);
  });

  it("fails closed on older snapshots that predate the corporate leg", () => {
    const alert = evaluateCorporateNoHolderAlert({ turn: 40, securitiesRecent12: {} });
    expect(alert.status).toBe("insufficient-data");
    expect(alert.warn).toBe(false);
    expect(alert.reasons).toContain("corporate_no_holder_median_unavailable");
  });

  it("fails closed when the snapshot itself is missing", () => {
    for (const missing of [null, undefined]) {
      const alert = evaluateCorporateNoHolderAlert(missing);
      expect(alert.status).toBe("insufficient-data");
      expect(alert.warn).toBe(false);
      expect(alert.reasons).toContain("snapshot_unavailable");
    }
  });
});

describe("summarizeCorporateNoHolderAlert", () => {
  it("names the threshold and consumer reading for admin and sim reporting", () => {
    expect(
      summarizeCorporateNoHolderAlert(evaluateCorporateNoHolderAlert(withMedian(0.672, 11)))
    ).toBe("corporate no-holder median 67.2% (11 obs) at or above 35% target");
    expect(
      summarizeCorporateNoHolderAlert(evaluateCorporateNoHolderAlert(withMedian(0.3, 12)))
    ).toBe("corporate no-holder median 30.0% (12 obs) below 35% target");
    expect(
      summarizeCorporateNoHolderAlert(evaluateCorporateNoHolderAlert(withMedian(null, 0)))
    ).toBe(
      "corporate no-holder median unavailable " +
        "(corporate_no_holder_median_null, 0 obs) against 35% target"
    );
  });
});
