/**
 * Tests for China historical seat data and NPP seeding integration.
 */
import { describe, it, expect } from "vitest";
import {
  CN_NPC_2020,
  CN_NPC_1991,
  CN_NPC_1953,
  CN_PEOPLES_CONGRESS_2020,
  CN_GOVERNORS_2020,
  CN_CCP_NPPS_PER_REGION,
  splitCNNPCDelegates,
  getPresetSeats,
  getHistoricalSeats,
} from "@/lib/constants/historicalSeats";
import { getCountryConfig } from "@/lib/constants/countries";
import { cnRegions1953 } from "@/lib/seeds/cn/cnRegions1953";
import { INDEPENDENT_SLUGS, SLUG_TO_NAME } from "@/lib/npp/seedHistorical";

describe("CN Historical Seats", () => {
  it("CN_NPC_2020 has seats for all 7 regions", () => {
    const regions = new Set(CN_NPC_2020.map((s) => s.state));
    expect(regions.size).toBe(7);
    expect(regions.has("DB")).toBe(true);
    expect(regions.has("HB")).toBe(true);
    expect(regions.has("HD")).toBe(true);
    expect(regions.has("HZ")).toBe(true);
    expect(regions.has("HN")).toBe(true);
    expect(regions.has("XN")).toBe(true);
    expect(regions.has("XB")).toBe(true);
  });

  it("CPC dominates NPC seats", () => {
    const ccpSeats = CN_NPC_2020.filter((s) => s.party === "cn_ccp").reduce(
      (sum, s) => sum + (s.seatsHeld ?? 0),
      0
    );
    const totalSeats = CN_NPC_2020.reduce((sum, s) => sum + (s.seatsHeld ?? 0), 0);
    expect(ccpSeats / totalSeats).toBeGreaterThan(0.9);
  });

  it("NPC seat totals match 2980", () => {
    const total = CN_NPC_2020.reduce((sum, s) => sum + (s.seatsHeld ?? 0), 0);
    expect(total).toBe(2980);
  });

  it("all 7 regions have a CPC governor", () => {
    expect(CN_GOVERNORS_2020.length).toBe(7);
    for (const gov of CN_GOVERNORS_2020) {
      expect(gov.party).toBe("cn_ccp");
      expect(gov.officeType).toBe("governor");
    }
  });

  it("getPresetSeats 2020-default includes CN", () => {
    const seats = getPresetSeats("2020-default");
    const cnSeats = seats.filter((s) =>
      ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"].includes(s.state)
    );
    expect(cnSeats.length).toBeGreaterThan(0);
    expect(cnSeats.some((s) => s.officeType === "npcDelegate")).toBe(true);
  });

  it("getHistoricalSeats returns CN data with the CCP split applied to NPC + provincial", () => {
    const seats = getHistoricalSeats("CN");
    // After the splitter, each CCP delegate row in BOTH the NPC and the
    // Provincial People's Congress tables expands into 7 NPPs per region.
    // CDL / CNDCA rows pass through 1:1. Governors are untouched.
    function rowsAfterSplit(rows: typeof CN_NPC_2020): number {
      const ccpRows = rows.filter((s) => s.party === "cn_ccp").length;
      const minorRows = rows.length - ccpRows;
      return ccpRows * CN_CCP_NPPS_PER_REGION + minorRows;
    }
    const expected =
      rowsAfterSplit(CN_NPC_2020) +
      rowsAfterSplit(CN_PEOPLES_CONGRESS_2020) +
      CN_GOVERNORS_2020.length;
    expect(seats.length).toBe(expected);
    expect(seats.some((s) => s.officeType === "npcDelegate")).toBe(true);
    expect(seats.some((s) => s.officeType === "peoplesCongress")).toBe(true);
    expect(seats.some((s) => s.officeType === "governor")).toBe(true);
  });
});

describe("CN 1953 NPC (First NPC convocation)", () => {
  const REGION_IDS = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"] as const;

  it("covers all 7 macro-regions on the npcDelegate office type", () => {
    expect(new Set(CN_NPC_1953.map((s) => s.state))).toEqual(new Set(REGION_IDS));
    expect(CN_NPC_1953.every((s) => s.officeType === "npcDelegate")).toBe(true);
  });

  it("matches each region's authored 1953 houseDistricts exactly", () => {
    for (const region of cnRegions1953) {
      const seated = CN_NPC_1953.filter((s) => s.state === region._id).reduce(
        (sum, s) => sum + (s.seatsHeld ?? 0),
        0
      );
      expect(seated, `${region._id} delegation`).toBe(region.houseDistricts);
    }
  });

  it("totals the 1,226 deputies the 1953 legislature config declares", () => {
    const total = CN_NPC_1953.reduce((sum, s) => sum + (s.seatsHeld ?? 0), 0);
    expect(total).toBe(1226);
    expect(getCountryConfig("CN", "1953-default")?.legislature?.lowerChamber?.seats).toBe(1226);
  });

  it("models the broad 1949-54 united front, not the later CCP supermajority", () => {
    const total = CN_NPC_1953.reduce((sum, s) => sum + (s.seatsHeld ?? 0), 0);
    const share = (party: string) =>
      CN_NPC_1953.filter((s) => s.party === party).reduce((sum, s) => sum + (s.seatsHeld ?? 0), 0) /
      total;
    // 1979 and 2020 both sit above 0.94 CCP; 1953 must be materially lower.
    expect(share("cn_ccp")).toBeGreaterThan(0.5);
    expect(share("cn_ccp")).toBeLessThan(0.6);
    // Democratic parties + non-party democrats hold the rest.
    expect(share("cn_cdl")).toBeGreaterThan(0);
    expect(share("cn_cndca")).toBeGreaterThan(0);
    expect(share("cn_independent")).toBeGreaterThan(0.3);
  });

  it("uses only party slugs the NPP seeder can resolve", () => {
    for (const seat of CN_NPC_1953) {
      const resolvable = seat.party in SLUG_TO_NAME || INDEPENDENT_SLUGS.has(seat.party);
      expect(resolvable, `unresolvable slug ${seat.party}`).toBe(true);
    }
  });

  it("is wired into the 1953 preset with the CCP caucus split applied", () => {
    const seats = getPresetSeats("1953-default");
    const npc = seats.filter((s) => s.officeType === "npcDelegate");
    expect(npc.length).toBeGreaterThan(0);
    // Seat totals survive the splitter untouched.
    expect(npc.reduce((sum, s) => sum + (s.seatsHeld ?? 0), 0)).toBe(1226);
    // Every region fields CN_CCP_NPPS_PER_REGION separate CCP caucus members.
    for (const region of REGION_IDS) {
      const ccpRows = npc.filter((s) => s.state === region && s.party === "cn_ccp");
      expect(ccpRows.length, `${region} CCP rows`).toBe(CN_CCP_NPPS_PER_REGION);
    }
  });

  it("seats the national chamber only — no provincial congress in 1953", () => {
    // The 1st provincial People's Congresses convened in 1954, and no other
    // 1953 one-party state (GDR, Warsaw Pact) seats a sub-national chamber.
    const seats = getPresetSeats("1953-default");
    expect(seats.some((s) => s.officeType === "peoplesCongress")).toBe(false);
  });
});

describe("splitCNNPCDelegates", () => {
  it("preserves total CCP seats per region for the 2020 dataset", () => {
    const before = new Map<string, number>();
    for (const r of CN_NPC_2020) {
      if (r.party !== "cn_ccp" || r.officeType !== "npcDelegate") continue;
      before.set(r.state, (before.get(r.state) ?? 0) + (r.seatsHeld ?? 0));
    }
    const after = new Map<string, number>();
    for (const r of splitCNNPCDelegates(CN_NPC_2020)) {
      if (r.party !== "cn_ccp" || r.officeType !== "npcDelegate") continue;
      after.set(r.state, (after.get(r.state) ?? 0) + (r.seatsHeld ?? 0));
    }
    expect(after).toEqual(before);
  });

  it("preserves total CCP seats per region for the 1991 dataset", () => {
    const before = new Map<string, number>();
    for (const r of CN_NPC_1991) {
      if (r.party !== "cn_ccp" || r.officeType !== "npcDelegate") continue;
      before.set(r.state, (before.get(r.state) ?? 0) + (r.seatsHeld ?? 0));
    }
    const after = new Map<string, number>();
    for (const r of splitCNNPCDelegates(CN_NPC_1991)) {
      if (r.party !== "cn_ccp" || r.officeType !== "npcDelegate") continue;
      after.set(r.state, (after.get(r.state) ?? 0) + (r.seatsHeld ?? 0));
    }
    expect(after).toEqual(before);
  });

  it("produces 7 CCP NPPs per region", () => {
    const out = splitCNNPCDelegates(CN_NPC_2020);
    const ccpByRegion = new Map<string, number>();
    for (const r of out) {
      if (r.party !== "cn_ccp" || r.officeType !== "npcDelegate") continue;
      ccpByRegion.set(r.state, (ccpByRegion.get(r.state) ?? 0) + 1);
    }
    expect(ccpByRegion.size).toBe(7);
    for (const count of ccpByRegion.values()) {
      expect(count).toBe(CN_CCP_NPPS_PER_REGION);
    }
  });

  it("passes CDL / CNDCA rows through unchanged (1 NPP per region per minor party)", () => {
    const out = splitCNNPCDelegates(CN_NPC_2020);
    const cdl = out.filter((r) => r.party === "cn_cdl" && r.officeType === "npcDelegate");
    const cndca = out.filter((r) => r.party === "cn_cndca" && r.officeType === "npcDelegate");
    expect(cdl.length).toBe(7);
    expect(cndca.length).toBe(7);
  });
});
