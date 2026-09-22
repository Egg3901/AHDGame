import type { StateDemographics } from "@/lib/db/types";

/**
 * Japan region demographics — 1999 era (Obuchi government, "lost decade").
 *
 * Era anchor: post-bubble stagnation under PM Keizo Obuchi. The 1998 banking
 * crisis and the employment ice age define the moment. The DPJ has just been
 * re-founded (1998) and urban floating voters are growing; Komeito enters
 * coalition with the LDP (Oct 1999). Rengo-affiliated public-sector unions are
 * shrunken from their 1980s peak but still markedly larger than in the 2010s.
 * Aging is underway but far less advanced (65+ ≈ 16% of population vs ~28% in
 * 2019), so retiree shares are much smaller and rural/salaryman shares larger.
 * Reform populists (Ishin, founded 2010) do not yet exist as a bloc — kept at
 * a token 1-2% (every archetype non-zero, per file convention). Working
 * mothers are a small electorate: female labor participation with children is
 * low and not yet politically organized.
 *
 * Turnout calibration: the 2000 House of Representatives election ran ~62%
 * national turnout (1996 was ~60%). Group turnouts here are authored so the
 * weighted average lands near 62%, with ice-age youth severely disengaged
 * (~40%) and rural/elderly/Komeito blocs well above average.
 *
 * Methodology: every value in this file was authored independently from
 * historical knowledge of late-1990s Japan (election results by bloc, 1995/
 * 2000 census age structure, employment and union-density data). Nothing was
 * derived by scaling the 2019-era file; only region IDs and group IDs are
 * shared with it.
 */
export const jpRegionDemographics1999: StateDemographics[] = [
  // ── Hokkaido ──────────────────────────────────────────────────────────────
  // Strong socialist/union tradition (old JSP heartland); Sapporo growing.
  // Coal-region decline complete; public-works dependency at its peak.
  {
    _id: "HOK",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 16, economicLean: 1, socialLean: 1, turnout: 62 },
      urban_progressive: { population: 12, economicLean: -2, socialLean: -3, turnout: 65 },
      rural_traditionalist: { population: 21, economicLean: 0, socialLean: 3, turnout: 70 },
      young_urban: { population: 12, economicLean: 0, socialLean: -1, turnout: 40 },
      retiree: { population: 10, economicLean: 0, socialLean: 2, turnout: 72 },
      public_sector: { population: 11, economicLean: -3, socialLean: -1, turnout: 68 },
      small_business: { population: 10, economicLean: 2, socialLean: 1, turnout: 66 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 0, turnout: 74 },
      reform_populist: { population: 1, economicLean: 2, socialLean: 0, turnout: 45 },
      working_mothers: { population: 3, economicLean: -1, socialLean: -1, turnout: 52 },
    },
    lastUpdated: new Date(),
  },
  // ── Tohoku ────────────────────────────────────────────────────────────────
  // Deep rural LDP machine country; construction-state pork at its height.
  // Pre-3/11; aging present but not yet extreme.
  {
    _id: "TOH",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 13, economicLean: 1, socialLean: 2, turnout: 63 },
      urban_progressive: { population: 7, economicLean: -2, socialLean: -3, turnout: 64 },
      rural_traditionalist: { population: 28, economicLean: 0, socialLean: 3, turnout: 73 },
      young_urban: { population: 9, economicLean: 0, socialLean: -1, turnout: 38 },
      retiree: { population: 14, economicLean: 0, socialLean: 2, turnout: 73 },
      public_sector: { population: 10, economicLean: -3, socialLean: -1, turnout: 67 },
      small_business: { population: 11, economicLean: 2, socialLean: 1, turnout: 66 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 0, turnout: 74 },
      reform_populist: { population: 1, economicLean: 2, socialLean: 0, turnout: 44 },
      working_mothers: { population: 3, economicLean: -1, socialLean: -1, turnout: 51 },
    },
    lastUpdated: new Date(),
  },
  // ── Kanto ─────────────────────────────────────────────────────────────────
  // Tokyo metro: the home of the rising "floating voter". The new DPJ and
  // urban independents surge here; ice-age youth concentrated in the capital.
  {
    _id: "KAN",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 20, economicLean: 1, socialLean: 1, turnout: 63 },
      urban_progressive: { population: 16, economicLean: -2, socialLean: -3, turnout: 66 },
      rural_traditionalist: { population: 7, economicLean: 0, socialLean: 3, turnout: 69 },
      young_urban: { population: 19, economicLean: 0, socialLean: -2, turnout: 42 },
      retiree: { population: 7, economicLean: 0, socialLean: 2, turnout: 72 },
      public_sector: { population: 9, economicLean: -3, socialLean: -1, turnout: 66 },
      small_business: { population: 9, economicLean: 2, socialLean: 1, turnout: 64 },
      komeito_faithful: { population: 6, economicLean: 0, socialLean: 0, turnout: 74 },
      reform_populist: { population: 2, economicLean: 2, socialLean: 0, turnout: 48 },
      working_mothers: { population: 5, economicLean: -1, socialLean: -1, turnout: 54 },
    },
    lastUpdated: new Date(),
  },
  // ── Chubu ─────────────────────────────────────────────────────────────────
  // Toyota-belt manufacturing still strong despite the slump; private-sector
  // union (Domei-lineage) salarymen dominate; Nagoya conservative-moderate.
  {
    _id: "CHU",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 23, economicLean: 1, socialLean: 1, turnout: 64 },
      urban_progressive: { population: 10, economicLean: -2, socialLean: -3, turnout: 64 },
      rural_traditionalist: { population: 18, economicLean: 0, socialLean: 3, turnout: 71 },
      young_urban: { population: 12, economicLean: 0, socialLean: -1, turnout: 41 },
      retiree: { population: 9, economicLean: 0, socialLean: 2, turnout: 72 },
      public_sector: { population: 9, economicLean: -3, socialLean: -1, turnout: 66 },
      small_business: { population: 11, economicLean: 2, socialLean: 1, turnout: 65 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 0, turnout: 74 },
      reform_populist: { population: 1, economicLean: 2, socialLean: 0, turnout: 45 },
      working_mothers: { population: 3, economicLean: -1, socialLean: -1, turnout: 52 },
    },
    lastUpdated: new Date(),
  },
  // ── Kansai ────────────────────────────────────────────────────────────────
  // Osaka in deep recession — small commerce hit hardest by the lost decade.
  // Strong Soka Gakkai base; anti-establishment streak exists but no Ishin yet.
  {
    _id: "KNS",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 17, economicLean: 1, socialLean: 1, turnout: 61 },
      urban_progressive: { population: 14, economicLean: -2, socialLean: -3, turnout: 64 },
      rural_traditionalist: { population: 10, economicLean: 0, socialLean: 3, turnout: 69 },
      young_urban: { population: 15, economicLean: 0, socialLean: -1, turnout: 40 },
      retiree: { population: 9, economicLean: 0, socialLean: 2, turnout: 72 },
      public_sector: { population: 9, economicLean: -3, socialLean: -1, turnout: 66 },
      small_business: { population: 12, economicLean: 2, socialLean: 1, turnout: 64 },
      komeito_faithful: { population: 7, economicLean: 0, socialLean: 0, turnout: 75 },
      reform_populist: { population: 2, economicLean: 2, socialLean: 0, turnout: 47 },
      working_mothers: { population: 5, economicLean: -1, socialLean: -1, turnout: 52 },
    },
    lastUpdated: new Date(),
  },
  // ── Chugoku ───────────────────────────────────────────────────────────────
  // Classic LDP machine territory (Takeshita/Obuchi-faction country nearby);
  // koenkai networks at full strength; Hiroshima the lone urban counterweight.
  {
    _id: "CGK",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 14, economicLean: 1, socialLean: 2, turnout: 63 },
      urban_progressive: { population: 8, economicLean: -2, socialLean: -3, turnout: 64 },
      rural_traditionalist: { population: 27, economicLean: 0, socialLean: 3, turnout: 73 },
      young_urban: { population: 9, economicLean: 0, socialLean: -1, turnout: 39 },
      retiree: { population: 13, economicLean: 0, socialLean: 2, turnout: 73 },
      public_sector: { population: 10, economicLean: -3, socialLean: -1, turnout: 67 },
      small_business: { population: 11, economicLean: 2, socialLean: 1, turnout: 66 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 0, turnout: 74 },
      reform_populist: { population: 1, economicLean: 2, socialLean: 0, turnout: 44 },
      working_mothers: { population: 3, economicLean: -1, socialLean: -1, turnout: 51 },
    },
    lastUpdated: new Date(),
  },
  // ── Shikoku ───────────────────────────────────────────────────────────────
  // Most rural region; bridge-building public-works era peak; LDP bastion.
  // Youth outflow already chronic in 1999.
  {
    _id: "SHI",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 12, economicLean: 1, socialLean: 2, turnout: 63 },
      urban_progressive: { population: 6, economicLean: -2, socialLean: -3, turnout: 63 },
      rural_traditionalist: { population: 31, economicLean: 0, socialLean: 3, turnout: 73 },
      young_urban: { population: 7, economicLean: 0, socialLean: -1, turnout: 38 },
      retiree: { population: 15, economicLean: 0, socialLean: 2, turnout: 74 },
      public_sector: { population: 10, economicLean: -3, socialLean: -1, turnout: 67 },
      small_business: { population: 11, economicLean: 2, socialLean: 1, turnout: 66 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 0, turnout: 74 },
      reform_populist: { population: 1, economicLean: 2, socialLean: 0, turnout: 43 },
      working_mothers: { population: 3, economicLean: -1, socialLean: -1, turnout: 50 },
    },
    lastUpdated: new Date(),
  },
  // ── Kyushu & Okinawa ─────────────────────────────────────────────────────
  // Conservative rural Kyushu; Okinawa base politics hot after the 1995-96
  // protests; Fukuoka the only sizable floating-voter pool.
  {
    _id: "KYU",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 15, economicLean: 1, socialLean: 2, turnout: 62 },
      urban_progressive: { population: 9, economicLean: -2, socialLean: -3, turnout: 65 },
      rural_traditionalist: { population: 25, economicLean: 0, socialLean: 3, turnout: 72 },
      young_urban: { population: 11, economicLean: 0, socialLean: -1, turnout: 39 },
      retiree: { population: 11, economicLean: 0, socialLean: 2, turnout: 73 },
      public_sector: { population: 10, economicLean: -3, socialLean: -1, turnout: 67 },
      small_business: { population: 11, economicLean: 2, socialLean: 1, turnout: 66 },
      komeito_faithful: { population: 5, economicLean: 0, socialLean: 0, turnout: 74 },
      reform_populist: { population: 1, economicLean: 2, socialLean: 0, turnout: 44 },
      working_mothers: { population: 2, economicLean: -1, socialLean: -1, turnout: 51 },
    },
    lastUpdated: new Date(),
  },
];
