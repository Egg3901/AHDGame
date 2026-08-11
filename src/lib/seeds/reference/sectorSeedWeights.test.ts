import { describe, expect, it } from "vitest";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  getStateSectorWeights,
  STATE_SECTOR_WEIGHT_OVERRIDES,
} from "@/lib/seeds/reference/sectorSeedWeights";
import { states } from "@/lib/seeds/reference/states";
import { ukRegions } from "@/lib/seeds/uk/ukRegions";
import { deRegions } from "@/lib/seeds/de/deRegions";
import { jpRegions } from "@/lib/seeds/jp/jpRegions";
import { cnRegions } from "@/lib/seeds/cn/cnRegions";
import { ieRegions } from "@/lib/seeds/ie/ieRegions";
import { brRegions } from "@/lib/seeds/br/brRegions";

const auditedRegions: Array<{ countryId: CountryId; stateId: string }> = [
  ...states.map((state) => ({ countryId: "US" as const, stateId: state._id })),
  ...ukRegions.map((state) => ({ countryId: "UK" as const, stateId: state._id })),
  ...deRegions.map((state) => ({ countryId: "DE" as const, stateId: state._id })),
  ...jpRegions.map((state) => ({ countryId: "JP" as const, stateId: state._id })),
  ...cnRegions.map((state) => ({ countryId: "CN" as const, stateId: state._id })),
  ...ieRegions.map((state) => ({ countryId: "IE" as const, stateId: state._id })),
  ...brRegions.map((state) => ({ countryId: "BR" as const, stateId: state._id })),
];

function topSector(countryId: CountryId, stateId: string): CorporationType {
  const weights = getStateSectorWeights(stateId, countryId, "2019-default");
  return Object.entries(weights).sort((a, b) => b[1] - a[1])[0][0] as CorporationType;
}

describe("sector seed weights", () => {
  it("defines region-specific profiles for every audited playable region", () => {
    for (const { countryId, stateId } of auditedRegions) {
      // Lookup mirrors getStateSectorWeights: try the countryId-prefixed
      // key first (CN macro-regions collide with DE Bundesländer on HB),
      // fall back to the bare key.
      const entry =
        STATE_SECTOR_WEIGHT_OVERRIDES[`${countryId}:${stateId}`] ??
        STATE_SECTOR_WEIGHT_OVERRIDES[stateId];
      expect(entry, `${countryId}:${stateId}`).toBeDefined();
    }
  });

  it("normalises every audited regional profile", () => {
    for (const { countryId, stateId } of auditedRegions) {
      const total = Object.values(getStateSectorWeights(stateId, countryId, "2019-default")).reduce(
        (sum, weight) => sum + weight,
        0
      );
      expect(total).toBeCloseTo(1, 10);
    }
  });

  it("preserves the intended top-sector variation in representative regions", () => {
    expect(topSector("US", "CA")).toBe("technology");
    expect(topSector("US", "WY")).toBe("energy");
    expect(topSector("UK", "NWE")).toBe("media");
    expect(topSector("DE", "HH")).toBe("logistics");
    expect(topSector("JP", "CHU")).toBe("automobiles");
    expect(topSector("CN", "XB")).toBe("energy");
    expect(topSector("IE", "COR")).toBe("chemical_industries");
    expect(topSector("BR", "NORTE")).toBe("extraction");
    expect(topSector("BR", "CENTRO_OESTE")).toBe("agriculture");
  });
});

describe("sector seed weights (1953 preset)", () => {
  const P = "1953-default";
  const top1953 = (countryId: CountryId, stateId: string): CorporationType =>
    Object.entries(getStateSectorWeights(stateId, countryId, P)).sort(
      (a, b) => b[1] - a[1]
    )[0][0] as CorporationType;

  it("bends the 1953 baseline into era-correct state specialties (no anachronistic tech)", () => {
    expect(top1953("US", "MI")).toBe("automobiles");
    expect(top1953("US", "PA")).toBe("manufacturing");
    expect(top1953("US", "TX")).toBe("extraction");
    expect(top1953("US", "ND")).toBe("agriculture");
    // California in 1953 is farms, film and aerospace, never technology.
    const ca = getStateSectorWeights("CA", "US", P);
    expect(ca.technology ?? 0).toBe(0);
    expect(top1953("US", "CA")).not.toBe("technology");
  });

  it("fixes the USSR RU->SU alias so Soviet regions are not an even split", () => {
    expect(top1953("RU", "URA")).toBe("manufacturing"); // Urals heavy industry
    expect(top1953("RU", "TRA")).toBe("extraction"); // Baku oil
    expect(top1953("RU", "CBE")).toBe("agriculture"); // Black Earth grain
    expect(top1953("RU", "URA")).not.toBe(top1953("RU", "CBE"));
  });

  it("applies 1953 overrides to UK and DDR regions (real seeded district ids)", () => {
    expect(top1953("UK", "LON")).toBe("financial");
    // DDR seeds the six eastern Länder (BEO/MV/BB/ST/SN/TH). The
    // command-economy manufacturing baseline stays on top everywhere, so we
    // assert each Land's distinctive lean instead of an absolute winner.
    const st = getStateSectorWeights("ST", "DD", P);
    const mv = getStateSectorWeights("MV", "DD", P);
    const ber = getStateSectorWeights("BEO", "DD", P);
    // Mecklenburg is the farm Land; Sachsen-Anhalt the chemical heartland (Leuna/Buna).
    expect(mv.agriculture).toBeGreaterThan(st.agriculture);
    expect(mv.agriculture).toBeGreaterThan(ber.agriculture);
    expect(st.chemical_industries).toBeGreaterThan(mv.chemical_industries);
    expect(st.chemical_industries).toBeGreaterThan(ber.chemical_industries);
  });

  it("gives econ-only nations era-correct state specialties (not an even split)", () => {
    expect(top1953("DE", "NW")).toBe("manufacturing"); // Ruhr
    expect(top1953("FR", "FR_EST")).toBe("manufacturing"); // Lorraine steel
    expect(top1953("IT", "IT_NW")).toBe("manufacturing"); // Turin/FIAT
    expect(top1953("SE", "SE_NOR")).toBe("extraction"); // Kiruna iron
    expect(top1953("ES", "ES_PVB")).toBe("manufacturing"); // Bilbao steel
    expect(top1953("TR", "TR_CEN")).toBe("agriculture"); // Anatolian steppe
    expect(top1953("JP", "KAN")).toBe("manufacturing"); // Kanto
    // No anachronistic technology anywhere in the econ-nation overrides.
    expect(getStateSectorWeights("FR_IDF", "FR", P).technology ?? 0).toBe(0);
  });

  it("normalises 1953 weights", () => {
    for (const [c, s] of [
      ["US", "CA"],
      ["RU", "URA"],
      ["UK", "WAL"],
      ["DD", "SN"],
      ["FR", "FR_EST"],
      ["JP", "KAN"],
    ] as const) {
      const total = Object.values(getStateSectorWeights(s, c, P)).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 10);
    }
  });
});
