import type { EasternBlocSeedConfig } from "@/lib/admin/seed/seedEasternBloc";
import { plRegions } from "./plRegions";
import { plRegions1953 } from "./plRegions1953";
import { plParties } from "./plParties";
import { makeEasternBlocCategories } from "@/lib/seeds/shared/easternBlocModel";
import {
  makeEasternBlocStateMetrics,
  makeEasternBlocBaselines,
} from "@/lib/seeds/shared/easternBlocMetrics";

/** Poland seed config.
 *  1953: Bierut Stalinist era — Nowa Huta, Silesian coal, private peasant farms surviving.
 *  1979: Gierek era, Solidarity imminent. */
export function getPlSeedConfig(preset: string): EasternBlocSeedConfig {
  const is1953 = preset === "1953-default";
  const regions = is1953 ? plRegions1953 : plRegions;
  // 1953 default rescaled to ~1.7x GDP/capita (Zł 300B / 25.5M = Zł 11,765;
  // #income-gdp-scale-audit): the prior 40,000 implied ratio ~3.5-4.6x pre-fix
  // (medianIncomeGdpScale1953.test.ts band is [0.8, 2.6]) — a bare guess
  // disconnected from the 1953 budget's own GDP scale. Scaled by ~0.49 off
  // the old figures, preserving each region's relative standing (Poland set
  // slightly above the bloc's CS/HU calibration, matching its historically
  // higher postwar consumer living standard).
  const defaultIncome = is1953 ? 19_600 : 100_000;
  const metrics = makeEasternBlocStateMetrics(
    "PL",
    defaultIncome,
    {
      PL_MAZ: {
        medianIncome: is1953 ? 21_600 : 108_000,
        gdpGrowth: is1953 ? 5.0 : 2.2, // Stalinist heavy-industry boom
        povertyRate: is1953 ? 28 : 15,
        lifeExpectancy: is1953 ? 64 : 71,
        pressFreedom: is1953 ? 5 : 18,
        urbanizationRate: is1953 ? 48 : 66,
        // Poland was the bloc's HIGHEST 1953 TFR (~2.9-3.0; UN Demographic
        // Yearbook) — birthRateIndexToTFR(84, 2.06) = 2.06*(0.4+0.84*1.2) = 2.55… ,
        // matches at index ~84 nationally; Warsaw (capital, older) trails it.
        birthRate: is1953 ? 76 : undefined,
      },
      PL_LOD: {
        medianIncome: is1953 ? 19_600 : 98_000,
        gdpGrowth: is1953 ? 5.0 : 2.0,
        povertyRate: is1953 ? 32 : 18,
        lifeExpectancy: is1953 ? 64 : 70,
        urbanizationRate: is1953 ? 44 : 56,
        birthRate: is1953 ? 80 : undefined,
      },
      PL_MAL: {
        medianIncome: is1953 ? 20_600 : 100_000,
        gdpGrowth: is1953 ? 5.5 : 2.0, // Nowa Huta steelworks boom
        povertyRate: is1953 ? 30 : 17,
        lifeExpectancy: is1953 ? 64 : 70,
        urbanizationRate: is1953 ? 40 : 52,
        birthRate: is1953 ? 82 : undefined,
      },
      PL_SLK: {
        medianIncome: is1953 ? 23_500 : 112_000,
        gdpGrowth: is1953 ? 5.5 : 1.8,
        povertyRate: is1953 ? 25 : 14,
        airQuality: is1953 ? 55 : 74, // Silesian coal pollution
        lifeExpectancy: is1953 ? 63 : 69,
        urbanizationRate: is1953 ? 60 : 78,
        birthRate: is1953 ? 74 : undefined, // most industrial/urban PL region
      },
      PL_DSL: {
        medianIncome: is1953 ? 18_600 : 96_000,
        gdpGrowth: is1953 ? 4.5 : 2.0, // Recovered Territories still resettling in 1953
        povertyRate: is1953 ? 36 : 18,
        lifeExpectancy: is1953 ? 63 : 70,
        urbanizationRate: is1953 ? 44 : 64,
        birthRate: is1953 ? 82 : undefined, // young resettler population
      },
      PL_WLK: {
        medianIncome: is1953 ? 19_600 : 98_000,
        gdpGrowth: is1953 ? 4.8 : 2.0,
        povertyRate: is1953 ? 32 : 18,
        lifeExpectancy: is1953 ? 64 : 70,
        urbanizationRate: is1953 ? 40 : 54,
        birthRate: is1953 ? 84 : undefined,
      },
      PL_POM: {
        medianIncome: is1953 ? 18_100 : 94_000,
        gdpGrowth: is1953 ? 4.5 : 2.0, // shipyard coast; Recovered Territories
        povertyRate: is1953 ? 36 : 20,
        lifeExpectancy: is1953 ? 64 : 70,
        urbanizationRate: is1953 ? 40 : 58,
        birthRate: is1953 ? 82 : undefined,
      },
      PL_EAS: {
        medianIncome: is1953 ? 15_700 : 84_000,
        gdpGrowth: is1953 ? 4.2 : 2.0,
        povertyRate: is1953 ? 42 : 26,
        lifeExpectancy: is1953 ? 64 : 70,
        urbanizationRate: is1953 ? 30 : 42,
        birthRate: is1953 ? 90 : undefined, // poorest, most rural, highest fertility
      },
    },
    is1953 ? "1953" : "1979"
  );
  return {
    countryId: "PL",
    categoryId: "pl_voterGroups",
    regions,
    parties: plParties,
    categories: makeEasternBlocCategories("pl_voterGroups", "Poland Voter Groups"),
    metrics,
    baselines: makeEasternBlocBaselines(metrics),
  };
}

export const plSeedConfig: EasternBlocSeedConfig = getPlSeedConfig("2019-default");
export default plSeedConfig;
