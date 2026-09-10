import { describe, it, expect } from "vitest";
import {
  getCnRegionOrg,
  getCnPartyTreasury,
  CN_REGION_ORG_2019,
  CN_REGION_ORG_2027,
  CN_PARTY_TREASURY_2019,
  CN_PARTY_TREASURY_2027,
} from "./cnStatePartyOrgCalculations";

const REGION_IDS = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];

describe("cnStatePartyOrgCalculations 2027 dispatch", () => {
  it("dispatches 2027-default explicitly, not via the modern fallthrough", () => {
    expect(getCnRegionOrg("2027-default")).toBe(CN_REGION_ORG_2027);
    expect(getCnPartyTreasury("2027-default")).toBe(CN_PARTY_TREASURY_2027);
  });

  it("2027 org matches the modern distribution in every region", () => {
    expect(getCnRegionOrg("2027-default")).toEqual(CN_REGION_ORG_2019);
    for (const id of REGION_IDS) {
      expect(getCnRegionOrg("2027-default")[id]).toBeDefined();
    }
  });

  it("2027 treasury matches the modern treasury", () => {
    expect(getCnPartyTreasury("2027-default")).toEqual(CN_PARTY_TREASURY_2019);
  });

  it("CCP dominates every 2027 region with minor parties present", () => {
    const org = getCnRegionOrg("2027-default");
    for (const id of REGION_IDS) {
      expect(org[id].ccp).toBeGreaterThan(90);
      expect(org[id].cdl).toBeGreaterThanOrEqual(1);
      expect(org[id].cndca).toBeGreaterThanOrEqual(1);
    }
  });
});
