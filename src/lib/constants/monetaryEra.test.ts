import { describe, it, expect } from "vitest";
import { getEraMonetaryBaseline, getEraTrendGdpGrowth } from "./monetaryEra";
import { MONETARY_BASELINES } from "./currencies";
import type { CountryId } from "./countries";
import { ruMetricPresets1953 } from "@/lib/seeds/ru/ruMetricPresets1953";

describe("getEraMonetaryBaseline", () => {
  it("returns 1953 anchors for the late-1970s-calibrated countries", () => {
    expect(getEraMonetaryBaseline("IT", 1953)).toMatchObject({
      targetInflation: 2.5,
      neutralPrimeRate: 4.0,
    });
    expect(getEraMonetaryBaseline("TR", 1953)).toMatchObject({
      targetInflation: 5.0,
      neutralPrimeRate: 6.0,
    });
    expect(getEraMonetaryBaseline("ES", 1953)?.targetInflation).toBe(4.0);
    expect(getEraMonetaryBaseline("FR", 1953)?.targetInflation).toBe(2.0);
    expect(getEraMonetaryBaseline("SE", 1953)?.targetInflation).toBe(2.0);
  });

  it("keeps 1953 anchors well below the 15% inflation model cap", () => {
    for (const countryId of ["RU", "FR", "IT", "ES", "SE", "TR", "JP", "DE", "NG"] as CountryId[]) {
      const era = getEraMonetaryBaseline(countryId, 1953);
      expect(era).toBeDefined();
      expect(era!.targetInflation).toBeLessThanOrEqual(5.0);
    }
  });

  it("covers GR for 1953 and 1971 spans instead of falling through to the 1979-calibrated modern table", () => {
    // GR had NO 1953-era override at all until this test was written: it fell
    // through to `MONETARY_BASELINES.GR` (targetInflation 15.0 / neutralPrimeRate
    // 16.5 — a late-1970s drachma calibration) for the entire pre-1979 span.
    // Since that target sits AT the model's old 15.0 ceiling, a 1953-default
    // world pinned GR's inflation at min=max=15.0 for its whole pre-1979 run —
    // the exact disease this table exists to cure (see file header), just
    // missed for GR specifically.
    const gr1953 = getEraMonetaryBaseline("GR", 1953);
    expect(gr1953).toBeDefined();
    expect(gr1953!.targetInflation).toBeLessThan(10.0);
    expect(gr1953!.neutralPrimeRate).toBeLessThan(10.0);

    const gr1971 = getEraMonetaryBaseline("GR", 1971);
    expect(gr1971).toBeDefined();
    // Distinct from (and below) the modern/1979 late-1970s crisis calibration.
    expect(gr1971!.targetInflation).toBeLessThan(MONETARY_BASELINES.GR.targetInflation);
    expect(gr1971!.neutralPrimeRate).toBeLessThan(MONETARY_BASELINES.GR.neutralPrimeRate);

    // 1979+ correctly falls through to the modern table (byte-identical,
    // late-1970s drachma regime — no override needed there).
    expect(getEraMonetaryBaseline("GR", 1979)).toBeUndefined();
  });

  it("returns undefined outside every era span (modern constants win)", () => {
    // Current-year keying: only years ≥ 1999 (and absent years) fall through
    // to the modern table.
    for (const year of [1999, 2015, 2019, 2023, undefined, null]) {
      expect(getEraMonetaryBaseline("IT", year)).toBeUndefined();
      expect(getEraMonetaryBaseline("TR", year)).toBeUndefined();
      expect(getEraMonetaryBaseline("RU", year)).toBeUndefined();
      expect(getEraMonetaryBaseline("US", year)).toBeUndefined();
    }
  });

  it("selects the era table by span of the CURRENT in-game year: <1971, <1979, <1991, <1999, then modern", () => {
    // Era spans (current-year keying, 2026-07-17 correction): a year belongs
    // to the era it is IN — 1953-era until 1971, 1971-era until 1979, 1979-era
    // until 1991, 1991-era until 1999. Exact preset years (1953/1979/1991/1999+)
    // resolve the same table the old seed-year windows did.
    //
    // The 1971 split was added because a 1953 world runs ~48 turns per in-game
    // year, so a 1000-turn run reaches ~1973 — the whole post-Bretton-Woods
    // period previously resolved 1953 anchors, i.e. Bretton-Woods price
    // stability persisting years after the system it depended on ended.
    expect(getEraMonetaryBaseline("IT", 1953)?.targetInflation).toBe(2.5);
    expect(getEraMonetaryBaseline("IT", 1955)?.targetInflation).toBe(2.5); // still 1953 era
    expect(getEraMonetaryBaseline("IT", 1970)?.targetInflation).toBe(2.5); // last 1953-era year
    expect(getEraMonetaryBaseline("IT", 1971)?.targetInflation).toBe(9.0); // 1971 table
    expect(getEraMonetaryBaseline("IT", 1978)?.targetInflation).toBe(9.0);
    expect(getEraMonetaryBaseline("IT", 1979)?.targetInflation).toBe(15.0); // 1979 table
    expect(getEraMonetaryBaseline("IT", 1990)?.targetInflation).toBe(15.0);
    expect(getEraMonetaryBaseline("IT", 1991)?.targetInflation).toBe(5.5); // 1991 table
    expect(getEraMonetaryBaseline("IT", 1998)?.targetInflation).toBe(5.5);
    expect(getEraMonetaryBaseline("IT", 1999)).toBeUndefined(); // modern
  });

  it("GRADUATION: a long-lived world re-keys its anchors as its clock advances", () => {
    // A 1953-default world over 70 in-game years of play:
    expect(getEraMonetaryBaseline("IT", 1955)?.targetInflation).toBe(2.5); // 1953 anchors
    expect(getEraMonetaryBaseline("IT", 1985)?.targetInflation).toBe(15.0); // 1979 anchors
    expect(getEraMonetaryBaseline("IT", 1995)?.targetInflation).toBe(5.5); // 1991 anchors
    expect(getEraMonetaryBaseline("IT", 2020)).toBeUndefined(); // modern
    // The live 1991-default world at in-game ~2015: modern anchors — its
    // pre-era-table (pre-2026-07-17) behavior.
    for (const countryId of ["US", "UK", "JP", "DE", "IT", "RU"] as CountryId[]) {
      expect(getEraMonetaryBaseline(countryId, 2015)).toBeUndefined();
      expect(getEraTrendGdpGrowth(countryId, 2015)).toBeUndefined();
    }
    // A 2019-default world can never see a historical year: currentYear starts
    // at 2019 and only advances, so resolution is always modern.
    expect(getEraMonetaryBaseline("IT", 2019)).toBeUndefined();
    expect(getEraMonetaryBaseline("IT", 2067)).toBeUndefined();
  });

  it("fail-safe: absent or non-finite years resolve modern", () => {
    for (const year of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(getEraMonetaryBaseline("IT", year)).toBeUndefined();
      expect(getEraTrendGdpGrowth("RU", year)).toBeUndefined();
    }
  });

  it("1979 table: honest stagflation anchors; FR/IT/ES/SE/TR repeat the global table verbatim", () => {
    expect(getEraMonetaryBaseline("US", 1979)).toMatchObject({
      targetInflation: 10.0,
      neutralPrimeRate: 12.0,
    });
    expect(getEraMonetaryBaseline("UK", 1979)?.targetInflation).toBe(12.0);
    // The global table's late-1970s calibration IS 1979 — anchors must stay
    // value-identical so 1979 worlds keep their pre-era-table resolution.
    for (const countryId of ["FR", "IT", "ES", "SE", "TR"] as CountryId[]) {
      const era = getEraMonetaryBaseline(countryId, 1979)!;
      expect(era.targetInflation).toBe(MONETARY_BASELINES[countryId].targetInflation);
      expect(era.neutralPrimeRate).toBe(MONETARY_BASELINES[countryId].neutralPrimeRate);
    }
    // CN has no 1979 entry: administered-price 2.0 modern target is era-plausible.
    expect(getEraMonetaryBaseline("CN", 1979)).toBeUndefined();
  });

  it("1991 table: moderate disinflation anchors, all below the 15% model cap", () => {
    expect(getEraMonetaryBaseline("US", 1991)).toMatchObject({
      targetInflation: 4.0,
      neutralPrimeRate: 6.0,
    });
    expect(getEraMonetaryBaseline("UK", 1991)?.targetInflation).toBe(4.5);
    expect(getEraMonetaryBaseline("JP", 1991)?.targetInflation).toBe(2.5);
    expect(getEraMonetaryBaseline("DE", 1991)?.targetInflation).toBe(3.5);
    // Hyperinflation-era BR/RU and 66%/yr TR are authored below the 15 cap so
    // their CPI stays dynamic instead of pinning min=max=15 for the whole run.
    for (const countryId of [
      "US",
      "UK",
      "JP",
      "DE",
      "IE",
      "CN",
      "BR",
      "NG",
      "RU",
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
    ] as CountryId[]) {
      const era = getEraMonetaryBaseline(countryId, 1991);
      expect(era).toBeDefined();
      expect(era!.targetInflation).toBeLessThan(15.0);
    }
  });

  it("returns undefined for countries whose modern baseline is already era-plausible", () => {
    for (const countryId of ["US", "UK", "IE", "CN"] as CountryId[]) {
      expect(getEraMonetaryBaseline(countryId, 1953)).toBeUndefined();
      // Falling through to the modern table must give a sane 1953 anchor.
      expect(MONETARY_BASELINES[countryId].targetInflation).toBeLessThanOrEqual(2.0);
    }
  });
});

describe("getEraTrendGdpGrowth", () => {
  it("matches the authored RU 1953 seed overlay (economic.gdpGrowth = 6.0)", () => {
    // The engine value must track what the seed authors — pin them together.
    const authored = ruMetricPresets1953["VOL"]?.["economic.gdpGrowth"];
    expect(authored).toBe(6.0);
    expect(getEraTrendGdpGrowth("RU", 1953)).toBe(authored);
  });

  it("authors trend growth for every layer-1 country without metric dynamics", () => {
    expect(getEraTrendGdpGrowth("FR", 1953)).toBe(4.5);
    expect(getEraTrendGdpGrowth("IT", 1953)).toBe(6.0);
    expect(getEraTrendGdpGrowth("ES", 1953)).toBe(4.5);
    expect(getEraTrendGdpGrowth("SE", 1953)).toBe(3.5);
    expect(getEraTrendGdpGrowth("TR", 1953)).toBe(6.0);
  });

  it("is undefined for fully-simulated countries (metric engine owns their growth)", () => {
    for (const countryId of ["US", "UK", "JP", "DE", "BR", "CN", "NG", "IE"] as CountryId[]) {
      expect(getEraTrendGdpGrowth(countryId, 1953)).toBeUndefined();
    }
  });

  it("authors 1979 trend growth for layer-1 countries (was flat 2.5)", () => {
    expect(getEraTrendGdpGrowth("FR", 1979)).toBe(3.0);
    expect(getEraTrendGdpGrowth("IT", 1979)).toBe(3.5);
    expect(getEraTrendGdpGrowth("ES", 1979)).toBe(2.0);
    expect(getEraTrendGdpGrowth("SE", 1979)).toBe(2.0);
    expect(getEraTrendGdpGrowth("TR", 1979)).toBe(2.0);
    expect(getEraTrendGdpGrowth("RU", 1979)).toBe(2.5); // Brezhnev stagnation
  });

  it("authors 1991 trend growth for layer-1 countries incl. post-Soviet RU collapse", () => {
    expect(getEraTrendGdpGrowth("RU", 1991)).toBe(-5.0); // output collapse '91-94
    expect(getEraTrendGdpGrowth("FR", 1991)).toBe(2.0);
    expect(getEraTrendGdpGrowth("IT", 1991)).toBe(1.5);
    expect(getEraTrendGdpGrowth("ES", 1991)).toBe(2.5);
    expect(getEraTrendGdpGrowth("SE", 1991)).toBe(1.0); // early-90s crisis
    expect(getEraTrendGdpGrowth("TR", 1991)).toBe(4.0);
  });

  it("is undefined in modern worlds — the legacy 2.5 fallback stays untouched", () => {
    for (const countryId of ["RU", "FR", "IT", "ES", "SE", "TR"] as CountryId[]) {
      expect(getEraTrendGdpGrowth(countryId, 2019)).toBeUndefined();
      expect(getEraTrendGdpGrowth(countryId, undefined)).toBeUndefined();
    }
  });
});
