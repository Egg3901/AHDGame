import { describe, it, expect } from "vitest";
import {
  getLegalStructureForCorp,
  getDefaultLegalStructureId,
  isListedOnlyStructure,
} from "./legalStructure";
import { LEGAL_STRUCTURES } from "@/lib/constants/legalStructures";

describe("getDefaultLegalStructureId", () => {
  it("returns us_c_corp for US", () => {
    expect(getDefaultLegalStructureId("US")).toBe("us_c_corp");
  });
  it("returns jp_kk for JP", () => {
    expect(getDefaultLegalStructureId("JP")).toBe("jp_kk");
  });
  it("falls back to the generic structure for a country without a bespoke default", () => {
    // Cold-War-era nations from the 1991-default preset (e.g. YU) have no
    // bespoke legal form; corporationTurn must still resolve a structure
    // instead of throwing.
    expect(getDefaultLegalStructureId("YU" as never)).toBe("generic_corp");
    expect(getDefaultLegalStructureId("XX" as never)).toBe("generic_corp");
  });
  it("returns the private form for UK/DE/IE/BR/CN/NG when isPrivate", () => {
    expect(getDefaultLegalStructureId("UK", { isPrivate: true })).toBe("uk_ltd");
    expect(getDefaultLegalStructureId("DE", { isPrivate: true })).toBe("de_gmbh");
    expect(getDefaultLegalStructureId("IE", { isPrivate: true })).toBe("ie_dac");
    expect(getDefaultLegalStructureId("BR", { isPrivate: true })).toBe("br_sa_fechada");
    expect(getDefaultLegalStructureId("CN", { isPrivate: true })).toBe("cn_youxian");
    expect(getDefaultLegalStructureId("NG", { isPrivate: true })).toBe("ng_ltd");
  });
  it("keeps the public default for private US/JP corps (no distinct private form)", () => {
    expect(getDefaultLegalStructureId("US", { isPrivate: true })).toBe("us_c_corp");
    expect(getDefaultLegalStructureId("JP", { isPrivate: true })).toBe("jp_kk");
  });
  it("returns the public default when isPrivate is false or omitted", () => {
    expect(getDefaultLegalStructureId("UK")).toBe("uk_plc");
    expect(getDefaultLegalStructureId("UK", { isPrivate: false })).toBe("uk_plc");
  });
});

describe("getLegalStructureForCorp — generic fallback", () => {
  it("resolves the generic structure for a country without a bespoke default", () => {
    const s = getLegalStructureForCorp({ countryId: "YU" as never });
    expect(s.id).toBe("generic_corp");
    expect(s.taxTreatment).toBe("standard");
  });
});

describe("getLegalStructureForCorp", () => {
  it("returns the corp's explicit legal structure", () => {
    const s = getLegalStructureForCorp({ countryId: "US", legalStructure: "us_llc" });
    expect(s.id).toBe("us_llc");
    expect(s.taxTreatment).toBe("pass_through");
    expect(s.minimumDividendRate).toBe(0.2);
  });
  it("falls back to country default when legalStructure is absent", () => {
    const s = getLegalStructureForCorp({ countryId: "UK" });
    expect(s.id).toBe("uk_plc");
    expect(s.isDefault).toBe(true);
  });
  it("falls back to Ltd for a private UK corp with no stored structure", () => {
    // Ticket #1020: private founding left legalStructure unset, so the hero
    // resolved the public default and showed contradictory "Private" + "PLC".
    const s = getLegalStructureForCorp({ countryId: "UK", isPrivate: true });
    expect(s.id).toBe("uk_ltd");
    expect(s.shortName).toBe("Ltd");
  });
  it("self-corrects a stored listed-only form on a private corp back to the private default", () => {
    // A private corp can never legally be a PLC; ignore a stale/explicit PLC and
    // fall through to the private default so the label can't contradict isPrivate.
    const s = getLegalStructureForCorp({
      countryId: "UK",
      isPrivate: true,
      legalStructure: "uk_plc",
    });
    expect(s.id).toBe("uk_ltd");
  });
  it("self-corrects a stored private-default form on a public corp to the listed default", () => {
    // The BAE case: a floated corp left on uk_ltd should read as PLC.
    const s = getLegalStructureForCorp({
      countryId: "UK",
      isPrivate: false,
      legalStructure: "uk_ltd",
    });
    expect(s.id).toBe("uk_plc");
  });
  it("still honours a compatible explicit structure", () => {
    expect(
      getLegalStructureForCorp({ countryId: "UK", isPrivate: true, legalStructure: "uk_llp" }).id
    ).toBe("uk_llp");
    expect(
      getLegalStructureForCorp({ countryId: "UK", isPrivate: false, legalStructure: "uk_plc" }).id
    ).toBe("uk_plc");
  });
  it("throws for unknown legalStructureId", () => {
    expect(() =>
      getLegalStructureForCorp({ countryId: "US", legalStructure: "us_fake" as never })
    ).toThrow("Unknown legal structure");
  });
});

describe("isListedOnlyStructure", () => {
  it("flags the listed default of split jurisdictions (PLC/AG/…)", () => {
    for (const id of ["uk_plc", "ie_plc", "ng_plc", "de_ag", "br_sa_aberta", "cn_gufen"] as const) {
      const s = LEGAL_STRUCTURES.find((x) => x.id === id)!;
      expect(isListedOnlyStructure(s)).toBe(true);
    }
  });
  it("does NOT flag US C-Corp / JP KK (public defaults with no private counterpart)", () => {
    expect(isListedOnlyStructure({ isDefault: true, countryId: "US" })).toBe(false);
    expect(isListedOnlyStructure({ isDefault: true, countryId: "JP" })).toBe(false);
  });
  it("does NOT flag non-default (elective) forms", () => {
    expect(isListedOnlyStructure({ isDefault: false, countryId: "UK" })).toBe(false);
  });
});
