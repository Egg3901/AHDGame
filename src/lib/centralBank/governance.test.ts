import { describe, expect, it } from "vitest";
import {
  BOE_INDEPENDENCE_YEAR,
  canLegislateBankIndependence,
  isBankGovernmentControlled,
} from "./governance";

describe("isBankGovernmentControlled", () => {
  it("UK is government-controlled for every pre-1997 era start", () => {
    for (const year of [1953, 1979, 1991]) {
      expect(isBankGovernmentControlled({}, "UK", year)).toBe(true);
    }
  });

  it("UK is independent for era starts at or after 1997", () => {
    expect(isBankGovernmentControlled({}, "UK", BOE_INDEPENDENCE_YEAR)).toBe(false);
    expect(isBankGovernmentControlled({}, "UK", 2019)).toBe(false);
  });

  it("other countries default to independent in every era", () => {
    expect(isBankGovernmentControlled({}, "US", 1953)).toBe(false);
    expect(isBankGovernmentControlled({}, "JP", 1979)).toBe(false);
  });

  it("an explicit legislated flag beats the historical default, both ways", () => {
    expect(isBankGovernmentControlled({ governmentControlled: false }, "UK", 1953)).toBe(false);
    expect(isBankGovernmentControlled({ governmentControlled: true }, "UK", 2019)).toBe(true);
    expect(isBankGovernmentControlled({ governmentControlled: true }, "US", 2019)).toBe(true);
  });

  it("missing starting year falls back to independent", () => {
    expect(isBankGovernmentControlled({}, "UK", undefined)).toBe(false);
  });
});

describe("canLegislateBankIndependence", () => {
  it("national banks can be legislated over", () => {
    expect(canLegislateBankIndependence("UK")).toBe(true);
    expect(canLegislateBankIndependence("US")).toBe(true);
  });

  it("shared-bank members cannot (ECB member, sterlingized SCO/WAL)", () => {
    expect(canLegislateBankIndependence("DE")).toBe(false);
    expect(canLegislateBankIndependence("SCO")).toBe(false);
    expect(canLegislateBankIndependence("WAL")).toBe(false);
  });
});
