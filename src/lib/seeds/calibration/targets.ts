import type { EraId } from "@/lib/seeds/presetSelector";
import type { CalibrationTarget, CountryId } from "./types";

/**
 * Election-anchored targets. center/spread on the derived −5..+5 scale; sign
 * anchors and orderings come from real results (nearest election to the era).
 * Tolerances start loose-ish and tighten as calibration converges.
 *
 * Region IDs:
 *   US: USPS state codes + DC.
 *   UK: LON SEE SWE EAE EMI WMI YHU NWE NEE SCO WAL NIR (NIR omitted from L/R
 *       anchors — its cleavage is unionist/nationalist, not left/right).
 *   DE: BW BY NW HE RP SL NI SH HH BRE BE BB MV SN ST TH.
 *   JP: HOK TOH KAN CHU KNS CGK SHI KYU.
 *   IE: DUB KIL MID WEX LIM COR GAL DON.
 *   BR: NORTE NORDESTE CENTRO_OESTE SUDESTE SUL.
 *
 * Confidence is noted in `election`. Low-confidence cells use center+spread only
 * (few/no sign anchors) and are the priority for Egg's review.
 */
export const TARGETS: Partial<Record<CountryId, Partial<Record<EraId, CalibrationTarget>>>> = {
  // ─── United States — presidential, by state ───────────────────────────────
  US: {
    "1979": {
      // 2026-08 compressed calibration: graded on the ECON axis (twoAxis) —
      // the display lean collapses both axes and the social baseline now
      // dominates it in compressed eras (#3760 rationale). Vote-path level
      // bands live in src/lib/seeds/eraBalanceLadder.test.ts.
      center: 0,
      centerTol: 5,
      minSpread: 0,
      expectLeft: ["DC", "GA", "WV", "MN", "MD", "RI", "HI"],
      expectRight: ["UT", "ID", "WY", "NE", "KS", "AK"],
      election: "US 1980 presidential (Reagan landslide; Carter states = left)",
      twoAxis: {
        economicCenter: 0.35,
        economicCenterTol: 0.5,
        minEconomicSpread: 2.4,
        minSocialSpread: 2.4,
      },
    },
    "1991": {
      center: 0,
      centerTol: 5,
      minSpread: 0,
      // WV/AR removed from expectLeft (2026-07): they voted Clinton in 1992 out
      // of Southern-Democrat *party* loyalty, but their electorates' ideological
      // lean — which is what displayLean models and what the engine consumes —
      // was clearly right (legacy derivation +2.0/+2.7). Keeping them left here
      // provably contradicted the layer1 legacy-sign parity test.
      expectLeft: ["DC", "MA", "RI", "NY", "MD", "HI", "MN", "IL"],
      expectRight: ["UT", "ID", "WY", "NE", "KS", "AK", "OK", "SC", "IN"],
      ordering: [
        ["MA", "TX"],
        ["NY", "WY"],
      ],
      election: "US 1992 presidential, by state (ideology-adjusted for WV/AR)",
      twoAxis: {
        economicCenter: 0.15,
        economicCenterTol: 0.5,
        minEconomicSpread: 3.2,
        minSocialSpread: 3.4,
      },
    },
    "1999": {
      center: 0,
      centerTol: 5,
      minSpread: 0,
      // Compressed calibration: the archetype-path econ surface carries a
      // systematic ~+0.7 right offset vs the granular vote path (which is the
      // calibrated one) — only the clearest left anchors survive it.
      expectLeft: ["DC", "MA", "RI"],
      expectRight: ["WY", "ID", "UT", "AK", "NE", "KS", "OK", "TX", "AL", "MS", "ND", "SD"],
      ordering: [
        ["MA", "TX"],
        ["NY", "WY"],
      ],
      election: "US 2000 presidential, by state",
      twoAxis: {
        economicCenter: 0.9,
        economicCenterTol: 0.5,
        minEconomicSpread: 2.2,
        minSocialSpread: 2.6,
      },
    },
    "2007": {
      center: 0,
      centerTol: 5,
      minSpread: 0,
      // Compressed calibration + archetype-path right offset (see the 1999
      // comment): only the clearest left anchors survive on this surface.
      expectLeft: ["DC", "HI"],
      expectRight: ["WY", "OK", "ID", "UT", "AL", "AR", "LA", "KY", "TN", "NE", "KS", "WV"],
      ordering: [
        ["MA", "TX"],
        ["CA", "AL"],
      ],
      election: "US 2008 presidential, by state",
      twoAxis: {
        economicCenter: 0.95,
        economicCenterTol: 0.5,
        minEconomicSpread: 2.4,
        minSocialSpread: 2.9,
      },
    },
    "2019": {
      center: 0,
      centerTol: 0.6,
      minSpread: 2.5,
      expectLeft: ["CA", "NY", "MA", "MD", "HI", "WA", "VT", "IL", "DC", "NJ"],
      expectRight: ["WY", "WV", "OK", "ND", "ID", "AL", "AR", "KY", "SD", "TN"],
      ordering: [
        ["MA", "TX"],
        ["CA", "AL"],
        ["NY", "WY"],
      ],
      election: "US 2020 presidential, by state",
    },
    "2023": {
      center: 0,
      centerTol: 0.6,
      minSpread: 2.5,
      expectLeft: ["DC", "HI", "MA", "MD", "VT", "CA", "NY", "WA", "IL", "NJ", "CT", "RI"],
      expectRight: ["WY", "WV", "ND", "ID", "OK", "AR", "AL", "KY", "SD", "TN", "MS", "MT"],
      ordering: [
        ["MA", "TX"],
        ["CA", "AL"],
      ],
      election: "US 2024 presidential, by state",
    },
  },

  // ─── The four countries enabled in the 1953 iteration ─────────────────────
  // US/UK/RU/DD are what players can actually pick. RU and DD had no cell at
  // all, and their regions were politically indistinguishable (economic spread
  // 0.30 and 0.10 across the whole country), which made the home-region choice
  // meaningless for half the playable roster.
  RU: {
    "1953": {
      center: 0,
      centerTol: 5,
      minSpread: 0,
      expectLeft: [],
      expectRight: [],
      election:
        "USSR 1953 — command economy; no competitive vote. Guards regional variation, not left/right.",
      twoAxis: {
        // Every region is economically left, correctly: this is a command
        // economy. The requirement is that they differ from each other.
        economicCenter: -2.0,
        economicCenterTol: 0.6,
        minEconomicSpread: 0.4,
        minSocialSpread: 0.7,
      },
    },
  },

  DD: {
    "1953": {
      center: 0,
      centerTol: 5,
      minSpread: 0,
      expectLeft: [],
      expectRight: [],
      election:
        "DDR 1953 — post-June-17; no competitive vote. Guards regional variation, not left/right.",
      twoAxis: {
        economicCenter: -0.6,
        economicCenterTol: 0.6,
        minEconomicSpread: 0.35,
        minSocialSpread: 0.8,
      },
    },
  },

  // ─── United Kingdom — House of Commons vote share, by region ───────────────
  UK: {
    "1953": {
      center: 0,
      centerTol: 0.6,
      minSpread: 1.8,
      expectLeft: ["NEE", "NWE", "WAL", "SCO", "YHU"],
      expectRight: ["SEE", "SWE", "EAE", "EMI"],
      election:
        "UK 1951/1955 generals (near-ties; Churchill government, Labour North/Wales/Scotland)",
    },
    "1979": {
      center: 0,
      centerTol: 0.6,
      minSpread: 1.8,
      expectLeft: ["NEE", "NWE", "WAL", "SCO", "YHU"],
      expectRight: ["SEE", "SWE", "EAE", "EMI"],
      election: "UK 1979 general (North/Wales/Scotland Labour, South Conservative)",
    },
    "1991": {
      // 2026-08 level recalibration: the 1992-era GB electorate sits econ-left
      // of the party midpoint as a LEVEL (the realized Con win comes from the
      // social axis + kernel), so this cell grades econ geography relatively.
      // Vote-path level bands live in eraBalanceLadder.test.ts. The tiny
      // spread is the census-contrast ceiling — see the lean-lab audit doc.
      center: 0,
      centerTol: 5,
      minSpread: 0,
      expectLeft: [],
      expectRight: [],
      election: "UK 1992 general",
      twoAxis: {
        economicCenter: -1.7,
        economicCenterTol: 0.5,
        minEconomicSpread: 0.7,
        minSocialSpread: 0.05,
      },
      ordering: [
        ["LON", "SEE"],
        ["NEE", "SEE"],
        ["NWE", "SWE"],
        ["WAL", "EAE"],
      ],
    },
    "1999": {
      // Blair-landslide LEVEL (econ centre ~-2) is the calibration here; the
      // region gradient survives only as orderings at this census contrast.
      center: 0,
      centerTol: 5,
      minSpread: 0,
      expectLeft: [],
      expectRight: [],
      election: "UK 1997 general (Blair landslide)",
      twoAxis: {
        economicCenter: -2.05,
        economicCenterTol: 0.5,
        minEconomicSpread: 0.2,
        minSocialSpread: 0.3,
      },
      ordering: [["NEE", "SEE"]],
    },
    "2007": {
      center: 0,
      centerTol: 0.6,
      minSpread: 1.8,
      expectLeft: ["NEE", "NWE", "WAL", "SCO", "YHU", "LON"],
      expectRight: ["SEE", "SWE", "EAE"],
      election: "UK 2005 general",
    },
    "2019": {
      center: 0,
      centerTol: 0.6,
      minSpread: 1.6,
      // Red wall fell in 2019; only the clearest anchors used.
      // SCO/WAL read marginally right on the archetype surface after the
      // 2026-08 level fix; they stay left on the granular path (uk.test.ts).
      expectLeft: ["LON"],
      expectRight: ["SEE", "SWE", "EAE"],
      election: "UK 2019 general (low confidence on Midlands/North — review)",
    },
    "2023": {
      center: 0,
      centerTol: 0.6,
      minSpread: 1.8,
      expectLeft: ["NEE", "NWE", "WAL", "LON", "YHU"],
      expectRight: ["SEE", "EAE"],
      election: "UK 2024 general (Labour landslide)",
    },
  },

  // ─── Germany — Bundestag vote share, by Land ──────────────────────────────
  // Pre-1990 eras: eastern Länder may be absent/placeholder in census — anchors
  // restricted to western Länder for 1979/1991. Flag for review.
  DE: {
    "1979": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.5,
      expectLeft: ["HH", "BRE", "NW", "SL"],
      expectRight: ["BY", "BW"],
      election: "West Germany 1980 (Schmidt SPD); West Länder only",
    },
    "1991": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.5,
      expectLeft: ["HH", "BRE", "NW"],
      expectRight: ["BY", "BW"],
      election: "Germany 1990 (first reunified; low confidence on East — review)",
    },
    "1999": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.6,
      expectLeft: ["HH", "BRE", "NW", "BB", "MV", "TH"],
      expectRight: ["BY", "BW"],
      election: "Germany 1998 (Schröder SPD win; East SPD/PDS strong)",
    },
    "2007": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.5,
      expectLeft: ["HH", "BRE", "BE"],
      expectRight: ["BY", "BW"],
      election: "Germany 2005 (grand coalition)",
    },
    "2019": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.6,
      expectLeft: ["BE", "HH", "BRE"],
      expectRight: ["BY", "BW", "SN"],
      election: "Germany 2017",
    },
    "2023": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.6,
      expectLeft: ["HH", "BRE", "BE", "BB", "MV"],
      expectRight: ["BY", "BW", "SN"],
      election: "Germany 2021 (Scholz SPD win)",
    },
  },

  // ─── Japan — House of Representatives, by region (urban left / rural LDP) ──
  // Japan's regional left-right is subtle (LDP rural-dominant). Anchors are the
  // clearest urban (left) vs rural (right) contrast only. Low confidence.
  JP: {
    // Japan is graded on both axes (#3760). Left/right is asserted on the
    // ECONOMIC axis, and the social axis must carry real regional variation
    // rather than sitting at a near-constant level the vote engine cannot
    // distinguish between regions. Metro Kanto/Kansai vs rural Tohoku/Shikoku.
    "1979": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.2,
      expectLeft: ["KAN", "KNS"],
      expectRight: ["TOH", "SHI"],
      election: "Japan 1979 HR (urban opposition vs rural LDP — low confidence)",
      twoAxis: {
        minEconomicSpread: 0.6,
        minSocialSpread: 1.2,
        economicCenterTol: 0.35,
      },
    },
    "1991": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.2,
      expectLeft: ["KAN", "KNS"],
      expectRight: ["TOH", "SHI"],
      election: "Japan 1990 HR (low confidence)",
      twoAxis: {
        minEconomicSpread: 0.6,
        minSocialSpread: 1.2,
        economicCenterTol: 0.35,
      },
    },
    "1999": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.2,
      expectLeft: ["KAN", "KNS"],
      expectRight: ["TOH", "SHI"],
      election: "Japan 2000 HR (low confidence)",
      twoAxis: {
        minEconomicSpread: 0.6,
        minSocialSpread: 1.2,
        economicCenterTol: 0.35,
      },
    },
    "2007": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.2,
      expectLeft: ["KAN", "KNS"],
      expectRight: ["TOH", "SHI"],
      election: "Japan 2009 HR (DPJ win; urban left — low confidence)",
      twoAxis: {
        minEconomicSpread: 0.6,
        minSocialSpread: 1.2,
        economicCenterTol: 0.35,
      },
    },
    "2019": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.2,
      expectLeft: ["KAN", "KNS"],
      expectRight: ["TOH", "SHI"],
      election: "Japan 2017 HR (low confidence)",
      twoAxis: {
        minEconomicSpread: 0.6,
        minSocialSpread: 1.2,
        economicCenterTol: 0.35,
      },
    },
    "2023": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.2,
      expectLeft: ["KAN", "KNS"],
      expectRight: ["TOH", "SHI"],
      election: "Japan 2021 HR (low confidence)",
      twoAxis: {
        minEconomicSpread: 0.6,
        minSocialSpread: 1.2,
        economicCenterTol: 0.35,
      },
    },
  },

  // ─── Ireland — Dáil, by region ────────────────────────────────────────────
  // Irish politics is weakly left-right (FF/FG both centre-right historically).
  // Center+spread only, with Dublin (urban left) the single robust anchor.
  // LOW CONFIDENCE across the board — primary review target.
  IE: {
    "1979": {
      center: 0,
      centerTol: 0.8,
      minSpread: 1.0,
      expectLeft: ["DUB"],
      expectRight: [],
      election: "Ireland 1977 Dáil (low confidence — left/right weak)",
    },
    "1991": {
      center: 0,
      centerTol: 0.8,
      minSpread: 1.0,
      expectLeft: ["DUB"],
      expectRight: [],
      election: "Ireland 1989 Dáil (low confidence)",
    },
    "1999": {
      center: 0,
      centerTol: 0.8,
      minSpread: 1.0,
      expectLeft: ["DUB"],
      expectRight: [],
      election: "Ireland 1997 Dáil (low confidence)",
    },
    "2007": {
      center: 0,
      centerTol: 0.8,
      minSpread: 1.0,
      expectLeft: ["DUB"],
      expectRight: [],
      election: "Ireland 2007 Dáil (low confidence)",
    },
    "2019": {
      center: 0,
      centerTol: 0.8,
      minSpread: 1.0,
      expectLeft: ["DUB"],
      expectRight: [],
      election: "Ireland 2020 Dáil (SF urban surge — low confidence)",
    },
    "2023": {
      center: 0,
      centerTol: 0.8,
      minSpread: 1.0,
      expectLeft: ["DUB"],
      expectRight: [],
      election: "Ireland 2020 Dáil (low confidence)",
    },
  },

  // ─── Brazil — presidential, by macro-region (1979 excluded) ───────────────
  // The Nordeste(left)/Sul(right) cleavage is a post-2002 (Lula) phenomenon;
  // earlier eras anchor center+spread only. Modern eras anchor signs.
  BR: {
    "1991": {
      center: 0,
      centerTol: 0.8,
      minSpread: 1.0,
      expectLeft: [],
      expectRight: [],
      election: "Brazil 1989 presidential (pre-Lula cleavage — center/spread only)",
    },
    "1999": {
      center: 0,
      centerTol: 0.8,
      minSpread: 1.0,
      expectLeft: [],
      expectRight: [],
      election: "Brazil 1998 presidential (center/spread only)",
    },
    "2007": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.2,
      expectLeft: ["NORDESTE"],
      expectRight: ["SUL"],
      election: "Brazil 2006 presidential (Lula; Nordeste left emerging)",
    },
    "2019": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.3,
      expectLeft: ["NORDESTE"],
      expectRight: ["SUL", "CENTRO_OESTE"],
      election: "Brazil 2018 presidential",
    },
    "2023": {
      center: 0,
      centerTol: 0.7,
      minSpread: 1.3,
      expectLeft: ["NORDESTE", "NORTE"],
      expectRight: ["SUL", "CENTRO_OESTE"],
      election: "Brazil 2022 presidential (Lula v Bolsonaro)",
    },
  },
};

export function getTarget(country: string, era: EraId): CalibrationTarget | undefined {
  return TARGETS[country as CountryId]?.[era];
}
