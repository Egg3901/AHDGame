import { describe, expect, it } from "vitest";
import { POLITICAL_METRIC_FAMILIES } from "./families";
import { statusFor, leanLabelFor } from "./display";
import {
  getCategoryDisplayName,
  getMetricDisplayName,
  RU_METRIC_NAMES,
  UK_METRIC_NAMES,
  US_METRIC_NAMES,
} from "./names";

describe("political metric flavoring", () => {
  it("every family has a non-empty name in all three countries", () => {
    for (const f of POLITICAL_METRIC_FAMILIES) {
      for (const m of [US_METRIC_NAMES, UK_METRIC_NAMES, RU_METRIC_NAMES]) {
        expect(m[f.id]?.length ?? 0).toBeGreaterThan(3);
      }
    }
  });

  it("flavors known slots per the catalog", () => {
    expect(getMetricDisplayName("US", "economy.workerSecurity")).toBe(
      "Worker Security and Bargaining Power"
    );
    expect(getMetricDisplayName("UK", "economy.workerSecurity")).toBe(
      "Trade Union Strength and Worker Protections"
    );
    expect(getMetricDisplayName("RU", "economy.workerSecurity")).toBe(
      "Guaranteed Employment and Labour Rights"
    );
    expect(getMetricDisplayName("RU", "health.outcomes")).toBe("Population Health Outcomes");
  });

  it("UK gets Labour/Defence category spellings; US/RU get defaults", () => {
    expect(getCategoryDisplayName("UK", "economy")).toBe("Economy & Labour");
    expect(getCategoryDisplayName("US", "economy")).toBe("Economy & Labor");
    expect(getCategoryDisplayName("UK", "defense")).toBe("Defence & Foreign Affairs");
    expect(getCategoryDisplayName("RU", "defense")).toBe("Defense & Foreign Affairs");
  });

  it("status bands and lean labels match the spec", () => {
    expect(statusFor(92)).toBe("Exceptional");
    expect(statusFor(70)).toBe("Strong");
    expect(statusFor(55)).toBe("Stable");
    expect(statusFor(40)).toBe("Strained");
    expect(statusFor(25)).toBe("Weak");
    expect(statusFor(10)).toBe("Critical");
    expect(leanLabelFor(-5)).toBe("Strong Left");
    expect(leanLabelFor(0)).toBe("Mixed");
    expect(leanLabelFor(1)).toBe("Center-Right");
  });
});
