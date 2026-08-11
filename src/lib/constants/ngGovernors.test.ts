import { describe, expect, it } from "vitest";
import { NG_GOVERNORS_2019, NG_GOVERNORS_1991, NG_GOVERNORS_1953 } from "./historicalSeats";
import { SLUG_TO_NAME } from "@/lib/npp/seedHistorical";

const ZONES = [
  "NORTH_WEST",
  "NORTH_EAST",
  "NORTH_CENTRAL",
  "SOUTH_WEST",
  "SOUTH_SOUTH",
  "SOUTH_EAST",
];

describe("NG governor historical rosters", () => {
  for (const [era, roster] of [
    ["2019", NG_GOVERNORS_2019],
    ["1991", NG_GOVERNORS_1991],
    ["1953", NG_GOVERNORS_1953],
  ] as const) {
    it(`${era}: one governor per geopolitical zone`, () => {
      expect(roster.length).toBe(6);
      expect(roster.map((s) => s.state).sort()).toEqual([...ZONES].sort());
      for (const seat of roster) {
        expect(seat.officeType).toBe("governor");
      }
    });

    it(`${era}: every party slug resolves via SLUG_TO_NAME`, () => {
      for (const seat of roster) {
        expect(SLUG_TO_NAME[seat.party], `slug ${seat.party}`).toBeTruthy();
      }
    });
  }

  it("1991 roster uses only the Third Republic parties (SDP/NRC)", () => {
    for (const seat of NG_GOVERNORS_1991) {
      expect(["ng_sdp", "ng_nrc"]).toContain(seat.party);
    }
  });

  it("1953 roster uses only the late-colonial triad (NCNC/AG/NPC)", () => {
    for (const seat of NG_GOVERNORS_1953) {
      expect(["ng_ncnc", "ng_ag", "ng_npc"]).toContain(seat.party);
    }
  });
});
