import { describe, expect, it } from "vitest";
import type { State } from "@/lib/db/types";
import { inferStateSectorSpecialization } from "@/lib/admin/seed/seedStateSectorSpecializations";
import { ukRegions } from "@/lib/seeds/uk/ukRegions";
import { deRegions } from "@/lib/seeds/de/deRegions";
import { jpRegions } from "@/lib/seeds/jp/jpRegions";
import { cnRegions } from "@/lib/seeds/cn/cnRegions";
import { ieRegions } from "@/lib/seeds/ie/ieRegions";
import { brRegions } from "@/lib/seeds/br/brRegions";

const auditedRegions = [
  ...ukRegions,
  ...deRegions,
  ...jpRegions,
  ...cnRegions,
  ...ieRegions,
  ...brRegions,
];

function findRegion(regions: State[], stateId: string): State {
  const region = regions.find((candidate) => candidate._id === stateId);
  if (!region) throw new Error(`Missing region fixture: ${stateId}`);
  return region;
}

describe("seedStateSectorSpecializations", () => {
  it("uses explicit regional specializations outside the US", () => {
    expect(inferStateSectorSpecialization(findRegion(cnRegions, "XB"))).toEqual({
      primary: "energy",
      secondary: "extraction",
    });
    expect(inferStateSectorSpecialization(findRegion(ieRegions, "DUB"))).toEqual({
      primary: "technology",
      secondary: "telecommunications",
    });
    expect(inferStateSectorSpecialization(findRegion(brRegions, "SUDESTE"))).toEqual({
      primary: "financial",
      secondary: "manufacturing",
    });
  });

  it("keeps audited countries from collapsing into one default primary sector", () => {
    const primaryByCountry = new Map<string, Set<string>>();

    for (const region of auditedRegions) {
      const primary = inferStateSectorSpecialization(region).primary;
      const set = primaryByCountry.get(region.countryId) ?? new Set<string>();
      set.add(primary);
      primaryByCountry.set(region.countryId, set);
    }

    for (const [countryId, primaries] of primaryByCountry) {
      expect(primaries.size, countryId).toBeGreaterThanOrEqual(3);
    }
  });
});
