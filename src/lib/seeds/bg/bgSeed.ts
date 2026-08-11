import type { EasternBlocSeedConfig } from "@/lib/admin/seed/seedEasternBloc";
import { bgRegions } from "./bgRegions";
import { bgRegions1953 } from "./bgRegions1953";
import { bgParties } from "./bgParties";
import { makeEasternBlocCategories } from "@/lib/seeds/shared/easternBlocModel";
import {
  makeEasternBlocStateMetrics,
  makeEasternBlocBaselines,
} from "@/lib/seeds/shared/easternBlocMetrics";

/** Bulgaria seed config.
 *  1953: Chervenkov ("Little Stalin") era — most Stalinist of Eastern Bloc.
 *       Tobacco and agriculture dominant; copper at Medet beginning.
 *  1979: Zhivkov era — stable but stagnant. */
export function getBgSeedConfig(preset: string): EasternBlocSeedConfig {
  const is1953 = preset === "1953-default";
  const regions = is1953 ? bgRegions1953 : bgRegions;
  // 1953 default rescaled to ~1.3x GDP/capita (BGL 40B / 7.3M = BGL 5,479;
  // #income-gdp-scale-audit): the prior 1,500 implied ratio ~0.24-0.33x
  // pre-fix — UNDER-scaled, the opposite failure from most of the bloc
  // (medianIncomeGdpScale1953.test.ts band is [0.8, 2.6]). Scaled UP by ~5.0x
  // off the old figures, preserving each region's relative standing; Bulgaria
  // set at the bloc's lower end, consistent with Chervenkov-era Bulgaria
  // being the "most Stalinist" and least consumer-oriented bloc economy.
  const defaultIncome = is1953 ? 7_500 : 2_500;
  // Sofia leads on income and urbanization; the Danubian north stays the most
  // agricultural through both eras.
  const metrics = makeEasternBlocStateMetrics(
    "BG",
    defaultIncome,
    {
      BG_SOF: {
        medianIncome: is1953 ? 9_550 : 3_100,
        lifeExpectancy: is1953 ? 64 : 71,
        pressFreedom: is1953 ? 4 : 14, // Chervenkov vs Zhivkov
        urbanizationRate: is1953 ? 38 : 68,
        gdpGrowth: is1953 ? 7.0 : 2.5, // rapid collectivization growth rate
      },
      BG_NOR: {
        medianIncome: is1953 ? 6_500 : 2_200,
        lifeExpectancy: is1953 ? 62 : 71,
        pressFreedom: is1953 ? 4 : 14,
        urbanizationRate: is1953 ? 24 : 54,
        gdpGrowth: is1953 ? 7.0 : 2.5,
      },
      BG_COA: {
        medianIncome: is1953 ? 7_000 : 2_500,
        lifeExpectancy: is1953 ? 63 : 71,
        pressFreedom: is1953 ? 4 : 14,
        urbanizationRate: is1953 ? 28 : 62,
        gdpGrowth: is1953 ? 7.0 : 2.5,
      },
      BG_THR: {
        medianIncome: is1953 ? 7_000 : 2_400,
        lifeExpectancy: is1953 ? 63 : 71,
        pressFreedom: is1953 ? 4 : 14,
        urbanizationRate: is1953 ? 26 : 56,
        gdpGrowth: is1953 ? 7.0 : 2.5,
      },
      BG_SW: {
        medianIncome: is1953 ? 6_300 : 2_100,
        lifeExpectancy: is1953 ? 62 : 70,
        pressFreedom: is1953 ? 4 : 14,
        urbanizationRate: is1953 ? 22 : 44,
        gdpGrowth: is1953 ? 7.0 : 2.5,
      },
    },
    is1953 ? "1953" : "1979"
  );
  return {
    countryId: "BG",
    categoryId: "bg_voterGroups",
    regions,
    parties: bgParties,
    categories: makeEasternBlocCategories("bg_voterGroups", "Bulgaria Voter Groups"),
    metrics,
    baselines: makeEasternBlocBaselines(metrics),
  };
}

export const bgSeedConfig: EasternBlocSeedConfig = getBgSeedConfig("2019-default");
export default bgSeedConfig;
