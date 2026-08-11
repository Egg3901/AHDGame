import { describe, it, expect } from "vitest";
import {
  SU_SUPREME_SOVIET_1953,
  SU_SUPREME_SOVIET_1979,
  BLOC_CHAMBERS_1953,
  BLOC_CHAMBERS_1979,
  getPresetSeats,
  type HistoricalSeat,
} from "@/lib/constants/historicalSeats";
import { COUNTRY_CONFIGS, COUNTRY_ORDER } from "@/lib/constants/countries";
import { RU_NATIONALITIES_SEATS } from "@/lib/constants/ruSeats";
import { states1953 } from "@/lib/seeds/reference/states1953";
import { ruRegions1953 } from "@/lib/seeds/ru/ruRegions1953";
import { ruRegions } from "@/lib/seeds/ru/ruRegions";
import { ddRegions1953 } from "@/lib/seeds/dd/ddRegions1953";
import { ddRegions } from "@/lib/seeds/dd/ddRegions";
import { huRegions1953 } from "@/lib/seeds/hu/huRegions1953";
import { huRegions } from "@/lib/seeds/hu/huRegions";
import { plRegions1953 } from "@/lib/seeds/pl/plRegions1953";
import { plRegions } from "@/lib/seeds/pl/plRegions";
import { roRegions1953 } from "@/lib/seeds/ro/roRegions1953";
import { roRegions } from "@/lib/seeds/ro/roRegions";
import { yuRegions1953 } from "@/lib/seeds/yu/yuRegions1953";
import { yuRegions } from "@/lib/seeds/yu/yuRegions";
import { bgRegions1953 } from "@/lib/seeds/bg/bgRegions1953";
import { bgRegions } from "@/lib/seeds/bg/bgRegions";
import { csRegions1953 } from "@/lib/seeds/cs/csRegions1953";
import { csRegions } from "@/lib/seeds/cs/csRegions";
import { cnRegions1953 } from "@/lib/seeds/cn/cnRegions1953";

/** Sum seatsHeld per state id, for one officeType only. */
function seatsByStateFor(rows: HistoricalSeat[], officeType: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.officeType !== officeType) continue;
    out.set(r.state, (out.get(r.state) ?? 0) + (r.seatsHeld ?? 0));
  }
  return out;
}

/** CPSU share of one officeType's seats. */
function cpsuShareFor(rows: HistoricalSeat[], officeType: string): number {
  const of = rows.filter((r) => r.officeType === officeType);
  const cpsu = of.filter((r) => r.party === "su_cpsu").reduce((a, r) => a + (r.seatsHeld ?? 0), 0);
  const total = of.reduce((a, r) => a + (r.seatsHeld ?? 0), 0);
  return cpsu / total;
}

/**
 * The Supreme Soviet seat map is the seated form of the RU region
 * apportionment. If the two drift, regions get delegations that do not match
 * their district count — or, for a region missing from the map entirely, no
 * delegation at all in the preset whose whole premise is that one-party
 * legislatures start seated.
 */
describe.each([
  // Totals are the RU share of the real convocations: the real chambers seated
  // 708 (1954) and 750 (1979), but Ukraine, Byelorussia and the Baltics are
  // separate countries now and took 182 / 191 seats with them.
  ["1953", SU_SUPREME_SOVIET_1953, ruRegions1953, 526],
  ["1979", SU_SUPREME_SOVIET_1979, ruRegions, 559],
] as const)(
  "Supreme Soviet %s seat map tracks the RU apportionment",
  (era, rows, regions, expectedTotal) => {
    it("uses only the two chamber officeTypes plus the seeded executive pair", () => {
      expect(new Set(rows.map((r) => r.officeType))).toEqual(
        new Set(["supremeSovietDeputy", "nationalitiesDeputy", "premier", "chairmanOfPresidium"])
      );
    });

    describe("Soviet of the Union rows", () => {
      const seated = seatsByStateFor(rows, "supremeSovietDeputy");

      it("covers every RU region and nothing else", () => {
        expect([...seated.keys()].sort()).toEqual(regions.map((r) => r._id).sort());
      });

      it("seats each region at exactly its houseDistricts", () => {
        for (const region of regions) {
          expect(seated.get(region._id), `${era} ${region._id}`).toBe(region.houseDistricts);
        }
      });

      it(`totals the ${expectedTotal}-seat RU share of the convocation`, () => {
        const total = [...seated.values()].reduce((a, n) => a + n, 0);
        expect(total).toBe(expectedTotal);
        expect(regions.reduce((a, r) => a + r.houseDistricts, 0)).toBe(expectedTotal);
      });

      it("keeps the CPSU near its historical ~75% of the single list", () => {
        const share = cpsuShareFor(rows, "supremeSovietDeputy");
        expect(share).toBeGreaterThan(0.73);
        expect(share).toBeLessThan(0.77);
      });
    });

    describe("Soviet of Nationalities rows (RU_NATIONALITIES_SEATS, D11)", () => {
      const seated = seatsByStateFor(rows, "nationalitiesDeputy");

      it("matches RU_NATIONALITIES_SEATS exactly", () => {
        expect(Object.fromEntries(seated)).toEqual(RU_NATIONALITIES_SEATS);
      });

      it("keeps the CPSU near its historical ~75% of the single list", () => {
        const share = cpsuShareFor(rows, "nationalitiesDeputy");
        expect(share).toBeGreaterThan(0.73);
        expect(share).toBeLessThan(0.77);
      });
    });
  }
);

/**
 * Byelorussia and the Baltics are RU regions BEL/BLT now, so BLR/BAL are latent
 * and seed no states. seedFromSeats does not skip seats whose state is unknown —
 * it falls back to "US" — so a dangling row silently mints phantom US
 * legislators rather than failing loudly.
 */
describe("no bloc chamber seats reference latent or renamed states", () => {
  it.each([
    ["1953", BLOC_CHAMBERS_1953],
    ["1979", BLOC_CHAMBERS_1979],
  ])("%s has no BY_BEL / BLR_BEL / BAL_BAL rows", (_era, rows) => {
    const stale = rows.filter((r) => /^(BY|BLR|BAL)_/.test(r.state)).map((r) => r.state);
    expect(stale).toEqual([]);
  });

  it.each([
    ["1953", BLOC_CHAMBERS_1953],
    ["1979", BLOC_CHAMBERS_1979],
  ])("%s still seats the genuine satellite states", (_era, rows) => {
    const prefixes = new Set(rows.map((r) => r.state.split("_")[0]));
    for (const id of ["HU", "PL", "RO", "YU", "BG", "CS"]) {
      expect(prefixes, `missing ${id}`).toContain(id);
    }
  });
});

/**
 * The regression guard for the "US fallback" hazard: every state a preset seats
 * must resolve to a live country, or seedFromSeats will silently attribute those
 * legislators to the United States.
 */
describe.each([
  [
    "1953-default",
    [
      states1953, // US states — the 1953 preset now seats the Solid-South legislature
      ruRegions1953,
      ddRegions1953,
      cnRegions1953, // PRC macro-regions — the 1953 preset seats the First NPC
      huRegions1953,
      plRegions1953,
      roRegions1953,
      yuRegions1953,
      bgRegions1953,
      csRegions1953,
    ],
  ],
  [
    "1979-default",
    [ruRegions, ddRegions, huRegions, plRegions, roRegions, yuRegions, bgRegions, csRegions],
  ],
] as const)("%s seats resolve to live states", (preset, regionSets) => {
  it("never references a state that no preset seed creates", () => {
    // The valid set comes from the era's own seeds, not a prefix rule (region
    // rosters can differ per era even when — as with DD's six Länder — they
    // currently coincide).
    const seeded = new Set(regionSets.flatMap((set) => set.map((r) => r._id)));
    const live = new Set<string>(COUNTRY_ORDER);
    const orphans = getPresetSeats(preset)
      .map((s) => s.state)
      .filter((state) => {
        // National offices (president/PM) pass the bare country code as `state`.
        if (state in COUNTRY_CONFIGS) return !live.has(state);
        return !seeded.has(state);
      });
    expect([...new Set(orphans)]).toEqual([]);
  });
});
