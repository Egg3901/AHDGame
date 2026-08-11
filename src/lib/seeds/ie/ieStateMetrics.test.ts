import { describe, expect, it } from "vitest";
import { ieStateMetrics } from "./ieStateMetrics";

const IE_SPECIFIC_FIELDS = {
  economic: ["mncDependency", "gniStarGap", "fdiPipelineStrength", "capDependency"] as const,
  social: [
    "housingCompletionsRate",
    "vacantPropertyRate",
    "rentalPressureIndex",
    "irishLanguageStrength",
  ] as const,
  healthcare: ["slaintecareProgress", "hseWaitingListMonths"] as const,
  governance: ["unityReferendumSupport", "directProvisionLoad"] as const,
  environment: ["agriEmissionsShare"] as const,
};

const RANGES: Record<string, [number, number]> = {
  mncDependency: [0, 100],
  gniStarGap: [-20, 100],
  fdiPipelineStrength: [0, 100],
  capDependency: [0, 100],
  housingCompletionsRate: [0, 20],
  vacantPropertyRate: [0, 100],
  rentalPressureIndex: [0, 100],
  irishLanguageStrength: [0, 100],
  slaintecareProgress: [0, 100],
  hseWaitingListMonths: [0, 60],
  unityReferendumSupport: [0, 100],
  directProvisionLoad: [0, 100],
  agriEmissionsShare: [0, 100],
};

const EXPECTED_REGION_IDS = ["COR", "DON", "DUB", "GAL", "KIL", "LIM", "MID", "WEX"];

describe("ieStateMetrics — IE-specific metric fields", () => {
  it("seeds metrics for all 8 NUTS-III regions", () => {
    expect(ieStateMetrics).toHaveLength(8);
    const ids = ieStateMetrics.map((m) => m._id).sort();
    expect(ids).toEqual(EXPECTED_REGION_IDS);
  });

  for (const [category, fields] of Object.entries(IE_SPECIFIC_FIELDS)) {
    for (const field of fields) {
      it(`every region populates ${category}.${field} with a finite in-range value`, () => {
        const [lo, hi] = RANGES[field];
        for (const region of ieStateMetrics) {
          const block = (
            region as unknown as Record<string, Record<string, { value: number } | undefined>>
          )[category];
          const wrapped = block?.[field];
          expect(wrapped, `${region._id}.${category}.${field} should be defined`).toBeDefined();
          const value = wrapped?.value;
          expect(typeof value).toBe("number");
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(lo);
          expect(value).toBeLessThanOrEqual(hi);
        }
      });
    }
  }
});

describe("ieStateMetrics — regional override matrix", () => {
  function getRegion(id: string) {
    const r = ieStateMetrics.find((m) => m._id === id);
    if (!r) throw new Error(`region ${id} missing`);
    return r;
  }

  it("DUB matches spec §5", () => {
    const r = getRegion("DUB");
    expect(r.economic.mncDependency?.value).toBe(80);
    expect(r.social.housingCompletionsRate?.value).toBe(7.2);
    expect(r.social.vacantPropertyRate?.value).toBe(5);
    expect(r.social.rentalPressureIndex?.value).toBe(85);
    expect(r.social.irishLanguageStrength?.value).toBe(25);
  });

  it("KIL matches spec §5", () => {
    const r = getRegion("KIL");
    expect(r.economic.mncDependency?.value).toBe(72);
    expect(r.social.rentalPressureIndex?.value).toBe(76);
  });

  it("MID matches spec §5", () => {
    const r = getRegion("MID");
    expect(r.economic.mncDependency?.value).toBe(30);
    expect(r.social.vacantPropertyRate?.value).toBe(14);
    expect(r.economic.capDependency?.value).toBe(80);
  });

  it("LIM matches spec §5", () => {
    const r = getRegion("LIM");
    expect(r.economic.mncDependency?.value).toBe(68);
  });

  it("COR matches spec §5", () => {
    const r = getRegion("COR");
    expect(r.economic.mncDependency?.value).toBe(72);
    expect(r.economic.fdiPipelineStrength?.value).toBe(88);
    expect(r.social.irishLanguageStrength?.value).toBe(45);
  });

  it("WEX matches spec §5", () => {
    const r = getRegion("WEX");
    expect(r.economic.mncDependency?.value).toBe(38);
    expect(r.social.vacantPropertyRate?.value).toBe(12);
    expect(r.economic.capDependency?.value).toBe(70);
  });

  it("GAL matches spec §5", () => {
    const r = getRegion("GAL");
    expect(r.economic.mncDependency?.value).toBe(35);
    expect(r.economic.capDependency?.value).toBe(78);
    expect(r.social.irishLanguageStrength?.value).toBe(75);
    expect(r.environment.agriEmissionsShare?.value).toBe(52);
  });

  it("DON matches spec §5", () => {
    const r = getRegion("DON");
    expect(r.economic.mncDependency?.value).toBe(22);
    expect(r.economic.capDependency?.value).toBe(75);
    expect(r.social.irishLanguageStrength?.value).toBe(60);
    expect(r.governance.unityReferendumSupport?.value).toBe(58);
    expect(r.environment.agriEmissionsShare?.value).toBe(48);
  });
});
