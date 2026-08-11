import type { EraId } from "@/lib/seeds/presetSelector";

export type CountryId = "US" | "UK" | "DE" | "JP" | "IE" | "BR" | "RU" | "DD";

/** Election-anchored target for one country × era. */
export interface CalibrationTarget {
  center: number; // expected population-weighted mean display lean
  centerTol: number; // ± tolerance on center (loose-ish to start)
  minSpread: number; // minimum (max − min) display lean across regions
  expectLeft: string[]; // region IDs that MUST derive display < 0
  expectRight: string[]; // region IDs that MUST derive display > 0
  ordering?: [string, string][]; // [a, b] => display(a) < display(b)
  election: string; // provenance string

  /**
   * Opt this cell into two-axis assertions.
   *
   * The display lean collapses both axes by taking whichever is larger in
   * magnitude, which forces the social level to act as the threshold the
   * economic axis crosses — so a cell graded on `display` cannot also carry a
   * freely-varying social axis (#3760). Cells with `twoAxis` are graded on the
   * ECONOMIC axis for left/right and must additionally show real regional
   * variation on the SOCIAL axis, so social positioning differs by region
   * instead of being a constant offset the vote engine can never distinguish.
   */
  twoAxis?: {
    /** Minimum (max − min) economic lean across regions. */
    minEconomicSpread: number;
    /** Minimum (max − min) social lean across regions. */
    minSocialSpread: number;
    /**
     * Expected mean economic lean. Defaults to 0 for competitive systems. A
     * command economy legitimately sits well left of zero across every region —
     * what matters there is that the regions still differ from one another.
     */
    economicCenter?: number;
    /** ± tolerance on the mean economic lean. */
    economicCenterTol: number;
  };
}

/** country×era cells that are NOT targeted and NOT seeded. */
export const EXCLUDED: Array<{ country: string; era: EraId }> = [
  { country: "CN", era: "1979" },
  { country: "CN", era: "1991" },
  { country: "CN", era: "1999" },
  { country: "CN", era: "2007" },
  { country: "CN", era: "2019" },
  { country: "CN", era: "2023" },
  { country: "BR", era: "1979" },
];

export function isExcluded(country: string, era: EraId): boolean {
  return EXCLUDED.some((e) => e.country === country && e.era === era);
}

export interface RegionLean {
  regionId: string;
  economic: number;
  social: number;
  display: number;
}

export interface CellResult {
  country: CountryId;
  era: EraId;
  meanDisplay: number;
  spread: number;
  failures: string[]; // human-readable assertion failures
  loss: number; // 0 = perfect
}
