import { describe, expect, it } from "vitest";
import {
  NG_REGION_VOTE_SHARES_1953,
  NG_REGION_VOTE_SHARES_1991,
  NG_REGION_VOTE_SHARES_2019,
} from "./ngRegionVoteShares";

const ZONES = [
  "NORTH_WEST",
  "NORTH_EAST",
  "NORTH_CENTRAL",
  "SOUTH_WEST",
  "SOUTH_SOUTH",
  "SOUTH_EAST",
];

describe("ngRegionVoteShares", () => {
  it("all authored eras cover all 6 geopolitical zones", () => {
    for (const z of ZONES) {
      expect(NG_REGION_VOTE_SHARES_1953[z], `1953 ${z}`).toBeTruthy();
      expect(NG_REGION_VOTE_SHARES_1991[z], `1991 ${z}`).toBeTruthy();
      expect(NG_REGION_VOTE_SHARES_2019[z], `2019 ${z}`).toBeTruthy();
    }
  });

  it("1953 is the late-colonial triad (NCNC/AG/NPC)", () => {
    for (const z of ZONES) {
      expect(Object.keys(NG_REGION_VOTE_SHARES_1953[z]).sort()).toEqual(["ag", "ncnc", "npc"]);
    }
  });

  it("1991 is the SDP/NRC two-party table", () => {
    for (const z of ZONES) {
      expect(Object.keys(NG_REGION_VOTE_SHARES_1991[z]).sort()).toEqual(["nrc", "sdp"]);
    }
  });

  it("2019 is the modern roster (APC/PDP/LP/NNPP/APGA), no SDP/NRC/1953 triad", () => {
    for (const z of ZONES) {
      const parties = Object.keys(NG_REGION_VOTE_SHARES_2019[z]);
      expect(parties).toContain("apc");
      expect(parties).toContain("pdp");
      expect(parties).not.toContain("sdp");
      expect(parties).not.toContain("nrc");
      expect(parties).not.toContain("ncnc");
      expect(parties).not.toContain("ag");
      expect(parties).not.toContain("npc");
    }
  });

  it("each zone's shares sum to ~100", () => {
    for (const table of [
      NG_REGION_VOTE_SHARES_1953,
      NG_REGION_VOTE_SHARES_1991,
      NG_REGION_VOTE_SHARES_2019,
    ]) {
      for (const z of ZONES) {
        const sum = Object.values(table[z]).reduce((s, v) => s + v, 0);
        expect(sum, `${z} sum`).toBeGreaterThanOrEqual(95);
        expect(sum, `${z} sum`).toBeLessThanOrEqual(105);
      }
    }
  });
});
