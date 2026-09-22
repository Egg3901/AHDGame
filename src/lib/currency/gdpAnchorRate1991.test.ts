import { describe, it, expect } from "vitest";
import { getGdpAnchorRate } from "./gdpAnchorRate";
import { INITIAL_RATES_1991 } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import type { CountryGeography } from "@/lib/countries/contract";
import { UK_GEOGRAPHY } from "@/lib/countries/uk/geography";
import { JP_GEOGRAPHY } from "@/lib/countries/jp/geography";
import { DE_GEOGRAPHY } from "@/lib/countries/de/geography";
import { IE_GEOGRAPHY } from "@/lib/countries/ie/geography";
import { CN_GEOGRAPHY } from "@/lib/countries/cn/geography";
import { US_GEOGRAPHY } from "@/lib/countries/us/geography";

/**
 * The 1991 GDP anchor, in the shape #3498 gave 1953.
 *
 * `usdExchangeRate` is the anchor value of ONE unit of a country's stored seed
 * currency: it normalises `state.gdp` into the shared anchor so regional sector
 * markets are sized comparably across countries. For a country whose regional
 * GDP is authored in LOCAL currency it must be the reciprocal of that era's
 * `INITIAL_RATES_*` entry, which is the same table `seedExchangeRates` writes
 * into the `exchangeRates` collection.
 *
 * No era set it for 1991, so every country inherited a base value that is
 * either modern (UK/DE/IE pinned at 1.0, JP at 1/106) or a 1979 rate. The UK
 * read as a $433B economy against a real $1.03T.
 *
 * ⚠️ THE RECIPROCAL IS NOT UNIVERSAL, which is the whole reason this file
 * asserts a GDP band and not just the rate. A country whose regional GDP is
 * already authored in anchor terms needs 1.0, and applying the reciprocal to it
 * is catastrophic — 1953 keeps IT/JP/CN/NG at 1.0 for exactly this reason. The
 * band is what tells the two cases apart.
 */
const RECIPROCAL_ANCHOR: CountryId[] = ["UK", "JP", "DE", "IE", "CN"] as CountryId[];

/**
 * Sum of authored regional GDP, and the real 1991 nominal GDP in USD billions.
 *
 * Regional sums run BELOW national GDP by design — the bundles carry gross
 * value added, which excludes taxes less subsidies on products — so the band is
 * deliberately wide and one-sided. It exists to catch an anchor that is out by
 * an order of magnitude, not to pin the bundles' accuracy.
 */
const REAL_1991_USD_BN: Partial<Record<string, number>> = {
  US: 6158,
  UK: 1030,
  JP: 3530,
  DE: 1810,
  IE: 47,
  CN: 383,
};

const BUNDLES: Record<string, CountryGeography> = {
  US: US_GEOGRAPHY,
  UK: UK_GEOGRAPHY,
  JP: JP_GEOGRAPHY,
  DE: DE_GEOGRAPHY,
  IE: IE_GEOGRAPHY,
  CN: CN_GEOGRAPHY,
};

function anchoredGdpBn(countryId: string): number {
  const bundle = BUNDLES[countryId].regionBundles["1991-default"] ?? [];
  const local = bundle.reduce((total, region) => total + region.gdp, 0);
  return (local * getGdpAnchorRate(countryId as CountryId, "1991-default")) / 1000;
}

describe("1991 GDP anchor", () => {
  it.each(RECIPROCAL_ANCHOR)("%s anchors on the reciprocal of its 1991 forex rate", (countryId) => {
    const rate = INITIAL_RATES_1991[countryId];
    expect(rate, `${countryId} has no 1991 forex rate`).toBeGreaterThan(0);
    expect(getGdpAnchorRate(countryId, "1991-default")).toBeCloseTo(1 / rate!, 10);
  });

  it("leaves the US at 1.0, because its GDP is already anchor-denominated", () => {
    expect(getGdpAnchorRate("US" as CountryId, "1991-default")).toBe(1);
  });

  it.each(Object.keys(REAL_1991_USD_BN))(
    "%s anchors to a plausible share of its real 1991 GDP",
    (countryId) => {
      const anchored = anchoredGdpBn(countryId);
      const real = REAL_1991_USD_BN[countryId]!;
      const share = anchored / real;
      // 65%-115% of real national GDP. Below that means the anchor is too small
      // or the bundle is short; above it means the anchor is inflating the
      // country, which is the Nigeria failure mode.
      expect(share, `${countryId}: $${anchored.toFixed(0)}B vs real $${real}B`).toBeGreaterThan(
        0.65
      );
      expect(share, `${countryId}: $${anchored.toFixed(0)}B vs real $${real}B`).toBeLessThan(1.15);
    }
  );

  /**
   * RU and NG are deliberately NOT on the reciprocal, and this locks that in so
   * a later sweep does not "complete the set".
   *
   * RU carries a placeholder 1991 rate — `INITIAL_RATES_1991` says so in a
   * comment, since RU is not player-enabled in this era — and its 1.35 anchor
   * already lands near its real GDP; the reciprocal would cut it to a third.
   *
   * NG is worse: its bundle holds NGN 241 trillion against a real 1991 GDP of
   * roughly NGN 270 billion, so the numbers are ~900x too large for the "NGN
   * millions" its own header claims. The reciprocal would read Nigeria as a $24
   * TRILLION economy. The bundle is the bug; the anchor is not the place to fix
   * it.
   */
  it.each(["RU", "NG"] as CountryId[])("%s stays off the reciprocal, by decision", (countryId) => {
    const rate = INITIAL_RATES_1991[countryId]!;
    expect(getGdpAnchorRate(countryId, "1991-default")).not.toBeCloseTo(1 / rate, 4);
  });
});
