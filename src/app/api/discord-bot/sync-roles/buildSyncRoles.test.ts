import { describe, it, expect } from "vitest";
import { buildSyncRoleTokens, officeLabel } from "./buildSyncRoles";

const base = {
  partyName: "Independent",
  isHeadOfGovernment: false,
  isCentralBankChair: false,
  isCeo: false,
  isInvestor: false,
  investorRank: null as number | null,
};

describe("buildSyncRoleTokens", () => {
  it("emits headOfGov for the US president and omits office:President", () => {
    const r = buildSyncRoleTokens({
      ...base,
      countryId: "US",
      officeTypes: ["president"],
      isHeadOfGovernment: true,
    });
    expect(r.roles).toContain("headOfGov");
    expect(r.roles).not.toContain("office:President");
    expect(r.isHeadOfGovernment).toBe(true);
  });

  it("emits headOfGov for a parliamentary PM with no electedOfficials row", () => {
    const r = buildSyncRoleTokens({
      ...base,
      countryId: "UK",
      officeTypes: [],
      isHeadOfGovernment: true,
    });
    expect(r.roles).toContain("headOfGov");
    expect(r.roles.filter((t) => t.startsWith("office:"))).toEqual([]);
  });

  it("stacks the seat role for a PM who is also an MP (HoG + seat)", () => {
    const r = buildSyncRoleTokens({
      ...base,
      countryId: "UK",
      officeTypes: ["commons"],
      isHeadOfGovernment: true,
    });
    expect(r.roles).toContain("office:Member of Parliament");
    expect(r.roles).toContain("headOfGov");
  });

  it("does not treat the CN ceremonial president as head of government", () => {
    const r = buildSyncRoleTokens({
      ...base,
      countryId: "CN",
      officeTypes: ["president"],
      isHeadOfGovernment: false,
    });
    expect(r.roles).not.toContain("headOfGov");
    expect(r.roles).toContain("office:President");
  });

  it("keeps office:Senator for a non-executive office", () => {
    const r = buildSyncRoleTokens({
      ...base,
      countryId: "US",
      officeTypes: ["senate"],
    });
    expect(r.roles).toContain("office:Senator");
    expect(r.roles).not.toContain("headOfGov");
    expect(r.isHeadOfGovernment).toBe(false);
  });

  it("emits the centralBankChair token, stacked on top of an office", () => {
    const r = buildSyncRoleTokens({
      ...base,
      countryId: "US",
      officeTypes: ["senate"],
      isCentralBankChair: true,
    });
    expect(r.roles).toContain("office:Senator");
    expect(r.roles).toContain("centralBankChair");
  });

  it("always emits party and country tokens", () => {
    const r = buildSyncRoleTokens({ ...base, countryId: "JP", officeTypes: [] });
    expect(r.roles).toContain("party:Independent");
    expect(r.roles).toContain("country:JP");
  });

  it("emits headOfGov for the RU Premier and omits office:Premier", () => {
    const r = buildSyncRoleTokens({
      ...base,
      countryId: "RU",
      officeTypes: ["premier"],
      isHeadOfGovernment: true,
    });
    expect(r.roles).toContain("headOfGov");
    expect(r.roles).not.toContain("office:Premier");
    expect(r.roles).toContain("country:RU");
  });

  it("emits headOfGov for the DD General Secretary and omits office:General Secretary", () => {
    const r = buildSyncRoleTokens({
      ...base,
      countryId: "DD",
      officeTypes: ["generalSecretary"],
      isHeadOfGovernment: true,
    });
    expect(r.roles).toContain("headOfGov");
    expect(r.roles).not.toContain("office:General Secretary");
    expect(r.roles).toContain("country:DD");
  });

  it("stacks a Supreme Soviet seat under the RU head of government", () => {
    const r = buildSyncRoleTokens({
      ...base,
      countryId: "RU",
      officeTypes: ["premier", "supremeSovietDeputy"],
      isHeadOfGovernment: true,
    });
    expect(r.roles).toContain("headOfGov");
    expect(r.roles).toContain("office:Supreme Soviet Deputy");
  });

  it("does not treat the RU Chairman of the Presidium as head of government", () => {
    const r = buildSyncRoleTokens({
      ...base,
      countryId: "RU",
      officeTypes: ["chairmanOfPresidium"],
      isHeadOfGovernment: false,
    });
    expect(r.roles).not.toContain("headOfGov");
    expect(r.roles).toContain("office:Chairman of the Presidium");
  });
});

describe("officeLabel", () => {
  it("resolves names from the country config", () => {
    expect(officeLabel("US", "senate")).toBe("Senator");
    expect(officeLabel("US", "stateSenate")).toBe("State Senator");
    expect(officeLabel("UK", "commons")).toBe("Member of Parliament");
    expect(officeLabel("UK", "governor")).toBe("First Minister");
  });

  it("falls back to the raw key for an unknown office type", () => {
    expect(officeLabel("US", "totallyMadeUp")).toBe("totallyMadeUp");
  });
});
