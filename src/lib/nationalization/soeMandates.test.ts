import { describe, expect, it } from "vitest";
import { MANDATE_MAP, getMandateContributions, resolveSectorMandate } from "./soeMandates";
import type { Corporation, CorporateSector } from "@/lib/db/types";

const sector = (over: Partial<CorporateSector> = {}): CorporateSector =>
  ({ sectorType: "healthcare", soeMandate: undefined, ...over }) as CorporateSector;
const corp = (over: Partial<Corporation> = {}): Corporation =>
  ({ countryId: "US", soeMandate: undefined, ...over }) as Corporation;

describe("MANDATE_MAP", () => {
  it("maps healthcare to physicianRate", () => {
    const c = MANDATE_MAP.healthcare;
    expect(c?.some((e) => e.metricPath === "healthcare.physicianRate")).toBe(true);
  });

  it("maps financial to two metrics (smallBusinessFormation primary + incomeInequality secondary)", () => {
    const c = MANDATE_MAP.financial ?? [];
    const paths = c.map((e) => e.metricPath);
    expect(paths).toContain("economic.smallBusinessFormation");
    expect(paths).toContain("social.incomeInequality");
  });
});

describe("resolveSectorMandate", () => {
  it("prefers the sector posture over the corp default", () => {
    const m = resolveSectorMandate(
      corp({ soeMandate: { priceControlled: false } }),
      sector({ soeMandate: { priceControlled: true } })
    );
    expect(m.priceControlled).toBe(true);
  });

  it("falls back to the corp default when the sector has none", () => {
    const m = resolveSectorMandate(corp({ soeMandate: { employmentGuaranteed: true } }), sector());
    expect(m.employmentGuaranteed).toBe(true);
  });
});

describe("getMandateContributions", () => {
  it("scales with SOE share of the state sector", () => {
    const small = getMandateContributions("US", sector(), {}, 0.1);
    const big = getMandateContributions("US", sector(), {}, 1.0);
    expect(big[0].delta).toBeGreaterThan(small[0].delta);
  });

  it("strengthens contributions when price-controlled", () => {
    const plain = getMandateContributions("US", sector(), { priceControlled: false }, 1.0);
    const controlled = getMandateContributions("US", sector(), { priceControlled: true }, 1.0);
    expect(controlled[0].delta).toBeGreaterThan(plain[0].delta);
  });

  it("adds an unemployment-relief contribution when employment-guaranteed", () => {
    const c = getMandateContributions("US", sector(), { employmentGuaranteed: true }, 1.0);
    expect(c.some((e) => e.metricPath === "economic.unemploymentRate")).toBe(true);
  });

  it("returns an empty list for a sector type with no mandate mapping", () => {
    // entertainment is intentionally unmapped (no clean public-service metric).
    expect(getMandateContributions("US", sector({ sectorType: "entertainment" }), {}, 1.0)).toEqual(
      []
    );
  });

  it("maps the newly-added public-service sectors (manufacturing, retail, real estate)", () => {
    expect(MANDATE_MAP.manufacturing?.[0]?.metricPath).toBe(
      "economic.manufacturingCompetitiveness"
    );
    expect(MANDATE_MAP.chemical_industries?.[0]?.metricPath).toBe(
      "economic.manufacturingCompetitiveness"
    );
    // Cost of living + housing affordability are "lower is better" → direction -1.
    expect(MANDATE_MAP.retail?.[0]).toMatchObject({
      metricPath: "economic.costOfLiving",
      direction: -1,
    });
    expect(MANDATE_MAP.real_estate?.[0]).toMatchObject({
      metricPath: "social.housingAffordability",
      direction: -1,
    });
  });

  it("applies the DE defense override (bundeswehrReadiness) instead of publicTrust", () => {
    const de = getMandateContributions("DE", sector({ sectorType: "defense" }), {}, 1.0);
    const us = getMandateContributions("US", sector({ sectorType: "defense" }), {}, 1.0);
    expect(de.map((e) => e.metricPath)).toContain("governance.bundeswehrReadiness");
    expect(us.map((e) => e.metricPath)).toContain("governance.publicTrust");
  });
});
