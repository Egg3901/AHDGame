import { describe, it, expect } from "vitest";
import { jpRegions1991 } from "@/lib/countries/jp/data/jpRegions1991";
import { getCountryConfig } from "@/lib/constants/countries";
import { seatsForCountry } from "@/lib/constants/presetSeatGroups";
import { getReadinessExpectations } from "@/lib/constants/readinessExpectations";
import {
  JP_SHUGIIN_SEATS_1991,
  TOTAL_JP_SHUGIIN_SEATS_1991,
  JP_SANGIIN_SEATS_1991,
  TOTAL_JP_SANGIIN_SEATS_1991,
  getJpShugiinSeats,
  getJpSangiinSeats,
  getJpSangiinClassSeats,
  getTotalJpShugiinSeats,
  getTotalJpSangiinSeats,
} from "./jpSeats";

/**
 * The 1991 Diet, given the era seat maps Japan never had.
 *
 * Japan's chamber tables carried no era variant and no selector at all, so a
 * 1991 world declared a 512/252 Diet, seated 512/206, and then spawned and
 * allocated its elections against the modern 465/248. The Sangiin's 46-seat
 * hole was invisible to the admin diagnostic too, because `seatMin` was pinned
 * to the 2019 chamber: 512 + 206 = 718 clears a threshold of 713 and reports
 * healthy.
 */
describe("JP Diet, 1991-default", () => {
  const regionIds = jpRegions1991.map((r) => r._id);

  const seatedBy = (officeType: string, key: "state" | "party" | "chamberClass") => {
    const out: Record<string, number> = {};
    for (const seat of seatsForCountry("1991-default", "JP")) {
      if (seat.officeType !== officeType) continue;
      const k = String(seat[key as keyof typeof seat] ?? "");
      out[k] = (out[k] ?? 0) + (seat.seatsHeld ?? 1);
    }
    return out;
  };

  it("apportions 512 Shugiin seats across the eight regions", () => {
    const sum = Object.values(JP_SHUGIIN_SEATS_1991).reduce((a, b) => a + b, 0);
    expect(sum).toBe(TOTAL_JP_SHUGIIN_SEATS_1991);
    expect(sum).toBe(512);
  });

  it("apportions 252 Sangiin seats across the eight regions", () => {
    const sum = Object.values(JP_SANGIIN_SEATS_1991).reduce((a, b) => a + b, 0);
    expect(sum).toBe(TOTAL_JP_SANGIIN_SEATS_1991);
    expect(sum).toBe(252);
  });

  it("mirrors jpRegions1991.houseDistricts region by region", () => {
    for (const region of jpRegions1991) {
      expect(JP_SHUGIIN_SEATS_1991[region._id], region._id).toBe(region.houseDistricts);
    }
    expect(new Set(Object.keys(JP_SHUGIIN_SEATS_1991))).toEqual(new Set(regionIds));
    expect(new Set(Object.keys(JP_SANGIIN_SEATS_1991))).toEqual(new Set(regionIds));
  });

  it("is what the selectors return for the 1991 preset", () => {
    expect(getJpShugiinSeats("1991-default")).toBe(JP_SHUGIIN_SEATS_1991);
    expect(getJpSangiinSeats("1991-default")).toBe(JP_SANGIIN_SEATS_1991);
    expect(getTotalJpShugiinSeats("1991-default")).toBe(512);
    expect(getTotalJpSangiinSeats("1991-default")).toBe(252);
  });

  it("leaves the modern presets on the modern maps", () => {
    expect(getTotalJpShugiinSeats("2019-default")).toBe(465);
    expect(getTotalJpSangiinSeats("2019-default")).toBe(248);
    expect(getTotalJpShugiinSeats(undefined)).toBe(465);
  });

  it("splits odd modern Sangiin totals without creating phantom seats", () => {
    expect(getJpSangiinClassSeats("2019-default", "HOK", 1)).toBe(4);
    expect(getJpSangiinClassSeats("2019-default", "HOK", 2)).toBe(3);
    expect(getJpSangiinClassSeats("2019-default", "KYU", 1)).toBe(16);
    expect(getJpSangiinClassSeats("2019-default", "KYU", 2)).toBe(15);

    const splitTotal = Object.keys(getJpSangiinSeats("2019-default")).reduce(
      (total, regionId) =>
        total +
        getJpSangiinClassSeats("2019-default", regionId, 1) +
        getJpSangiinClassSeats("2019-default", regionId, 2),
      0
    );
    expect(splitTotal).toBe(248);
  });

  it("matches the chamber sizes the 1991 era override declares", () => {
    const legislature = getCountryConfig("JP", "1991-default").legislature;
    expect(legislature.lowerChamber.seats).toBe(TOTAL_JP_SHUGIIN_SEATS_1991);
    expect(legislature.upperChamber?.seats).toBe(TOTAL_JP_SANGIIN_SEATS_1991);
  });

  it("seats every region's Shugiin roster to exactly its district count", () => {
    const seated = seatedBy("shugiin", "state");
    for (const region of jpRegions1991) {
      expect(seated[region._id] ?? 0, region._id).toBe(region.houseDistricts);
    }
  });

  it("fills the Sangiin instead of leaving 46 seats undeclared", () => {
    const seated = seatedBy("sangiin", "state");
    for (const region of jpRegions1991) {
      expect(seated[region._id] ?? 0, region._id).toBe(JP_SANGIIN_SEATS_1991[region._id]);
    }
    const total = Object.values(seated).reduce((a, b) => a + b, 0);
    expect(total).toBe(252);
  });

  it("splits the Sangiin evenly across its two staggered classes", () => {
    const byClass = seatedBy("sangiin", "chamberClass");
    expect(byClass["1"]).toBe(126);
    expect(byClass["2"]).toBe(126);
  });

  it("seats the February 1990 Shugiin", () => {
    const byParty = seatedBy("shugiin", "party");
    expect(byParty.jp_ldp).toBe(275);
    expect(byParty.jp_jsp).toBe(136);
    expect(byParty.jp_komeito).toBe(45);
    expect(byParty.jp_independent).toBe(26);
    expect(byParty.jp_jcp).toBe(16);
    expect(byParty.jp_dsp).toBe(14);
  });

  it("seats the Sangiin the July 1989 upset produced", () => {
    // LDP 109 of 252 — below the 127 it needed for a majority, the first time
    // it had lost control of either chamber.
    const byParty = seatedBy("sangiin", "party");
    expect(byParty.jp_ldp).toBe(109);
    expect(byParty.jp_ldp).toBeLessThan(127);
    expect(byParty.jp_jsp).toBe(66);
    expect(byParty.jp_komeito).toBe(21);
    expect(byParty.jp_jcp).toBe(14);
    expect(byParty.jp_dsp).toBe(10);
    expect(byParty.jp_independent).toBe(32);
  });

  it("holds the readiness diagnostic to the 1991 chamber, not the 2019 one", () => {
    const expectations = getReadinessExpectations("JP", "1991-default");
    expect(expectations?.seatMin).toBe(764);

    const modern = getReadinessExpectations("JP", "2019-default");
    expect(modern?.seatMin).toBe(713);
  });
});
