/**
 * Coverage tests for the 1991-default seed bundles. Validates that every
 * country lane the preset claims to cover actually returns the 1991 bundle
 * when the preset arg is "1991-default", and that the 2019-default bundle
 * is unaffected.
 */

import { describe, expect, it } from "vitest";
import { states } from "./states";
import { states1991 } from "./states1991";
import {
  getNationalBudgetSeedConfigsForPreset,
  getInitialNationalBudgetsForPreset,
} from "./budgets";
import { selectPresetBundle } from "@/lib/seeds/presetSelector";
import { HOUSE_SEATS_1991, ELECTORAL_VOTES_1991 } from "@/lib/constants/states";
import { getStateSectorWeights } from "./sectorSeedWeights";
import { getPresetSeats } from "@/lib/constants/historicalSeats";
import { stateMetrics1991, applyEra1991Adjustments } from "./stateMetrics1991";
import { stateMetrics } from "./stateMetrics";
import { ukRegions1991 } from "@/lib/seeds/uk/ukRegions1991";
import { jpRegions1991 } from "@/lib/seeds/jp/jpRegions1991";
import { deRegions1991 } from "@/lib/seeds/de/deRegions1991";
import { brRegions1991 } from "@/lib/seeds/br/brRegions1991";
import { cnRegions1991 } from "@/lib/seeds/cn/cnRegions1991";
import { ieRegions1991 } from "@/lib/seeds/ie/ieRegions1991";
import { ieRegions } from "@/lib/seeds/ie/ieRegions";
import { ngRegions1991 } from "@/lib/seeds/ng/ngRegions1991";
import { ngRegions } from "@/lib/seeds/ng/ngRegions";

describe("1991-default seed bundles — coverage", () => {
  it("US states bundle includes all 50 states + DC for 1991", () => {
    expect(states1991.length).toBe(51);
    const ids = new Set(states1991.map((s) => s._id));
    expect(ids.has("DC")).toBe(true);
    expect(ids.has("CA")).toBe(true);
  });

  it("US house districts in states1991 sum to 435 (1990 reapportionment)", () => {
    const sum = states1991
      .filter((s) => s.countryId === "US")
      .reduce((a, s) => a + (s.houseDistricts ?? 0), 0);
    expect(sum).toBe(435);
  });

  it("each US state's houseDistricts matches HOUSE_SEATS_1991", () => {
    for (const s of states1991.filter((s) => s.countryId === "US" && s._id !== "DC")) {
      expect(s.houseDistricts, `${s._id} house districts`).toBe(HOUSE_SEATS_1991[s._id]);
    }
  });

  it("ELECTORAL_VOTES_1991 equals seeded houseDistricts + 2 (DC = 3)", () => {
    for (const s of states1991.filter((s) => s.countryId === "US")) {
      const expected = s._id === "DC" ? 3 : (s.houseDistricts ?? 0) + 2;
      expect(ELECTORAL_VOTES_1991[s._id], `${s._id} EV`).toBe(expected);
    }
  });

  it("US states bundle now includes DC for both presets (Electoral College parity)", () => {
    expect(states.length).toBe(51);
    expect(states.find((s) => s._id === "DC")).toBeDefined();
  });

  it("region-bundle countries each have a 1991 region file with matching counts", () => {
    expect(ukRegions1991.length).toBe(12);
    expect(jpRegions1991.length).toBe(8);
    expect(deRegions1991.length).toBe(16);
    expect(brRegions1991.length).toBe(5);
    expect(cnRegions1991.length).toBe(7);
    expect(ieRegions1991.length).toBe(8);
    expect(ngRegions1991.length).toBe(6);
  });

  it("both presets seed an IE Seanad chamber summing to 60 seats", () => {
    const seats2019 = getPresetSeats("2019-default").filter((s) => s.officeType === "seanad");
    const seats1991 = getPresetSeats("1991-default").filter((s) => s.officeType === "seanad");
    // 60-seat upper house exact match — seed arrays are hand-authored to total 60.
    const total2019 = seats2019.reduce((sum, e) => sum + (e.seatsHeld ?? 0), 0);
    const total1991 = seats1991.reduce((sum, e) => sum + (e.seatsHeld ?? 0), 0);
    expect(total2019).toBe(60);
    expect(total1991).toBe(60);
    // Every IE region (DUB/KIL/MID/WEX/LIM/COR/GAL/DON) carries at least one Seanad seat.
    const regions2019 = new Set(seats2019.map((s) => s.state));
    const regions1991 = new Set(seats1991.map((s) => s.state));
    expect(regions2019).toEqual(new Set(["DUB", "KIL", "MID", "WEX", "LIM", "COR", "GAL", "DON"]));
    expect(regions1991).toEqual(new Set(["DUB", "KIL", "MID", "WEX", "LIM", "COR", "GAL", "DON"]));
  });

  it("both presets' NG House districts sum to 360 and Senate seats sum to 109", () => {
    const sumHouse = (regions: { houseDistricts?: number }[]) =>
      regions.reduce((s, r) => s + (r.houseDistricts ?? 0), 0);
    const sumSenate = (regions: { stateSenateSeats?: number }[]) =>
      regions.reduce((s, r) => s + (r.stateSenateSeats ?? 0), 0);
    expect(sumHouse(ngRegions)).toBe(360);
    expect(sumHouse(ngRegions1991)).toBe(360);
    expect(sumSenate(ngRegions)).toBe(109);
    expect(sumSenate(ngRegions1991)).toBe(109);
  });

  it("both presets' IE Dáil region magnitudes sum to 160 and match the seated Dáil per region", () => {
    const sumDistricts = (regions: { houseDistricts?: number }[]) =>
      regions.reduce((s, r) => s + (r.houseDistricts ?? 0), 0);
    // Must equal COUNTRY_CONFIGS.IE.legislature.lowerChamber.seats (160) so a
    // per-region general election refills exactly the seated Dáil.
    expect(sumDistricts(ieRegions)).toBe(160);
    expect(sumDistricts(ieRegions1991)).toBe(160);

    // Per-region houseDistricts must equal the seated Dáil for that preset.
    // This guards the bug where ieRegions1991 (DUB 47, total 143) diverged from
    // the IE_DAIL_1991 historical seats (DUB 64, total 160), which made
    // /predict and election resolution collapse each constituency to 1 seat.
    for (const [preset, regions] of [
      ["2019-default", ieRegions],
      ["1991-default", ieRegions1991],
    ] as const) {
      const seatedByRegion = new Map<string, number>();
      for (const seat of getPresetSeats(preset).filter((s) => s.officeType === "dail")) {
        seatedByRegion.set(
          seat.state,
          (seatedByRegion.get(seat.state) ?? 0) + (seat.seatsHeld ?? 0)
        );
      }
      for (const region of regions) {
        expect(seatedByRegion.get(region._id as string)).toBe(region.houseDistricts);
      }
    }
  });

  it("2020 Seanad national party totals match the 26th Seanad composition", () => {
    const seats = getPresetSeats("2019-default").filter((s) => s.officeType === "seanad");
    const totalByParty = new Map<string, number>();
    for (const s of seats) {
      totalByParty.set(s.party, (totalByParty.get(s.party) ?? 0) + (s.seatsHeld ?? 0));
    }
    expect(totalByParty.get("ie_ff")).toBe(18);
    expect(totalByParty.get("ie_fg")).toBe(18);
    expect(totalByParty.get("ie_sf")).toBe(5);
    expect(totalByParty.get("ie_green")).toBe(4);
    expect(totalByParty.get("ie_labour")).toBe(3);
    expect(totalByParty.get("ie_ind")).toBe(12);
  });

  it("1991 Seanad national party totals match the 19th Seanad composition", () => {
    const seats = getPresetSeats("1991-default").filter((s) => s.officeType === "seanad");
    const totalByParty = new Map<string, number>();
    for (const s of seats) {
      totalByParty.set(s.party, (totalByParty.get(s.party) ?? 0) + (s.seatsHeld ?? 0));
    }
    expect(totalByParty.get("ie_ff")).toBe(30);
    expect(totalByParty.get("ie_fg")).toBe(16);
    expect(totalByParty.get("ie_labour")).toBe(5);
    expect(totalByParty.get("ie_pd")).toBe(6);
    expect(totalByParty.get("ie_wp")).toBe(1);
    expect(totalByParty.get("ie_independent")).toBe(2);
  });

  it("national budgets configs cover the full 1991 roster (incl. FR/IT/ES/SE/TR NPP tier)", () => {
    const configs = getNationalBudgetSeedConfigsForPreset("1991-default");
    const countries = new Set(configs.map((c) => c.countryId));
    expect(countries).toEqual(
      new Set(["US", "UK", "JP", "DE", "IE", "BR", "CN", "NG", "FR", "IT", "ES", "SE", "TR"])
    );
  });

  it("1991 national budgets use 1991-era fiscal years", () => {
    const configs = getNationalBudgetSeedConfigsForPreset("1991-default");
    for (const c of configs) {
      expect(c.fiscalYear, `${c.countryId} fiscal year`).toBe(1991);
    }
  });

  it("2019 national budgets keep their original fiscal years", () => {
    const configs = getNationalBudgetSeedConfigsForPreset("2019-default");
    const usFy = configs.find((c) => c.countryId === "US")?.fiscalYear;
    expect(usFy).toBe(2020);
  });

  it("getInitialNationalBudgetsForPreset returns 1991 budgets for 1991-default", () => {
    const budgets = getInitialNationalBudgetsForPreset("1991-default");
    const usBudget = budgets.find((b) => b.countryId === "US");
    expect(usBudget?.fiscalYear).toBe(1991);
    expect(usBudget?.gdp).toBeLessThan(10_000_000_000_000); // 1991 GDP < $10T
  });

  it("selectPresetBundle returns the requested bundle and falls back to 2019", () => {
    const b = selectPresetBundle(
      "1991-default",
      {
        "2019-default": "current",
        "1991-default": "old",
      },
      "test"
    );
    expect(b).toBe("old");
    const fallback = selectPresetBundle(
      "unknown",
      {
        "2019-default": "current",
      },
      "test"
    );
    expect(fallback).toBe("current");
  });

  it("1991 sector weights skew manufacturing-heavy vs 2019 tech-heavy", () => {
    const us1991 = getStateSectorWeights("CA", "US", "1991-default");
    const us2019 = getStateSectorWeights("CA", "US", "2019-default");
    // 1991 country bundle: tech weight low (no California override applied,
    // so we use country mean); 2019 has a CA override with technology: 20.
    expect(us1991.technology).toBeLessThan(us2019.technology);
    // 1991 has higher manufacturing share than current US economy.
    expect(us1991.manufacturing).toBeGreaterThan(us2019.manufacturing);
  });

  it("1991 sector weights skew agriculture-heavy in IE vs tech-heavy in 2019", () => {
    const ie1991 = getStateSectorWeights("DUB", "IE", "1991-default");
    const ie2019 = getStateSectorWeights("DUB", "IE", "2019-default");
    // 1991 Ireland: agriculture 9 / technology 4; 2019 Ireland: technology 19.
    expect(ie1991.agriculture).toBeGreaterThan(ie2019.agriculture);
    expect(ie1991.technology).toBeLessThan(ie2019.technology);
  });
});

describe("1991 state metrics era adjustments", () => {
  it("zeros broadbandAccess and socialMediaSentiment", () => {
    const samples = stateMetrics1991.slice(0, 5);
    for (const m of samples) {
      expect(m.infrastructure.broadbandAccess.value).toBe(0);
      expect(m.mediaInformation.socialMediaSentiment.value).toBe(0);
    }
  });

  it("clamps mediaPolarization to era ceiling (≤35)", () => {
    for (const m of stateMetrics1991) {
      expect(m.mediaInformation.mediaPolarization.value).toBeLessThanOrEqual(35);
    }
  });

  it("clamps disinformationRisk to era ceiling (≤20)", () => {
    for (const m of stateMetrics1991) {
      expect(m.mediaInformation.disinformationRisk.value).toBeLessThanOrEqual(20);
    }
  });

  it("lifeExpectancy is ≤78 (1991 US peak)", () => {
    for (const m of stateMetrics1991) {
      expect(m.healthcare.lifeExpectancy.value).toBeLessThanOrEqual(78);
    }
  });

  it("medianIncome scales down vs 2020 baseline", () => {
    const ca2020 = stateMetrics.find((m) => m._id === "CA")?.economic.medianIncome.value ?? 0;
    const ca1991 = stateMetrics1991.find((m) => m._id === "CA")?.economic.medianIncome.value ?? 0;
    expect(ca1991).toBeLessThan(ca2020);
    expect(ca1991).toBeGreaterThan(0);
  });

  it("applyEra1991Adjustments is idempotent on broadband (no drift on double-apply)", () => {
    const sample = stateMetrics.find((m) => m._id === "CA")!;
    const once = applyEra1991Adjustments(sample);
    const twice = applyEra1991Adjustments(once);
    expect(once.infrastructure.broadbandAccess.value).toBe(0);
    expect(twice.infrastructure.broadbandAccess.value).toBe(0);
  });

  it("preserves lastUpdated as a Date (no JSON-clone stringification)", () => {
    // Regression: a JSON deep-clone turned `lastUpdated` into an ISO string,
    // which crashed readers calling `.toISOString()`. The adjuster must keep a
    // real Date so the persisted document stays a BSON Date.
    const sample = stateMetrics.find((m) => m._id === "CA")!;
    const withDate = { ...sample, lastUpdated: new Date("2026-05-29T00:00:00.000Z") };
    const adjusted = applyEra1991Adjustments(withDate);
    expect(adjusted.lastUpdated).toBeInstanceOf(Date);
    expect(() => adjusted.lastUpdated!.toISOString()).not.toThrow();
  });
});

describe("runCoreSeed wires preset into stateMetrics (Gap #1)", () => {
  // SP4 demolition: the US is a playable-pipeline country, so seeded docs
  // carry only the survivor set — infrastructure (incl. the era-floored
  // broadband value these tests previously asserted) is stripped at the
  // write site. Preset wiring is still proven by the era-varying ECONOMIC
  // values that survive.
  it("seedRegionMetrics with 1991-default upserts the era bundle stripped to survivors", async () => {
    const { createMockDb, bulkOps } = await import("@/lib/test-utils/mockDb");
    const { seedRegionMetrics } = await import("@/lib/admin/seed/seedRegionMetrics");
    const db = createMockDb();
    const log: string[] = [];
    await seedRegionMetrics(db as never, false, (m) => log.push(m), "1991-default");
    // seedRegionMetrics batches its macro upserts now; bulkOps flattens the batch
    // back to the [filter, update] pairs this assertion already used.
    const caCall = bulkOps(db.collectionMocks["macroMetrics"]!.bulkWrite).find(
      (call: [Record<string, unknown>, Record<string, unknown>]) =>
        (call[0] as { _id: string })._id === "CA"
    );
    expect(caCall, "CA macroMetrics upsert should exist").toBeDefined();
    const setDoc = (
      caCall![1] as {
        $set: {
          infrastructure?: unknown;
          economic?: { medianIncome?: { value: number } };
        };
      }
    ).$set;
    expect(setDoc.infrastructure).toBeUndefined();
    const income1991 = setDoc.economic?.medianIncome?.value ?? 0;
    expect(income1991).toBeGreaterThan(0);
  });

  it("seedRegionMetrics with 2019-default upserts the modern bundle stripped to survivors", async () => {
    const { createMockDb, bulkOps } = await import("@/lib/test-utils/mockDb");
    const { seedRegionMetrics } = await import("@/lib/admin/seed/seedRegionMetrics");
    const db = createMockDb();
    const log: string[] = [];
    await seedRegionMetrics(db as never, false, (m) => log.push(m), "2019-default");
    // seedRegionMetrics batches its macro upserts now; bulkOps flattens the batch
    // back to the [filter, update] pairs this assertion already used.
    const caCall = bulkOps(db.collectionMocks["macroMetrics"]!.bulkWrite).find(
      (call: [Record<string, unknown>, Record<string, unknown>]) =>
        (call[0] as { _id: string })._id === "CA"
    );
    expect(caCall).toBeDefined();
    const setDoc = (
      caCall![1] as {
        $set: {
          infrastructure?: unknown;
          economic?: { medianIncome?: { value: number } };
        };
      }
    ).$set;
    expect(setDoc.infrastructure).toBeUndefined();
    // 2019 CA median income is the modern (higher) nominal value — preset
    // selection still proven through the surviving economic layer.
    const ca1991 = stateMetrics1991.find((m) => m._id === "CA")?.economic.medianIncome.value ?? 0;
    expect(setDoc.economic?.medianIncome?.value ?? 0).toBeGreaterThan(ca1991);
  });
});

describe("basePolicies — preset-aware (Gap #4)", () => {
  it("getBasePolicies('2019-default') is the canonical basePolicies minus post-2019 windows", async () => {
    // The era policy vacuum (Spec A) drops default policies for domains that open
    // after the preset year — for 2019 that is just cn_common_prosperity (2021).
    const { getBasePolicies, basePolicies } = await import("./basePolicies");
    const { LEGISLATION_ERA } = await import("@/lib/era/legislationCatalog");
    const out = await getBasePolicies("2019-default");
    const expected = basePolicies.filter((p) => {
      const from = LEGISLATION_ERA[p.legislationTypeId];
      return typeof from !== "number" || from <= 2019;
    });
    expect(out.map((p) => p.legislationTypeId).sort()).toEqual(
      expected.map((p) => p.legislationTypeId).sort()
    );
    expect(out.some((p) => p.legislationTypeId === "cn_common_prosperity")).toBe(false);
  });

  it("getBasePolicies('1991-default') aligns US income-tax rate but keeps corporate tax era-specific", async () => {
    const { getBasePolicies } = await import("./basePolicies");
    const policies1991 = await getBasePolicies("1991-default");
    const policies2019 = await getBasePolicies("2019-default");
    const findFed = (policies: typeof policies1991, typeId: string) =>
      policies.find((p) => p.legislationTypeId === typeId && p.scope === "national");

    // Income tax: the flat rate is a revenue-calibration knob, not the statutory
    // rate. US individual income tax was ~7.4% of GDP in 1991 and ~8% in 2019,
    // so both eras sit at index 4 (20%); the era difference is carried by the
    // taxableIncome base ratio, not the rate.
    expect(findFed(policies1991, "us_federal_income_tax_rate")?.policyOptionIndex).toBe(4);
    expect(findFed(policies2019, "us_federal_income_tax_rate")?.policyOptionIndex).toBe(4);

    // Corporate tax IS era-specific: 1991 pre-TCJA 34% (index 8) vs 2019 21% (index 5).
    const corp1991 = findFed(
      policies1991,
      "us_federal_domestic_corporate_tax_rate"
    )?.policyOptionIndex;
    const corp2019 = findFed(
      policies2019,
      "us_federal_domestic_corporate_tax_rate"
    )?.policyOptionIndex;
    expect(corp1991).toBe(8);
    expect(corp2019).toBe(5);
    expect(corp1991).not.toBe(corp2019);
  });

  it("getBasePolicies('1991-default') uses era-correct UK tax indexes", async () => {
    const { getBasePolicies } = await import("./basePolicies");
    const policies1991 = await getBasePolicies("1991-default");
    const ukVat = policies1991.find(
      (p) => p.legislationTypeId === "uk_vat" && p.scope === "national"
    );
    const ukIncome = policies1991.find(
      (p) => p.legislationTypeId === "uk_income_tax_rate" && p.scope === "national"
    );
    expect(ukVat?.policyOptionIndex).toBe(4); // 17.5% in 1991 (vs 20% in 2020)
    expect(ukIncome?.policyOptionIndex).toBe(6); // 25% basic in 1991 (vs 20% in 2020)
  });

  it("getBasePolicies('1991-default') zeroes JP consumption tax to era index", async () => {
    const { getBasePolicies } = await import("./basePolicies");
    const policies1991 = await getBasePolicies("1991-default");
    const jpVat = policies1991.find(
      (p) => p.legislationTypeId === "jp_consumption_tax" && p.scope === "national"
    );
    // JP consumption tax was 3% in 1991 (introduced Apr 1989), raised to 10% by 2020.
    expect(jpVat?.policyOptionIndex).toBe(1);
  });

  it("getBasePolicies('1991-default') generates sub-national records for IE 1991 regions", async () => {
    const { getBasePolicies } = await import("./basePolicies");
    const policies1991 = await getBasePolicies("1991-default");
    // IE region IDs: DUB/KIL/MID/WEX/LIM/COR/GAL/DON. At least DUB should
    // appear in sub-national records once the IE regional types loop over
    // ieRegions1991.
    const dub = policies1991.filter((p) => p.scope === "state" && p.stateId === "DUB");
    expect(dub.length).toBeGreaterThan(0);
  });

  it("seedStatePolicies threads preset into the upserted preset log line", async () => {
    const { createMockDb, bulkOps } = await import("@/lib/test-utils/mockDb");
    const { seedStatePolicies } = await import("@/lib/admin/seed/seedStatePolicies");
    const db = createMockDb();
    const messages: string[] = [];
    await seedStatePolicies(db as never, false, (m) => messages.push(m), "1991-default");
    expect(messages.some((m) => m.includes("preset: 1991-default"))).toBe(true);
  });
});

describe("applyEra1991DemographicAdjustments (Gap #2)", () => {
  it("US: new_immigrants share is lower after 1991 adjustment", async () => {
    const { applyEra1991DemographicAdjustments } = await import("./stateDemographics1991");
    const { stateDemographics } = await import("@/lib/seeds/stateDemographics");
    const ca = stateDemographics.find((s) => s._id === "CA");
    if (!ca) throw new Error("CA demographic fixture missing");
    const adj = applyEra1991DemographicAdjustments(ca, "US");
    const before = ca.groups?.new_immigrants?.population ?? 0;
    const after = adj.groups?.new_immigrants?.population ?? 0;
    if (before > 0) expect(after).toBeLessThan(before);
  });

  it("US: union_trades share is higher after 1991 adjustment", async () => {
    const { applyEra1991DemographicAdjustments } = await import("./stateDemographics1991");
    const { stateDemographics } = await import("@/lib/seeds/stateDemographics");
    const oh = stateDemographics.find((s) => s._id === "OH");
    if (!oh) throw new Error("OH demographic fixture missing");
    const adj = applyEra1991DemographicAdjustments(oh, "US");
    const before = oh.groups?.union_trades?.population ?? 0;
    const after = adj.groups?.union_trades?.population ?? 0;
    if (before > 0) expect(after).toBeGreaterThan(before);
  });

  it("re-normalises so populations sum back to ~100", async () => {
    const { applyEra1991DemographicAdjustments } = await import("./stateDemographics1991");
    const { stateDemographics } = await import("@/lib/seeds/stateDemographics");
    const ca = stateDemographics.find((s) => s._id === "CA");
    if (!ca) throw new Error("CA demographic fixture missing");
    const adj = applyEra1991DemographicAdjustments(ca, "US");
    const total = Object.values(adj.groups ?? {}).reduce((s, g) => s + (g?.population ?? 0), 0);
    // After multiplicative shifts + integer rounding, total should land
    // within ±2 of 100.
    expect(total).toBeGreaterThanOrEqual(98);
    expect(total).toBeLessThanOrEqual(102);
  });

  it("countries without an override return the input demographics unchanged", async () => {
    const { applyEra1991DemographicAdjustments } = await import("./stateDemographics1991");
    // NG is not in the 1991 override map (no NG demographics seeded).
    const fake = {
      _id: "X",
      countryId: "NG" as const,
      categoryWeights: {},
      groups: {},
      lastUpdated: new Date(),
    };
    const adj = applyEra1991DemographicAdjustments(fake, "NG");
    expect(adj).toEqual(fake);
  });

  it("re-normalisation stays bounded after a second application (no runaway drift)", async () => {
    // Strict idempotency isn't possible: multiplicative shifts compound on
    // re-apply (e.g. union_trades ×1.6 → ×1.6 = ×2.56). What we *do*
    // guarantee is that the re-normalisation step pulls the sum back to
    // ~100 on every call, so totals stay bounded.
    const { applyEra1991DemographicAdjustments } = await import("./stateDemographics1991");
    const { stateDemographics } = await import("@/lib/seeds/stateDemographics");
    const ca = stateDemographics.find((s) => s._id === "CA");
    if (!ca) throw new Error("CA demographic fixture missing");
    const once = applyEra1991DemographicAdjustments(ca, "US");
    const twice = applyEra1991DemographicAdjustments(once, "US");
    const totalOnce = Object.values(once.groups ?? {}).reduce(
      (s, g) => s + (g?.population ?? 0),
      0
    );
    const totalTwice = Object.values(twice.groups ?? {}).reduce(
      (s, g) => s + (g?.population ?? 0),
      0
    );
    // Both totals land within ±3 of 100 after re-normalisation rounding.
    expect(totalOnce).toBeGreaterThanOrEqual(97);
    expect(totalOnce).toBeLessThanOrEqual(103);
    expect(totalTwice).toBeGreaterThanOrEqual(97);
    expect(totalTwice).toBeLessThanOrEqual(103);
  });
});

describe("applyEra1991BaselineAdjustments (Gap #3)", () => {
  it("zeros infrastructure.broadbandAccess on a UK region baseline", async () => {
    const { applyEra1991BaselineAdjustments } = await import("./stateBaselines1991");
    const { ukStateBaselines } = await import("@/lib/seeds/uk/ukStateBaselines");
    const lon = ukStateBaselines.find((b) => b._id === "LON");
    if (!lon) throw new Error("LON baseline fixture missing");
    const adj = applyEra1991BaselineAdjustments(lon);
    const broadband = (adj.baselines as Record<string, Record<string, number>> | undefined)?.[
      "infrastructure"
    ]?.["broadbandAccess"];
    expect(broadband).toBe(0);
  });

  it("scales economic.medianIncome down on a UK region baseline (1991 nominal)", async () => {
    const { applyEra1991BaselineAdjustments } = await import("./stateBaselines1991");
    const { ukStateBaselines } = await import("@/lib/seeds/uk/ukStateBaselines");
    const lon = ukStateBaselines.find((b) => b._id === "LON");
    if (!lon) throw new Error("LON baseline fixture missing");
    const before = (lon.baselines as Record<string, Record<string, number>> | undefined)?.[
      "economic"
    ]?.["medianIncome"];
    const adj = applyEra1991BaselineAdjustments(lon);
    const after = (adj.baselines as Record<string, Record<string, number>> | undefined)?.[
      "economic"
    ]?.["medianIncome"];
    if (typeof before === "number" && before > 0) {
      expect(after).toBeLessThan(before);
    }
  });

  it("clamps mediaInformation.mediaPolarization to 35", async () => {
    const { applyEra1991BaselineAdjustments } = await import("./stateBaselines1991");
    const sample = {
      _id: "X",
      baselines: { mediaInformation: { mediaPolarization: 90 } },
    };
    const adj = applyEra1991BaselineAdjustments(sample as never);
    const pol = (adj.baselines as Record<string, Record<string, number>> | undefined)?.[
      "mediaInformation"
    ]?.["mediaPolarization"];
    expect(pol).toBeLessThanOrEqual(35);
  });

  it("returns input unchanged when baselines payload is missing", async () => {
    const { applyEra1991BaselineAdjustments } = await import("./stateBaselines1991");
    const sample = { _id: "Y" } as never;
    const adj = applyEra1991BaselineAdjustments(sample);
    expect(adj).toEqual(sample);
  });

  it("seedUKBaselines threads preset into the upserted preset log line", async () => {
    const { createMockDb, bulkOps } = await import("@/lib/test-utils/mockDb");
    const { seedUKBaselines } = await import("@/lib/admin/seed/seedUK");
    const db = createMockDb();
    const messages: string[] = [];
    await seedUKBaselines(db as never, false, (m) => messages.push(m), "1991-default");
    expect(messages.some((m) => m.includes("preset: 1991-default"))).toBe(true);
  });
});
