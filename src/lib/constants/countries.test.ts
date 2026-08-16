import { describe, it, expect } from "vitest";
import {
  ALL_COUNTRY_IDS,
  COUNTRY_CONFIGS,
  COUNTRY_ORDER,
  type CountryId,
  ZOD_COUNTRY_ENUM,
  getCountryConfig,
  getCountryDisplayName,
  getCountryLocale,
  getExecutiveOfficeKey,
  getHeadOfStateTitle,
  getHeadOfStateOfficeType,
  getNationalAddressName,
  getOfficeTypeConfig,
  getPartyStrengthWeight,
  getRegionAppointableSeats,
  getRegionalAddressName,
  getSubNationalLegislatureKey,
} from "./countries";
import { COUNTRY_CURRENCY_MAP, FOREX_ACTIVE_COUNTRIES } from "./currencies";
import { RU_NATIONALITIES_SEATS } from "./ruSeats";
import {
  getOfficeTypeForChamber,
  getUpperChamberOfficeType,
} from "@/lib/legislature/chamberOfficeType";
import { getExecutiveTermLimit } from "@/lib/elections/executiveTermLimits";

describe("getCountryLocale", () => {
  it("returns en-GB for UK", () => {
    expect(getCountryLocale("UK")).toBe("en-GB");
  });
  it("returns en-US for US/JP/DE", () => {
    expect(getCountryLocale("US")).toBe("en-US");
    expect(getCountryLocale("JP")).toBe("en-US");
    expect(getCountryLocale("DE")).toBe("en-US");
  });
});

describe("getRegionalAddressName", () => {
  it("returns 'State of the State' for US/JP", () => {
    expect(getRegionalAddressName("US")).toBe("State of the State");
    expect(getRegionalAddressName("JP")).toBe("State of the State");
  });
  it("returns 'Government Statement' for DE", () => {
    expect(getRegionalAddressName("DE")).toBe("Government Statement");
  });
});

describe("getHeadOfStateTitle — Ireland", () => {
  it("returns 'Uachtarán na hÉireann' for IE", () => {
    expect(getHeadOfStateTitle(COUNTRY_CONFIGS.IE)).toBe("Uachtarán na hÉireann");
  });
});

describe("getHeadOfStateOfficeType", () => {
  it("resolves the office-based head of state for non-monarchy systems", () => {
    // CN President of the PRC (CCP chair) and IE Uachtarán are office-based.
    expect(getHeadOfStateOfficeType(COUNTRY_CONFIGS.CN)).toBe("president");
    expect(getHeadOfStateOfficeType(COUNTRY_CONFIGS.IE)).toBe("uachtaran");
  });

  it("returns null for monarchies (UK/JP) — they use the imperial-character system", () => {
    expect(getHeadOfStateOfficeType(COUNTRY_CONFIGS.UK)).toBeNull();
    expect(getHeadOfStateOfficeType(COUNTRY_CONFIGS.JP)).toBeNull();
  });

  it("returns null for presidential systems (US) — the executive president is not a flagged ceremonial office", () => {
    expect(getHeadOfStateOfficeType(COUNTRY_CONFIGS.US)).toBeNull();
  });
});

describe("getNationalAddressName — Ireland", () => {
  it("returns 'Address to the Oireachtas' for IE", () => {
    expect(getNationalAddressName("IE")).toBe("Address to the Oireachtas");
  });
});

describe("getOfficeTypeConfig — Ireland office types", () => {
  it("returns the Tánaiste office config with the expected shape", () => {
    const tanaiste = getOfficeTypeConfig("IE", "tanaiste");
    expect(tanaiste).toEqual({
      key: "tanaiste",
      label: "Tánaiste",
      labelPlural: "Tánaistí",
      isExecutive: true,
      isSubNational: false,
      actionBonus: 2,
      partyStrengthWeight: 1.0,
    });
  });

  it("keeps Taoiseach as the head-of-government executive office", () => {
    // getExecutiveOfficeKey returns the first isExecutive && !isSubNational
    // office in declaration order. Taoiseach must stay first so the head-of-
    // government resolution doesn't drift to Tánaiste or Uachtarán.
    expect(getExecutiveOfficeKey("IE")).toBe("taoiseach");
  });

  it("returns the Uachtarán office config with the expected shape", () => {
    const uachtaran = getOfficeTypeConfig("IE", "uachtaran");
    expect(uachtaran).toEqual({
      key: "uachtaran",
      // Bare label — executive-label renderer appends "of Ireland" at render
      // time. The full "Uachtarán na hÉireann" lives on headOfStateTitle.
      label: "Uachtarán",
      labelPlural: "Uachtaráin",
      isExecutive: true,
      // IE's ceremonial head of state (President of Ireland).
      isHeadOfState: true,
      isSubNational: false,
      termYears: 7,
      actionBonus: 3,
      partyStrengthWeight: 0.5,
    });
  });

  it("keeps Taoiseach first even after adding Uachtarán", () => {
    expect(getExecutiveOfficeKey("IE")).toBe("taoiseach");
  });
});

describe("France — era institutional overlay (Fourth vs Fifth Republic)", () => {
  it("keeps the Fifth Republic semi-presidential base when no preset is given", () => {
    const fr = getCountryConfig("FR");
    expect(fr.governmentType).toBe("presidential");
    expect(fr.governmentTypeLabel).toBe("Semi-Presidential Republic");
    expect(fr.executiveTitle).toBe("President");
    expect(fr.legislature.lowerChamber.seats).toBe(491);
    expect(fr.legislature.upperChamber?.name).toBe("Senate");
    expect(fr.legislature.upperChamber?.seats).toBe(305);
    expect(fr.coalitionThreshold).toBe(246);
    expect(fr.electionSystems.headOfState).toBe("fptp");
    expect(getExecutiveOfficeKey("FR")).toBe("president");
  });

  it("1979-default leaves the Fifth Republic base untouched", () => {
    const fr = getCountryConfig("FR", "1979-default");
    expect(fr).toEqual(getCountryConfig("FR"));
    expect(fr.governmentType).toBe("presidential");
    expect(fr.legislature.lowerChamber.seats).toBe(491);
  });

  it("1953-default applies the Fourth Republic parliamentary overlay", () => {
    const fr = getCountryConfig("FR", "1953-default");
    expect(fr.governmentType).toBe("parliamentaryRepublic");
    expect(fr.governmentTypeLabel).toBe("Parliamentary Republic");
    expect(fr.executiveTitle).toBe("President of the Council");
    expect(fr.headOfStateTitle).toBe("President");
    expect(fr.electionSystems.headOfGovernment).toBe("parliamentary");
    expect(fr.electionSystems.headOfState).toBe("ceremonial");
    expect(fr.legislature.bicameral).toBe(true);
    expect(fr.legislature.lowerChamber.seats).toBe(627);
    expect(fr.legislature.upperChamber?.name).toBe("Council of the Republic");
    expect(fr.legislature.upperChamber?.seats).toBe(320);
    expect(fr.coalitionThreshold).toBe(314);
    // Chamber keys stay stable for election-type / office mappings.
    expect(fr.legislature.lowerChamber.key).toBe("assembleeNationale");
    expect(fr.legislature.upperChamber?.key).toBe("senat");
    // Real executive is first (Italy/IE pattern).
    expect(getExecutiveOfficeKey("FR", "1953-default")).toBe("primeMinister");
    expect(getOfficeTypeConfig("FR", "president", "1953-default")).toMatchObject({
      isHeadOfState: true,
      actionBonus: 0,
      partyStrengthWeight: 0,
    });
  });
});

describe("UK — 1953 Commons size overlay (ticket #1078)", () => {
  it("keeps the modern 650-seat Commons when no preset is given", () => {
    const uk = getCountryConfig("UK");
    expect(uk.legislature.lowerChamber.seats).toBe(650);
    expect(uk.coalitionThreshold).toBe(326);
  });

  it("1953-default is a 625-seat Commons with majority 313", () => {
    const uk = getCountryConfig("UK", "1953-default");
    expect(uk.legislature.lowerChamber.seats).toBe(625);
    expect(uk.coalitionThreshold).toBe(313);
  });
});

describe("CN — 1953 central-transfer-pool era override (fiscal-scale audit, 2026-07-28)", () => {
  it("keeps the modern/1991 CNY-calibrated pool (35/capita) when no preset is given", () => {
    const cn = getCountryConfig("CN");
    expect(cn.onePartyRegionalBudget?.centralTransferPerCapita).toBe(35);
  });

  it("1991-default is unaffected (only 1953-default gets the override)", () => {
    const cn = getCountryConfig("CN", "1991-default");
    expect(cn.onePartyRegionalBudget?.centralTransferPerCapita).toBe(35);
  });

  it("1953-default scales the pool down so it can't blow past CN's own GDP", () => {
    const cn = getCountryConfig("CN", "1953-default");
    const base = getCountryConfig("CN");
    // Flat 35/capita × CN 1953's 588M population = $20.58B — 62% of the
    // $33.3B USD-anchored 1953 GDP in "central transfer grants" alone (the
    // driver of CN's turn-26 64%-of-GDP deficit / debt-ceiling breach in a
    // fresh 1953 world). The override matches CN's own already-authored 1953
    // baselineStateGrants ($1.63B) instead.
    expect(cn.onePartyRegionalBudget?.centralTransferPerCapita).toBeCloseTo(2.77, 2);
    const pool1953 = (cn.onePartyRegionalBudget?.centralTransferPerCapita ?? 0) * 588_000_000;
    expect(pool1953).toBeLessThan(0.1 * 33_300_000_000); // well under 10% of 1953 GDP
    // Every other onePartyRegionalBudget knob is untouched — only the
    // currency-denominated per-capita constant needed era scaling; the
    // ratio-based EIT/resource/business-tax formulas already scale with GDP.
    expect(cn.onePartyRegionalBudget).toMatchObject({
      ...base.onePartyRegionalBudget,
      centralTransferPerCapita: expect.any(Number),
    });
  });
});

describe("getRegionAppointableSeats", () => {
  const keys = (cid: Parameters<typeof getRegionAppointableSeats>[0]) =>
    getRegionAppointableSeats(cid).map((s) => s.officeType);
  const byKind = (cid: Parameters<typeof getRegionAppointableSeats>[0], kind: string) =>
    getRegionAppointableSeats(cid).find((s) => s.kind === kind);

  it("US: governor + classed senate + house + state senate, in order", () => {
    expect(keys("US")).toEqual(["governor", "senate", "house", "stateSenate"]);
    expect(byKind("US", "classedUpper")?.officeType).toBe("senate");
    expect(byKind("US", "lowerChamber")).toMatchObject({
      officeType: "house",
      multiSeat: true,
      totalField: "houseDistricts",
    });
    expect(byKind("US", "subNationalChamber")).toMatchObject({
      officeType: "stateSenate",
      multiSeat: true,
      totalField: "stateSenateSeats",
    });
  });

  it("CN: governor + NPC delegate + provincial congress, with NO classed senate group", () => {
    expect(keys("CN")).toEqual(["governor", "npcDelegate", "peoplesCongress"]);
    expect(byKind("CN", "classedUpper")).toBeUndefined();
    expect(byKind("CN", "lowerChamber")).toMatchObject({
      officeType: "npcDelegate",
      multiSeat: true,
      totalField: "houseDistricts",
    });
    expect(byKind("CN", "subNationalChamber")?.officeType).toBe("peoplesCongress");
  });

  it("RU: first secretary + nationalities deputy + union deputy + republic soviet", () => {
    expect(keys("RU")).toEqual([
      "governor",
      "nationalitiesDeputy",
      "supremeSovietDeputy",
      "republicSupremeSoviet",
    ]);
    expect(byKind("RU", "classedUpper")).toBeUndefined();
    const upper = byKind("RU", "upperChamber");
    expect(upper).toMatchObject({
      officeType: "nationalitiesDeputy",
      multiSeat: true,
      totalField: null,
    });
    // Totals come from the D11 apportionment map, not a State field.
    expect(upper?.totalsByRegion).toBe(RU_NATIONALITIES_SEATS);
    expect(upper?.totalsByRegion?.TRA).toBe(108);
  });

  it("only RU carries an upperChamber group (JP's Sangiin has no per-region totals map)", () => {
    for (const cid of ["US", "CN", "DE", "JP", "UK", "IE", "BR", "NG"] as const) {
      expect(byKind(cid, "upperChamber")).toBeUndefined();
    }
  });

  it("DE: minister-president executive + bundestag + landtag, no classed senate (Bundesrat appointed)", () => {
    expect(keys("DE")).toEqual(["ministerPresident", "bundestag", "landtag"]);
    expect(byKind("DE", "executive")?.officeType).toBe("ministerPresident");
    expect(byKind("DE", "classedUpper")).toBeUndefined();
  });

  it("JP: governor + shugiin + Regional Council — no classed senate (Sangiin not appointable here)", () => {
    expect(keys("JP")).toEqual(["governor", "shugiin", "regionalCouncil"]);
    expect(byKind("JP", "classedUpper")).toBeUndefined();
    expect(byKind("JP", "subNationalChamber")).toMatchObject({
      officeType: "regionalCouncil",
      multiSeat: true,
      totalField: "stateSenateSeats",
    });
  });

  it("DD: Land First Secretary + Volkskammer deputy + Land assembly", () => {
    expect(keys("DD")).toEqual(["governor", "volkskammerDeputy", "landAssembly"]);
    expect(byKind("DD", "executive")?.officeType).toBe("governor");
    expect(byKind("DD", "subNationalChamber")).toMatchObject({
      officeType: "landAssembly",
      multiSeat: true,
      totalField: "stateSenateSeats",
    });
    expect(getSubNationalLegislatureKey("DD")).toBe("landAssembly");
  });

  it("every executive group is single-seat with no total field", () => {
    for (const cid of ["US", "CN", "DE", "JP", "IE"] as const) {
      const exec = byKind(cid, "executive");
      expect(exec?.multiSeat).toBe(false);
      expect(exec?.totalField).toBeNull();
    }
  });
});

describe("executiveTermLimit — Ireland Uachtarán", () => {
  it("limits Uachtarán to 2 terms", () => {
    expect(getExecutiveTermLimit("IE")).toBe(2);
  });

  it("targets the uachtaran office key (not the Taoiseach)", () => {
    expect(COUNTRY_CONFIGS.IE.executiveTermLimit).toEqual({
      officeKey: "uachtaran",
      maxTermsPerCharacter: 2,
      blocksRunningMateSelection: false,
    });
  });
});

describe("sub-national chamber config — whip-states", () => {
  it("US has a stateSenate sub-national chamber that is NOT a regional model", () => {
    const sub = getCountryConfig("US").subNationalChamber;
    expect(sub).toBeDefined();
    expect(sub?.key).toBe("stateSenate");
    expect(sub?.shortName).toBe("State Senate");
    expect(sub?.regionalModel).toBeFalsy();
  });

  it.each(["UK", "DE", "JP", "IE", "CN"] as const)(
    "%s sub-national chamber is a regional model",
    (country) => {
      const sub = getCountryConfig(country).subNationalChamber;
      expect(sub).toBeDefined();
      expect(sub?.regionalModel).toBe(true);
    }
  );
});

describe("Scotland (SCO) latent config", () => {
  const sco = getCountryConfig("SCO");
  it("is a coming-soon unicameral GBP country with a 129-seat Holyrood (AMS)", () => {
    expect(sco.status).toBe("coming-soon");
    expect(sco.currencyCode).toBe("GBP");
    expect(sco.legislature.bicameral).toBe(false);
    expect(sco.legislature.upperChamber).toBeUndefined();
    expect(sco.legislature.lowerChamber.seats).toBe(129);
    expect(sco.legislature.lowerChamber.key).toBe("holyrood");
    expect(sco.electionSystems.lowerChamber).toBe("ams");
    expect(sco.executiveTitle).toBe("First Minister");
    expect(sco.coalitionThreshold).toBe(65);
  });
  it("shares the GBP rate via UK and is not forex-active", () => {
    expect(COUNTRY_CURRENCY_MAP.SCO).toBe("GBP");
    expect(FOREX_ACTIVE_COUNTRIES).not.toContain("SCO");
  });
  it("stays out of COUNTRY_ORDER (invisible until secession activates it)", () => {
    expect(COUNTRY_ORDER).not.toContain("SCO");
  });
});

describe("Wales (WAL) latent config", () => {
  const wal = getCountryConfig("WAL");
  it("is a coming-soon unicameral GBP country with a 60-seat Senedd (AMS)", () => {
    expect(wal.status).toBe("coming-soon");
    expect(wal.currencyCode).toBe("GBP");
    expect(wal.legislature.bicameral).toBe(false);
    expect(wal.legislature.upperChamber).toBeUndefined();
    expect(wal.legislature.lowerChamber.seats).toBe(60);
    expect(wal.legislature.lowerChamber.key).toBe("senedd");
    expect(wal.electionSystems.lowerChamber).toBe("ams");
    expect(wal.executiveTitle).toBe("First Minister");
    expect(wal.coalitionThreshold).toBe(31);
  });
  it("shares the GBP rate via UK, is not forex-active, and stays out of COUNTRY_ORDER", () => {
    expect(COUNTRY_CURRENCY_MAP.WAL).toBe("GBP");
    expect(FOREX_ACTIVE_COUNTRIES).not.toContain("WAL");
    expect(COUNTRY_ORDER).not.toContain("WAL");
  });
});

describe("ALL_COUNTRY_IDS (validation universe)", () => {
  it("is every configured CountryId, including latent SCO/WAL", () => {
    expect([...ALL_COUNTRY_IDS].sort()).toEqual((Object.keys(COUNTRY_CONFIGS) as string[]).sort());
    expect(ALL_COUNTRY_IDS).toContain("SCO");
    expect(ALL_COUNTRY_IDS).toContain("WAL");
  });
  it("ZOD_COUNTRY_ENUM validates against ALL ids (superset of COUNTRY_ORDER incl. SCO)", () => {
    for (const id of COUNTRY_ORDER) expect(ZOD_COUNTRY_ENUM).toContain(id);
    expect(ZOD_COUNTRY_ENUM).toContain("SCO");
  });
});

describe("JP Regional Council office type", () => {
  it("defines a regionalCouncil office type mirroring the UK pattern", () => {
    const office = getOfficeTypeConfig("JP", "regionalCouncil");
    expect(office).toBeDefined();
    expect(office?.isSubNational).toBe(true);
    expect(office?.isExecutive).toBe(false);
    expect(office?.chamberKey).toBe("regionalCouncil");
  });

  it("weights regionalCouncil party strength like other sub-national chambers (0.85, not the 0.9 fallback)", () => {
    expect(getPartyStrengthWeight("JP", "regionalCouncil")).toBe(0.85);
  });

  it("includes the Regional Council in JP's admin region-appointable seats", () => {
    const specs = getRegionAppointableSeats("JP");
    const sub = specs.find((s) => s.kind === "subNationalChamber");
    expect(sub).toBeDefined();
    expect(sub?.officeType).toBe("regionalCouncil");
    expect(sub?.totalField).toBe("stateSenateSeats");
  });
});

describe("headOfStateSelection", () => {
  it("CN keeps the party-chair sync model", () => {
    expect(COUNTRY_CONFIGS.CN.headOfStateSelection).toBe("partyChairSync");
  });

  it("RU appoints its head of state through the legislature", () => {
    expect(COUNTRY_CONFIGS.RU.headOfStateSelection).toBe("legislatureAppointment");
  });

  it("is only ever set on one-party states", () => {
    for (const config of Object.values(COUNTRY_CONFIGS)) {
      if (config.headOfStateSelection !== undefined) {
        expect(config.governmentType, config.id).toBe("onePartyState");
      }
    }
  });
});

describe("RU Supreme Soviet config (D8/D3)", () => {
  const ru = COUNTRY_CONFIGS.RU;

  it("is bill-active bicameral with a contested upper chamber", () => {
    expect(ru.legislature.bicameral).toBe(true);
    expect(ru.upperElectionSystem).toMatchObject({
      termYears: 4,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: false,
    });
  });

  it("maps both chamber keys to their deputy officeTypes", () => {
    expect(getOfficeTypeForChamber("RU", "sovietOfTheUnion")).toBe("supremeSovietDeputy");
    expect(getOfficeTypeForChamber("RU", "sovietOfNationalities")).toBe("nationalitiesDeputy");
  });

  it("has a nationalitiesDeputy officeType mirroring the Union deputy", () => {
    const nat = ru.officeTypes.find((o) => o.key === "nationalitiesDeputy");
    expect(nat).toMatchObject({
      chamberKey: "sovietOfNationalities",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.85,
    });
  });

  it("uses 4-year terms on every convocation-cycle office", () => {
    expect(ru.lowerElectionSystem.termYears).toBe(4);
    for (const key of [
      "premier",
      "supremeSovietDeputy",
      "nationalitiesDeputy",
      "republicSupremeSoviet",
      "governor",
    ]) {
      const office = ru.officeTypes.find((o) => o.key === key);
      expect(office?.termYears, key).toBe(4);
    }
  });

  it("keeps the Gosbank chairmanship off the convocation cycle", () => {
    expect(ru.officeTypes.find((o) => o.key === "centralBankChair")?.termYears).toBe(5);
  });
});

describe("TR legislature era overrides", () => {
  it("keeps 1979-default (and no-preset) bicameral Senato + Meclis untouched", () => {
    const base = getCountryConfig("TR");
    const for1979 = getCountryConfig("TR", "1979-default");
    expect(base.legislature.bicameral).toBe(true);
    expect(base.legislature.upperChamber?.key).toBe("senato");
    expect(base.legislature.lowerChamber.seats).toBe(450);
    expect(base.coalitionThreshold).toBe(226);
    expect(base.officeTypes.some((o) => o.key === "senator")).toBe(true);
    expect(base.upperElectionSystem).toBeDefined();
    expect(for1979).toEqual(base);
  });

  it("makes 1953-default a unicameral 487-seat TBMM (no Senato)", () => {
    // 487 = 1950 general election TBMM size (YSK / Nohlen); matches trRegions1953.
    const tr1953 = getCountryConfig("TR", "1953-default");
    expect(tr1953.majorPartyIds).toEqual(["tr_dp", "tr_chp"]);
    expect(tr1953.legislature.bicameral).toBe(false);
    expect(tr1953.legislature.upperChamber).toBeUndefined();
    expect(tr1953.legislature.lowerChamber).toMatchObject({
      key: "milletMeclisi",
      seats: 487,
    });
    expect(tr1953.coalitionThreshold).toBe(244);
    expect(tr1953.upperElectionSystem).toBeUndefined();
    expect(tr1953.electionSystems.upperChamber).toBeUndefined();
    expect(tr1953.officeTypes.some((o) => o.key === "senator")).toBe(false);
    expect(tr1953.officeTypes.some((o) => o.key === "deputy")).toBe(true);
    expect(getUpperChamberOfficeType("TR", "1953-default")).toBeUndefined();
    expect(getOfficeTypeForChamber("TR", "milletMeclisi", "1953-default")).toBe("deputy");
  });
});

describe("Spain — era institutional overlay (Franco OPS vs Transition monarchy)", () => {
  it("keeps the 1978 parliamentary-monarchy base when no preset is given", () => {
    const es = getCountryConfig("ES");
    expect(es.governmentType).toBe("parliamentaryMonarchy");
    expect(es.governmentTypeLabel).toBe("Parliamentary Monarchy");
    expect(es.executiveTitle).toBe("Prime Minister");
    expect(es.headOfStateTitle).toBe("King");
    expect(es.regionLabel).toBe("Autonomous Community");
    expect(es.legislature.name).toBe("Cortes Generales");
    expect(es.legislature.bicameral).toBe(true);
    expect(es.legislature.lowerChamber.seats).toBe(350);
    expect(es.legislature.upperChamber?.key).toBe("senado");
    expect(es.majorPartyIds).toEqual(["es_ucd", "es_psoe"]);
    expect(es.rulingPartyId).toBeUndefined();
    expect(getExecutiveOfficeKey("ES")).toBe("primeMinister");
  });

  it("1979-default leaves the Transition monarchy base untouched", () => {
    const es = getCountryConfig("ES", "1979-default");
    expect(es).toEqual(getCountryConfig("ES"));
    expect(es.governmentType).toBe("parliamentaryMonarchy");
    expect(es.legislature.name).toBe("Cortes Generales");
    expect(es.regionLabel).toBe("Autonomous Community");
  });

  it("1953-default applies Franco's one-party-state overlay", () => {
    const es = getCountryConfig("ES", "1953-default");
    expect(es.governmentType).toBe("onePartyState");
    expect(es.governmentTypeLabel).toBe("One Party State");
    expect(es.executiveTitle).toBe("Caudillo");
    expect(es.headOfStateTitle).toBe("Jefe del Estado");
    expect(es.regionLabel).toBe("Province");
    expect(es.regionLabelPlural).toBe("Provinces");
    expect(es.rulingPartyId).toBe(1);
    expect(es.majorPartyIds).toEqual(["es_fet"]);
    expect(es.legislature.name).toBe("Cortes Españolas");
    expect(es.legislature.bicameral).toBe(false);
    expect(es.legislature.upperChamber).toBeUndefined();
    expect(es.legislature.lowerChamber).toMatchObject({
      key: "congresoDiputados",
      name: "Cortes Españolas",
      seats: 350,
      elected: false,
    });
    expect(es.coalitionThreshold).toBe(176);
    expect(es.upperElectionSystem).toBeUndefined();
    expect(es.electionSystems.upperChamber).toBeUndefined();
    expect(es.officeTypes.some((o) => o.key === "monarch")).toBe(false);
    expect(es.officeTypes.some((o) => o.key === "senator")).toBe(false);
    expect(es.officeTypes.some((o) => o.key === "primeMinister")).toBe(false);
    // Single executive who is also head of state (DD pattern; Franco held both).
    expect(getExecutiveOfficeKey("ES", "1953-default")).toBe("caudillo");
    expect(getHeadOfStateOfficeType(es)).toBe("caudillo");
    expect(getOfficeTypeForChamber("ES", "congresoDiputados", "1953-default")).toBe("procurador");
    expect(getUpperChamberOfficeType("ES", "1953-default")).toBeUndefined();
  });
});

describe("SE legislature era overrides", () => {
  it("keeps 1979-default (and no-preset) unicameral Riksdag untouched", () => {
    const base = getCountryConfig("SE");
    const for1979 = getCountryConfig("SE", "1979-default");
    expect(base.legislature.bicameral).toBe(false);
    expect(base.legislature.lowerChamber).toMatchObject({
      key: "riksdag",
      name: "Riksdag",
      seats: 349,
    });
    expect(base.legislature.upperChamber).toMatchObject({
      key: "forstaKammaren",
      seats: 151,
    });
    expect(base.coalitionThreshold).toBe(175);
    expect(base.upperElectionSystem).toBeUndefined();
    expect(for1979).toEqual(base);
  });

  it("makes 1953-default a bicameral Riksdag (IE Seanad-style First Chamber)", () => {
    // Seats match seRegions1953: Andra 230 (houseDistricts), Första 150 (stateSenateSeats).
    const se1953 = getCountryConfig("SE", "1953-default");
    expect(se1953.majorPartyIds).toEqual(["se_sap", "se_h"]);
    // bicameral:false = not in the player bill loop (IE/UK pattern); upper still present.
    expect(se1953.legislature.bicameral).toBe(false);
    expect(se1953.legislature.lowerChamber).toMatchObject({
      key: "riksdag", // stable election-type key
      name: "Second Chamber",
      shortName: "Andra kammaren",
      seats: 230,
      elected: true,
    });
    expect(se1953.legislature.upperChamber).toMatchObject({
      key: "forstaKammaren",
      name: "First Chamber",
      shortName: "Första kammaren",
      seats: 150,
    });
    expect(se1953.legislature.upperChamber?.elected).toBeUndefined();
    expect(se1953.coalitionThreshold).toBe(116);
    expect(se1953.upperElectionSystem).toBeUndefined();
    expect(se1953.electionSystems.upperChamber).toBeUndefined();
    expect(se1953.lowerElectionSystem?.termYears).toBe(4);
    expect(getOfficeTypeForChamber("SE", "riksdag", "1953-default")).toBe("member");
    // No player-managed First Chamber office (mirrors IE Seanad — no seanad officeType).
    expect(getUpperChamberOfficeType("SE", "1953-default")).toBeUndefined();
  });
});

describe("region id compaction/canonicalization (prefixed-region countries)", () => {
  it("strips the country prefix for URLs and restores it from params", async () => {
    const { compactRegionCode, canonicalRegionId } = await import("./countries");
    expect(compactRegionCode("HU", "HU_BUD")).toBe("BUD");
    expect(canonicalRegionId("HU", "BUD")).toBe("HU_BUD");
    // Already-canonical input passes through (full-id URLs keep working).
    expect(canonicalRegionId("HU", "HU_BUD")).toBe("HU_BUD");
  });

  it("is a no-op for legacy bare-code countries", async () => {
    const { compactRegionCode, canonicalRegionId } = await import("./countries");
    expect(compactRegionCode("US", "AL")).toBe("AL");
    expect(canonicalRegionId("US", "AL")).toBe("AL");
    expect(compactRegionCode("UK", "SCO")).toBe("SCO");
    expect(canonicalRegionId("UK", "SCO")).toBe("SCO");
  });

  it("round-trips every prefixed country's seed roster", async () => {
    const { compactRegionCode, canonicalRegionId } = await import("./countries");
    const rosters = await Promise.all([
      import("@/lib/seeds/fr/frRegions"),
      import("@/lib/seeds/it/itRegions"),
      import("@/lib/seeds/es/esRegions"),
      import("@/lib/seeds/se/seRegions"),
      import("@/lib/seeds/tr/trRegions"),
      import("@/lib/seeds/hu/huRegions"),
      import("@/lib/seeds/pl/plRegions"),
      import("@/lib/seeds/ro/roRegions"),
      import("@/lib/seeds/yu/yuRegions"),
      import("@/lib/seeds/bg/bgRegions"),
      import("@/lib/seeds/cs/csRegions"),
    ]);
    for (const mod of rosters) {
      for (const region of mod.default) {
        const country = region.countryId;
        const compact = compactRegionCode(country, region._id);
        expect(compact).not.toBe(region._id);
        expect(canonicalRegionId(country, compact)).toBe(region._id);
      }
    }
  });
});

/**
 * Repo-wide config invariants.
 *
 * These sweep every country rather than spot-checking one, because the failure they
 * guard was found the hard way: adding a ceremonial head-of-state office to nine
 * one-party states put it FIRST in `officeTypes`, and `getExecutiveOfficeKey` returns
 * the first executive office — so several countries silently swapped their primary
 * executive for a ceremonial seat with `actionBonus: 0`. Per-country tests all passed;
 * nothing asked the question of every country at once.
 */
describe("country config invariants (all countries)", () => {
  it("never resolves the primary executive to a ceremonial office", () => {
    const broken: string[] = [];
    for (const id of ALL_COUNTRY_IDS) {
      const key = getExecutiveOfficeKey(id);
      const office = COUNTRY_CONFIGS[id].officeTypes.find((o) => o.key === key);
      // Ceremonial = carries no mechanical weight. A real presidential executive is
      // head of state too, but it has an action budget and party weight.
      const ceremonial =
        office?.isHeadOfState && !office.actionBonus && !office.partyStrengthWeight;
      if (ceremonial) broken.push(`${id} -> ${key}`);
    }
    expect(
      broken,
      `Primary executive resolves to a ceremonial seat:\n${broken.join("\n")}`
    ).toEqual([]);
  });

  it("gives every country at most one head-of-state office", () => {
    const broken: string[] = [];
    for (const id of ALL_COUNTRY_IDS) {
      const hos = COUNTRY_CONFIGS[id].officeTypes.filter((o) => o.isHeadOfState);
      if (hos.length > 1) broken.push(`${id}: ${hos.map((o) => o.key).join(", ")}`);
    }
    expect(broken, `More than one isHeadOfState office:\n${broken.join("\n")}`).toEqual([]);
  });

  // A duplicate key makes getOfficeTypeConfig return whichever comes first, so the
  // second definition is dead and its labels never appear. Adding an office a country
  // already had — which is how YU nearly gained a second `president` — is silent.
  it("gives every country unique office keys", () => {
    const broken: string[] = [];
    for (const id of ALL_COUNTRY_IDS) {
      const keys = COUNTRY_CONFIGS[id].officeTypes.map((o) => o.key);
      const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
      if (dupes.length) broken.push(`${id}: ${[...new Set(dupes)].join(", ")}`);
    }
    expect(broken, `Duplicate office keys:\n${broken.join("\n")}`).toEqual([]);
  });

  // The per-turn sync resolves the seat through `getHeadOfStateOfficeType`. A country
  // that declares a selection mechanism but has no office for it would have the sync
  // run every turn and find nothing to write.
  it("gives every country with a head-of-state selection an office to seat", () => {
    const broken: string[] = [];
    for (const id of ALL_COUNTRY_IDS) {
      const config = COUNTRY_CONFIGS[id];
      if (!config.headOfStateSelection) continue;
      if (!getHeadOfStateOfficeType(config)) broken.push(`${id} (${config.headOfStateSelection})`);
    }
    expect(
      broken,
      `headOfStateSelection with no isHeadOfState office:\n${broken.join("\n")}`
    ).toEqual([]);
  });
});

/**
 * Era presets override `officeTypes`, so a country's head-of-state office is not a
 * property of the country — it is a property of the country IN AN ERA.
 *
 * Greece is the case that proves it: a president in the base config, and no
 * head-of-state office at all in 1953. Anything that decides whether to render a
 * head-of-state row from the BASE config will show that row for a country whose
 * office does not exist that era, and the preset-aware route will answer null —
 * which is exactly the false "Vacant" this was all meant to remove.
 */
describe("head-of-state office varies by era preset", () => {
  it("has no head-of-state office for GR in 1953", () => {
    expect(getHeadOfStateOfficeType(getCountryConfig("GR", "1953-default"))).toBeNull();
    // ...and does in the era-neutral base, which is the trap.
    expect(getHeadOfStateOfficeType(COUNTRY_CONFIGS.GR)).not.toBeNull();
  });

  it("swaps ES's head of state from monarch to caudillo in 1953", () => {
    expect(getHeadOfStateOfficeType(COUNTRY_CONFIGS.ES)).toBe("monarch");
    expect(getHeadOfStateOfficeType(getCountryConfig("ES", "1953-default"))).toBe("caudillo");
  });

  // `partyChairHeadOfState` resolves the selection AND the office from the era-neutral
  // config, because the turn sync has no preset in hand. That is only safe while no
  // era override moves either for a chair-synced country. If one ever does, the sync
  // writes the wrong office key and this is the test that says so.
  it("keeps chair-synced countries' head-of-state office stable across presets", () => {
    const presets = ["1953-default", "1979-default", "1991-default", "2019-default"];
    const chairSynced = ALL_COUNTRY_IDS.filter(
      (id) => COUNTRY_CONFIGS[id].headOfStateSelection === "partyChairSync"
    );
    expect(chairSynced.length).toBeGreaterThan(0);
    const broken: string[] = [];
    for (const id of chairSynced) {
      const baseOffice = getHeadOfStateOfficeType(COUNTRY_CONFIGS[id]);
      for (const preset of presets) {
        const config = getCountryConfig(id, preset);
        const office = getHeadOfStateOfficeType(config);
        if (office !== baseOffice || config.headOfStateSelection !== "partyChairSync") {
          broken.push(`${id} @${preset}: office ${baseOffice} -> ${office}`);
        }
      }
    }
    expect(broken, `Chair-sync config moves by era:\n${broken.join("\n")}`).toEqual([]);
  });

  // The invariants above, re-asserted per preset: an era override must not leave a
  // country declaring a selection mechanism with no office to seat, nor hand the
  // primary executive to a ceremonial seat.
  it("keeps the config invariants under every era preset", () => {
    const presets = ["1953-default", "1979-default", "1991-default", "2019-default"];
    const broken: string[] = [];
    for (const preset of presets) {
      for (const id of ALL_COUNTRY_IDS) {
        const config = getCountryConfig(id, preset);
        if (config.headOfStateSelection && !getHeadOfStateOfficeType(config)) {
          broken.push(`${id} @${preset}: ${config.headOfStateSelection} with no office`);
        }
        const key = getExecutiveOfficeKey(id, preset);
        const office = config.officeTypes.find((o) => o.key === key);
        if (office?.isHeadOfState && !office.actionBonus && !office.partyStrengthWeight) {
          broken.push(`${id} @${preset}: primary executive is ceremonial (${key})`);
        }
      }
    }
    expect(broken, `Era-preset config invariants broken:\n${broken.join("\n")}`).toEqual([]);
  });
});

describe("getCountryDisplayName", () => {
  it("returns the configured name for a known country", () => {
    expect(getCountryDisplayName("US")).toBe("United States");
  });

  it("does not throw when the id is missing from COUNTRY_CONFIGS (ticket #1115)", () => {
    // ShortageHeatMap calls this with "" on first paint of /stockmarket/global.
    expect(() => getCountryDisplayName("" as CountryId)).not.toThrow();
    expect(getCountryDisplayName("" as CountryId)).toBe("");
    expect(getCountryDisplayName("STALE" as CountryId)).toBe("STALE");
  });
});
