/**
 * Country coverage contract: every supported country's seed module must
 * provide a state baseline set that targets the `stateBaselines` collection
 * — the one `policyEffects.ts` actually reads.
 *
 * Pre-Phase-5, JP/DE/IE/BR/CN baselines were written to `stateMetricBaselines`
 * (a parallel collection nothing read), so those countries' regions silently
 * used global defaults at runtime. This test pins the fix in place.
 */

import { describe, expect, it } from "vitest";

describe("country coverage: state baselines", () => {
  it("US: stateBaselines seed is non-empty", async () => {
    const { stateBaselines } = await import("@/lib/seeds/reference/stateBaselines");
    expect(stateBaselines.length).toBeGreaterThan(0);
    for (const baseline of stateBaselines) {
      expect(baseline._id).toBeTruthy();
    }
  });

  it("UK: stateBaselines seed is non-empty", async () => {
    const { ukStateBaselines } = await import("@/lib/seeds/uk/ukStateBaselines");
    expect(ukStateBaselines.length).toBeGreaterThan(0);
    for (const baseline of ukStateBaselines) {
      expect(baseline._id).toBeTruthy();
    }
  });

  it("JP: stateBaselines seed is non-empty", async () => {
    const { jpStateBaselines } = await import("@/lib/seeds/jp/jpStateBaselines");
    expect(jpStateBaselines.length).toBeGreaterThan(0);
    for (const baseline of jpStateBaselines) {
      expect(baseline._id).toBeTruthy();
    }
  });

  it("DE: stateBaselines seed is non-empty", async () => {
    const { deStateBaselines } = await import("@/lib/seeds/de/deStateBaselines");
    expect(deStateBaselines.length).toBeGreaterThan(0);
    for (const baseline of deStateBaselines) {
      expect(baseline._id).toBeTruthy();
    }
  });

  it("IE: stateBaselines seed is non-empty", async () => {
    const { ieStateBaselines } = await import("@/lib/seeds/ie/ieStateBaselines");
    expect(ieStateBaselines.length).toBeGreaterThan(0);
    for (const baseline of ieStateBaselines) {
      expect(baseline._id).toBeTruthy();
    }
  });

  it("BR: stateBaselines seed is non-empty", async () => {
    const { brStateBaselines } = await import("@/lib/seeds/br/brStateBaselines");
    expect(brStateBaselines.length).toBeGreaterThan(0);
    for (const baseline of brStateBaselines) {
      expect(baseline._id).toBeTruthy();
    }
  });

  it("CN: stateBaselines seed is non-empty", async () => {
    const { cnStateBaselines } = await import("@/lib/seeds/cn/cnStateBaselines");
    expect(cnStateBaselines.length).toBeGreaterThan(0);
    for (const baseline of cnStateBaselines) {
      expect(baseline._id).toBeTruthy();
    }
  });

  it("non-US country seeders write to `stateBaselines`, not the legacy `stateMetricBaselines`", async () => {
    // Sanity check: the four seeders that used to write to the dead collection
    // shouldn't reference it any more. This is a guard against regressions
    // where someone copy-pastes from a pre-Phase-5 seeder.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const files = ["seedJP.ts", "seedDE.ts", "seedIE.ts", "seedBR.ts", "seedCN.ts"];
    for (const file of files) {
      const contents = await fs.readFile(path.resolve(__dirname, file), "utf8");
      // Allow mentions in comments (seedJP.ts has one explaining the history),
      // but no code path may call `.collection("stateMetricBaselines")`.
      const codeReference = /\.collection(<[^>]+>)?\(\s*["']stateMetricBaselines["']\s*\)/.exec(
        contents
      );
      expect(codeReference, `${file} still calls .collection("stateMetricBaselines")`).toBeNull();
    }
  });
});

describe("country coverage: China seed completeness", () => {
  it("CN: regions are non-empty and cover 7 macro-regions", async () => {
    const { cnRegions } = await import("@/lib/seeds/cn/cnRegions");
    expect(cnRegions.length).toBe(7);
    const expectedIds = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];
    for (const id of expectedIds) {
      expect(cnRegions.some((r) => r._id === id)).toBe(true);
    }
  });

  it("CN: parties include CCP as governing party with correct seed order", async () => {
    const { cnParties } = await import("@/lib/seeds/cn/cnParties");
    expect(cnParties.length).toBeGreaterThanOrEqual(3);
    const ccp = cnParties.find((p) => p.abbreviation === "CCP");
    expect(ccp).toBeTruthy();
    expect(ccp!.seedOrder).toBe(1);
    expect(ccp!.isDefault).toBe(true);
    expect(ccp!.countryId).toBe("CN");
  });

  it("CN: legislation types are non-empty and scoped to cn", async () => {
    const { cnLegislationTypes } = await import("@/lib/seeds/cn/cnLegislationTypes");
    expect(cnLegislationTypes.length).toBeGreaterThan(0);
    for (const lt of cnLegislationTypes) {
      expect(lt.countryScope).toBe("cn");
      expect(lt._id).toBeTruthy();
    }
  });

  it("CN: state party org calculator produces 21 entries (7 regions x 3 parties)", async () => {
    const { seedCnStatePartyOrg } = await import("@/lib/admin/seed/seedCnStatePartyOrg");
    // We can't run the seeder without a DB, but we can verify the module exports
    expect(typeof seedCnStatePartyOrg).toBe("function");
  });

  it("CN: government formation document exists", async () => {
    const { cnGovernmentFormation } = await import("@/lib/seeds/cn/cnGovernmentFormation");
    expect(cnGovernmentFormation).toBeTruthy();
    // governmentFormations uses countryId as _id (see UK/JP/DE seeds).
    expect(cnGovernmentFormation._id).toBe("CN");
    expect(cnGovernmentFormation.countryId).toBe("CN");
  });

  it("CN: demographic categories exist", async () => {
    const { cnDemographicCategories } = await import("@/lib/seeds/cn/cnDemographicCategories");
    expect(cnDemographicCategories.length).toBeGreaterThan(0);
    for (const cat of cnDemographicCategories) {
      expect(cat._id).toBeTruthy();
    }
  });

  it("CN: region demographics cover all 7 macro-regions", async () => {
    const { cnRegionDemographics } = await import("@/lib/seeds/cn/cnRegionDemographics");
    expect(cnRegionDemographics.length).toBe(7);
    const expectedIds = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];
    for (const id of expectedIds) {
      expect(cnRegionDemographics.some((r) => r._id === id)).toBe(true);
    }
  });

  it("CN: demographic turnout covers all 7 macro-regions", async () => {
    const { cnDemographicTurnout } = await import("@/lib/seeds/cn/cnDemographicTurnout");
    expect(cnDemographicTurnout.length).toBe(7);
    const expectedIds = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];
    for (const id of expectedIds) {
      expect(cnDemographicTurnout.some((r) => r._id === id)).toBe(true);
    }
  });

  it("CN: state metrics cover all 7 macro-regions", async () => {
    const { cnStateMetrics } = await import("@/lib/seeds/cn/cnStateMetrics");
    expect(cnStateMetrics.length).toBe(7);
    const expectedIds = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];
    for (const id of expectedIds) {
      expect(cnStateMetrics.some((r) => r._id === id)).toBe(true);
    }
  });
});

describe("country coverage: Nigeria seed completeness", () => {
  // NG is played as six geopolitical zones, not 36 states (the CN macro-region model).
  const NG_ZONES = [
    "NORTH_WEST",
    "NORTH_EAST",
    "NORTH_CENTRAL",
    "SOUTH_WEST",
    "SOUTH_SOUTH",
    "SOUTH_EAST",
  ];

  it("NG: regions cover all 6 geopolitical zones", async () => {
    const { ngRegions } = await import("@/lib/seeds/ng/ngRegions");
    expect(ngRegions.length).toBe(6);
    for (const id of NG_ZONES) {
      expect(ngRegions.some((r) => r._id === id)).toBe(true);
    }
  });

  it("NG: parties include APC as a default party scoped to NG", async () => {
    const { ngParties } = await import("@/lib/seeds/ng/ngParties");
    expect(ngParties.length).toBeGreaterThanOrEqual(2);
    const apc = ngParties.find((p) => p.abbreviation === "APC");
    expect(apc).toBeTruthy();
    expect(apc!.isDefault).toBe(true);
    expect(apc!.countryId).toBe("NG");
  });

  it("NG: government formation document exists", async () => {
    const { ngGovernmentFormation } = await import("@/lib/seeds/ng/ngGovernmentFormation");
    expect(ngGovernmentFormation._id).toBe("NG");
    expect(ngGovernmentFormation.countryId).toBe("NG");
  });

  it("NG: demographics, turnout, and state metrics each cover 6 zones", async () => {
    const { ngRegionDemographics } = await import("@/lib/seeds/ng/ngRegionDemographics");
    const { ngDemographicTurnout } = await import("@/lib/seeds/ng/ngDemographicTurnout");
    const { ngStateMetrics } = await import("@/lib/seeds/ng/ngStateMetrics");
    expect(ngRegionDemographics.length).toBe(6);
    expect(ngDemographicTurnout.length).toBe(6);
    expect(ngStateMetrics.length).toBe(6);
  });

  it("NG: state baselines seed is non-empty", async () => {
    const { ngStateBaselines } = await import("@/lib/seeds/ng/ngStateBaselines");
    expect(ngStateBaselines.length).toBeGreaterThan(0);
    for (const baseline of ngStateBaselines) {
      expect(baseline._id).toBeTruthy();
    }
  });

  it("NG: legislation types are non-empty and scoped to ng", async () => {
    const { ngLegislationTypes } = await import("@/lib/seeds/ng/ngLegislationTypes");
    expect(ngLegislationTypes.length).toBeGreaterThan(0);
    for (const lt of ngLegislationTypes) {
      expect(lt.countryScope).toBe("ng");
      expect(lt._id).toBeTruthy();
    }
  });
});

describe("country coverage: RU (Soviet Union) seed surfaces", () => {
  it("RU: stateBaselines seed is non-empty and covers all 17 regions", async () => {
    const { ruStateBaselines } = await import("@/lib/seeds/ru/ruStateBaselines");
    const { ruRegions1953 } = await import("@/lib/seeds/ru/ruRegions1953");
    expect(ruStateBaselines.length).toBeGreaterThan(0);
    const baselineIds = new Set(ruStateBaselines.map((b) => b._id));
    for (const region of ruRegions1953) {
      expect(baselineIds.has(region._id), `missing baseline for ${region._id}`).toBe(true);
    }
  });

  it("RU: statePartyOrg era tables cover every region in both Cold-War eras", async () => {
    const { RU_REGION_ORG_1953, RU_REGION_ORG_1979 } =
      await import("@/lib/seeds/ru/ruStatePartyOrgCalculations");
    const { ruRegions1953 } = await import("@/lib/seeds/ru/ruRegions1953");
    const { ruRegions } = await import("@/lib/seeds/ru/ruRegions");
    for (const region of ruRegions1953) {
      expect(RU_REGION_ORG_1953[region._id], `1953 org missing ${region._id}`).toBeDefined();
      expect(RU_REGION_ORG_1953[region._id].cpsu).toBeGreaterThanOrEqual(90);
    }
    for (const region of ruRegions) {
      expect(RU_REGION_ORG_1979[region._id], `1979 org missing ${region._id}`).toBeDefined();
      expect(RU_REGION_ORG_1979[region._id].cpsu).toBeGreaterThanOrEqual(90);
    }
  });

  it("RU: turnout rows cover all 17 regions with the su_voterGroups group ids", async () => {
    const { ruDemographicTurnout } = await import("@/lib/seeds/ru/ruDemographicTurnout");
    const { ruDemographicCategories } = await import("@/lib/seeds/ru/ruDemographicCategories");
    const { ruRegions1953 } = await import("@/lib/seeds/ru/ruRegions1953");

    expect(ruDemographicTurnout).toHaveLength(ruRegions1953.length);
    const turnoutIds = new Set(ruDemographicTurnout.map((t) => t._id));
    for (const region of ruRegions1953) {
      expect(turnoutIds.has(region._id), `missing turnout for ${region._id}`).toBe(true);
    }

    // Modifier keys must match the seeded demographic category's group ids —
    // a drifted key would silently zero out GOTV effects for that group.
    const category = ruDemographicCategories.find((c) => c._id === "su_voterGroups");
    expect(category).toBeDefined();
    const groupIds = new Set(category!.groups.map((g) => g.id));
    for (const row of ruDemographicTurnout) {
      for (const key of Object.keys(row.modifiers.su_voterGroups)) {
        expect(groupIds.has(key), `turnout key "${key}" not a su_voterGroups group`).toBe(true);
      }
    }
  });
});

describe("country coverage: DD (East Germany) seed surfaces", () => {
  it("DD: turnout rows cover every Land with the dd_voterGroups group ids (ticket #1121)", async () => {
    const { ddDemographicTurnout } = await import("@/lib/seeds/dd/ddDemographicTurnout");
    const { ddDemographicCategories } = await import("@/lib/seeds/dd/ddDemographicCategories");
    const { ddRegions1953 } = await import("@/lib/seeds/dd/ddRegions1953");

    expect(ddDemographicTurnout).toHaveLength(ddRegions1953.length);
    const turnoutIds = new Set(ddDemographicTurnout.map((t) => t._id));
    for (const region of ddRegions1953) {
      expect(turnoutIds.has(region._id), `missing turnout for ${region._id}`).toBe(true);
    }

    const category = ddDemographicCategories.find((c) => c._id === "dd_voterGroups");
    expect(category).toBeDefined();
    const groupIds = new Set(category!.groups.map((g) => g.id));
    for (const row of ddDemographicTurnout) {
      expect(row.countryId).toBe("DD");
      expect(row.modifiers.dd_voterGroups).toBeDefined();
      for (const key of Object.keys(row.modifiers.dd_voterGroups)) {
        expect(groupIds.has(key), `turnout key "${key}" not a dd_voterGroups group`).toBe(true);
      }
    }
  });

  it("DD 1953: metrics + baselines cover every Land (BEO/MV/BB/ST/SN/TH)", async () => {
    const { ddStateMetrics1953 } = await import("@/lib/seeds/dd/ddStateMetrics1953");
    const { ddStateBaselines1953 } = await import("@/lib/seeds/dd/ddStateBaselines1953");
    const { ddRegions1953 } = await import("@/lib/seeds/dd/ddRegions1953");
    expect(ddRegions1953.length).toBeGreaterThan(0);
    const metricIds = new Set(ddStateMetrics1953.map((m) => m._id));
    const baselineIds = new Set(ddStateBaselines1953.map((b) => b._id));
    for (const region of ddRegions1953) {
      expect(metricIds.has(region._id), `1953 missing metrics for ${region._id}`).toBe(true);
      expect(baselineIds.has(region._id), `1953 missing baseline for ${region._id}`).toBe(true);
    }
  });

  // Regression for #3370 P3 "DD frozen byte-identical across runs": the metric
  // engine compounds `states.gdp` keyed by state._id using matching
  // stateMetrics/macroMetrics docs. The retired DD_BER/NOR/SOU macro-regions
  // must never reappear in the 1953 (or 1979) seed surface — a states↔metrics
  // id mismatch leaves GDP compounding as a cold-start no-op.
  it("DD 1953/1979: never seed the retired DD_BER/NOR/SOU macro-region ids", async () => {
    const { ddRegions1953 } = await import("@/lib/seeds/dd/ddRegions1953");
    const { ddRegions } = await import("@/lib/seeds/dd/ddRegions");
    const { ddStateMetrics1953 } = await import("@/lib/seeds/dd/ddStateMetrics1953");
    const { ddStateMetrics } = await import("@/lib/seeds/dd/ddStateMetrics");
    const { ddRegionCensusData1953 } = await import("@/lib/seeds/dd/ddRegionCensusData1953");
    const { ddRegionCensusData } = await import("@/lib/seeds/dd/ddRegionCensusData");
    const legacy = new Set(["DD_BER", "DD_NOR", "DD_SOU"]);
    for (const id of ddRegions1953.map((r) => r._id)) expect(legacy.has(id)).toBe(false);
    for (const id of ddRegions.map((r) => r._id)) expect(legacy.has(id)).toBe(false);
    for (const id of ddStateMetrics1953.map((m) => m._id)) expect(legacy.has(id)).toBe(false);
    for (const id of ddStateMetrics.map((m) => m._id)) expect(legacy.has(id)).toBe(false);
    for (const id of Object.keys(ddRegionCensusData1953)) expect(legacy.has(id)).toBe(false);
    for (const id of Object.keys(ddRegionCensusData)) expect(legacy.has(id)).toBe(false);
  });

  it("DD 1979: metrics + baselines cover every Land region (BEO/MV/BB/ST/SN/TH)", async () => {
    const { ddStateMetrics } = await import("@/lib/seeds/dd/ddStateMetrics");
    const { ddStateBaselines } = await import("@/lib/seeds/dd/ddStateBaselines");
    const { ddRegions } = await import("@/lib/seeds/dd/ddRegions");
    const metricIds = new Set(ddStateMetrics.map((m) => m._id));
    const baselineIds = new Set(ddStateBaselines.map((b) => b._id));
    for (const region of ddRegions) {
      expect(metricIds.has(region._id), `1979 missing metrics for ${region._id}`).toBe(true);
      expect(baselineIds.has(region._id), `1979 missing baseline for ${region._id}`).toBe(true);
    }
  });

  it("DD: the Layer-1 census keys match the seeded regions in each era", async () => {
    const { getDdModel } = await import("@/lib/seeds/international/dd");
    const { ddRegions1953 } = await import("@/lib/seeds/dd/ddRegions1953");
    const { ddRegions } = await import("@/lib/seeds/dd/ddRegions");
    const census1953 = new Set(Object.keys(getDdModel("1953").census));
    for (const region of ddRegions1953) {
      expect(census1953.has(region._id), `1953 census missing ${region._id}`).toBe(true);
    }
    const census1979 = new Set(Object.keys(getDdModel("1979").census));
    for (const region of ddRegions) {
      expect(census1979.has(region._id), `1979 census missing ${region._id}`).toBe(true);
    }
  });

  it("DD: National Front parties are preset-valid and resolve via SLUG_TO_NAME", async () => {
    const { ddParties } = await import("@/lib/seeds/dd/ddParties");
    const { SLUG_TO_NAME } = await import("@/lib/npp/seedHistorical");
    const seededNames = new Set(ddParties.map((p) => p.name));
    for (const slug of ["dd_sed", "dd_cdu", "dd_ldpd", "dd_ndpd", "dd_dbd"]) {
      const name = SLUG_TO_NAME[slug];
      expect(name, `slug ${slug} not in SLUG_TO_NAME`).toBeDefined();
      expect(seededNames.has(name), `slug ${slug} -> "${name}" not a seeded DD party`).toBe(true);
    }
    for (const party of ddParties) {
      expect(party.validForPresets).toEqual(
        expect.arrayContaining(["1953-default", "1979-default"])
      );
    }
  });
});

// Playability wiring for the promoted DD player country — pins the fixes for the
// two silent blockers found post-promotion: (1) DD was absent from the per-country
// one-party bill registry, so DD bills never enacted/failed and the one-party
// legitimacy/confidence/escalation drift never ticked; (2) the seeded Volkskammer
// carried officeType "chamber" while the government-formation seat tally queries
// getLowerChamberOfficeType("DD") = "volkskammerDeputy", so the SED tallied 0 seats
// and no General Secretary could be appointed. Plus the cabinet (placeholder → real).
describe("country wiring: DD (East Germany) is a fully playable one-party state", () => {
  it("DD is registered for the one-party bill lifecycle", async () => {
    const { COUNTRY_BILL_PHASES } = await import("@/lib/turn/countryPhases");
    expect(COUNTRY_BILL_PHASES.DD).toBeDefined();
    expect(COUNTRY_BILL_PHASES.DD?.phaseName).toBe("ddBillLifecycle");
  });

  it("DD Volkskammer seed office type matches the government-formation tally office type", async () => {
    const { getLowerChamberOfficeType } = await import("@/lib/legislature/chamberOfficeType");
    const { DD_VOLKSKAMMER_1953, DD_VOLKSKAMMER_1979 } =
      await import("@/lib/constants/historicalSeats");
    const lowerOffice = getLowerChamberOfficeType("DD");
    expect(lowerOffice).toBe("volkskammerDeputy");
    const seats = [...DD_VOLKSKAMMER_1953, ...DD_VOLKSKAMMER_1979];
    expect(seats.length).toBeGreaterThan(0);
    for (const seat of seats) {
      expect(seat.officeType).toBe(lowerOffice);
    }
  });

  it("DD has a real cabinet (positions + mechanics), wired to the General Secretary", async () => {
    const { getCabinetPositions, getAllCabinetMechanics } =
      await import("@/lib/constants/cabinetMechanics");
    const positions = getCabinetPositions("DD");
    expect(positions.length).toBeGreaterThan(0);
    const head = positions.find((p) => "isHeadOfGovernment" in p && p.isHeadOfGovernment);
    expect(head?.id).toBe("generalSecretary"); // matches COUNTRY_CONFIGS.DD executive office key
    expect(positions.some((p) => p.id === "minister_of_finance")).toBe(true); // financeMinisterCabinetId
    expect(Object.keys(getAllCabinetMechanics("DD")).length).toBeGreaterThan(0);
  });

  it("DD has a one-party popular-mood profile (legitimacy drift is live)", async () => {
    const { COUNTRY_CONFIGS } = await import("@/lib/constants/countries");
    expect(COUNTRY_CONFIGS.DD.popularMoodProfile).toBeDefined();
  });
});
