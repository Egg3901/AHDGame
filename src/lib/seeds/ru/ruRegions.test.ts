import { describe, it, expect } from "vitest";
import { ruRegions1953 } from "./ruRegions1953";
import { ruRegions } from "./ruRegions";

/**
 * RU keeps the ten RSFSR macro-regions plus the four union republics that did
 * NOT become playable countries: Kazakhstan, Transcaucasia, Central Asia and
 * Moldova. Ukraine, Byelorussia and the Baltics used to be RU regions
 * (UKR/BEL/BLT) and are now their own Eastern Bloc countries, so this file must
 * NOT contain them; their absence is the invariant being guarded.
 *
 * Seat totals are RU's share of the real Soviet of the Union: 526 of the 708
 * deputies of the 1954 convocation, 559 of the 750 in 1979. The balance
 * (182 / 191) belongs to the three departed republics' own chambers.
 */
const ERAS = [
  { name: "1953", regions: ruRegions1953, seats: 526 },
  { name: "1979", regions: ruRegions, seats: 559 },
] as const;

describe.each(ERAS)("ruRegions $name", ({ regions, seats }) => {
  it("has 14 regions, all owned by RU", () => {
    expect(regions).toHaveLength(14);
    for (const r of regions) expect(r.countryId).toBe("RU");
  });

  it("excludes the republics that became their own countries", () => {
    // UKR/BEL/BLT are now the countries UKR/BLR/BAL with their own region
    // shards and chambers. A stray row here would double-seat their population.
    const ids = regions.map((r) => r._id);
    expect(ids).not.toContain("UKR");
    expect(ids).not.toContain("BEL");
    expect(ids).not.toContain("BLT");
  });

  it("seats the Soviet of the Union at its real size", () => {
    expect(regions.reduce((a, r) => a + r.houseDistricts, 0)).toBe(seats);
  });

  it("keeps every region within a sane per-capita GDP band", () => {
    const pop = regions.reduce((a, r) => a + r.population, 0);
    const gdp = regions.reduce((a, r) => a + r.gdp, 0);
    const avg = (gdp * 1e6) / pop;
    for (const r of regions) {
      const index = ((r.gdp * 1e6) / r.population / avg) * 100;
      expect(index, `${r._id} index ${index.toFixed(0)}`).toBeGreaterThan(40);
      expect(index, `${r._id} index ${index.toFixed(0)}`).toBeLessThan(200);
    }
  });
});

describe("regional Supreme Soviet seats", () => {
  it("is era-invariant across 1953 and 1979", () => {
    for (const r of ruRegions) {
      const same = ruRegions1953.find((x) => x._id === r._id);
      expect(same, `1953 missing ${r._id}`).toBeDefined();
      expect(r.stateSenateSeats, `${r._id} differs by era`).toBe(same!.stateSenateSeats);
    }
  });
});
