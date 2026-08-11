import type { EasternBlocSeedConfig } from "@/lib/admin/seed/seedEasternBloc";
import { yuRegions } from "./yuRegions";
import { yuRegions1953 } from "./yuRegions1953";
import { yuParties } from "./yuParties";
import { makeEasternBlocCategories } from "@/lib/seeds/shared/easternBlocModel";
import {
  makeEasternBlocStateMetrics,
  makeEasternBlocBaselines,
} from "@/lib/seeds/shared/easternBlocMetrics";

/** Yugoslavia seed config.
 *  1953: Tito's independent path — collectivization abandoned, worker self-management.
 *       US aid flowing after Tito–Stalin split; more relaxed than Bloc.
 *  1979: Mature Titoism; Adriatic tourism; non-aligned movement leadership. */
export function getYuSeedConfig(preset: string): EasternBlocSeedConfig {
  const is1953 = preset === "1953-default";
  const regions = is1953 ? yuRegions1953 : yuRegions;
  // 1953 default rescaled to ~1.6x GDP/capita (YUD 100B / 16.9M = YUD 5,917;
  // #income-gdp-scale-audit): the prior 35,000 implied ratio ~5.8-7.3x pre-fix
  // (medianIncomeGdpScale1953.test.ts band is [0.8, 2.6]) — disconnected from
  // the 1953 budget's own GDP scale. Scaled by ~0.278 off the old figures,
  // preserving the north-south development gradient; Yugoslavia set toward
  // the bloc's higher end, consistent with post-1948-split US aid and its
  // market-adjacent worker self-management giving more real consumer goods
  // availability than the Cominform bloc.
  const defaultIncome = is1953 ? 9_700 : 60_000;
  // Per-federal-unit spread mirrors Yugoslavia's steep north-south development
  // gradient: Slovenia ≈ 2× the national average, Kosovo ≈ 1/3 of it.
  const metrics = makeEasternBlocStateMetrics(
    "YU",
    defaultIncome,
    {
      YU_SLO: {
        medianIncome: is1953 ? 15_300 : 90_000,
        lifeExpectancy: is1953 ? 66 : 71,
        pressFreedom: is1953 ? 28 : 35, // more open than Bloc even in 1953
        urbanizationRate: is1953 ? 42 : 62,
        incomeInequality: is1953 ? 32 : 30,
      },
      YU_CRO: {
        medianIncome: is1953 ? 12_500 : 75_000,
        lifeExpectancy: is1953 ? 65 : 70,
        pressFreedom: is1953 ? 28 : 35,
        urbanizationRate: is1953 ? 38 : 56,
        incomeInequality: is1953 ? 32 : 30,
      },
      YU_VOJ: {
        // Breadbasket province — above the Serbian average, below the northwest.
        medianIncome: is1953 ? 9_700 : 60_000,
        pressFreedom: is1953 ? 28 : 35,
        urbanizationRate: is1953 ? 32 : 50,
      },
      YU_SRB: {
        medianIncome: is1953 ? 8_900 : 55_000,
        pressFreedom: is1953 ? 28 : 35,
        urbanizationRate: is1953 ? 30 : 48,
      },
      YU_BIH: {
        medianIncome: is1953 ? 7_000 : 42_000,
        lifeExpectancy: is1953 ? 62 : 68,
        povertyRate: is1953 ? 45 : 38,
        pressFreedom: is1953 ? 28 : 35,
        urbanizationRate: is1953 ? 25 : 40,
      },
      YU_MNE: {
        medianIncome: is1953 ? 6_100 : 38_000,
        lifeExpectancy: is1953 ? 62 : 69,
        pressFreedom: is1953 ? 28 : 35,
        urbanizationRate: is1953 ? 24 : 42,
      },
      YU_MKD: {
        medianIncome: is1953 ? 5_000 : 30_000,
        lifeExpectancy: is1953 ? 61 : 68,
        povertyRate: is1953 ? 50 : 42,
        pressFreedom: is1953 ? 28 : 35,
        urbanizationRate: is1953 ? 24 : 42,
      },
      YU_KOS: {
        medianIncome: is1953 ? 4_200 : 25_000,
        lifeExpectancy: is1953 ? 60 : 67,
        povertyRate: is1953 ? 55 : 45,
        pressFreedom: is1953 ? 28 : 35,
        urbanizationRate: is1953 ? 22 : 40,
      },
    },
    is1953 ? "1953" : "1979"
  );
  return {
    countryId: "YU",
    categoryId: "yu_voterGroups",
    regions,
    parties: yuParties,
    categories: makeEasternBlocCategories("yu_voterGroups", "Yugoslavia Voter Groups"),
    metrics,
    baselines: makeEasternBlocBaselines(metrics),
  };
}

export const yuSeedConfig: EasternBlocSeedConfig = getYuSeedConfig("2019-default");
export default yuSeedConfig;
