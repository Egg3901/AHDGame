import type { EasternBlocSeedConfig } from "@/lib/admin/seed/seedEasternBloc";
import { huRegions } from "./huRegions";
import { huRegions1953 } from "./huRegions1953";
import { huParties } from "./huParties";
import { makeEasternBlocCategories } from "@/lib/seeds/shared/easternBlocModel";
import {
  makeEasternBlocStateMetrics,
  makeEasternBlocBaselines,
} from "@/lib/seeds/shared/easternBlocMetrics";

/** Hungary seed config — metrics/baselines/categories from the shared builders.
 *  1953: Rákosi Stalinist period — forced industrialization, near-zero press freedom.
 *  1979: "happiest barracks" — relatively liberal; higher press freedom. */
export function getHuSeedConfig(preset: string): EasternBlocSeedConfig {
  const is1953 = preset === "1953-default";
  const regions = is1953 ? huRegions1953 : huRegions;
  // 1953 default rescaled to ~1.5x GDP/capita (Ft 100B / 9.5M = Ft 10,526; #income-gdp-scale-audit):
  // the prior 30,000 was a bare guess disconnected from the 1953 budget's own
  // GDP scale (implied ratio ~2.8-3.6x pre-fix across regions, medianIncomeGdpScale1953.test.ts
  // band is [0.8, 2.6]). Scaled by ~0.532 off the old figures, preserving each
  // region's relative standing.
  const defaultIncome = is1953 ? 16_000 : 70_000;
  // Budapest's region leads on income and urbanization; the Great Plain trails
  // both eras.
  const metrics = makeEasternBlocStateMetrics(
    "HU",
    defaultIncome,
    {
      HU_BUD: {
        medianIncome: is1953 ? 21_300 : 92_000,
        gdpGrowth: is1953 ? 4.5 : 3.0, // Stalinist forced-industrialization boom vs mature plan
        lifeExpectancy: is1953 ? 68 : 71,
        pressFreedom: is1953 ? 5 : 25, // Rákosi vs Kádár era
        urbanizationRate: is1953 ? 92 : 96,
        medianAge: is1953 ? 34 : 38,
        // Hungary was the BLOC'S LOWEST 1953 TFR (~2.3; UN Demographic
        // Yearbook), and Budapest (oldest median age) sits below the national
        // figure — birthRateIndexToTFR(index, 2.06) puts index 52 at TFR ~2.19.
        birthRate: is1953 ? 52 : undefined,
      },
      HU_PES: {
        medianIncome: is1953 ? 17_000 : 76_000,
        gdpGrowth: is1953 ? 4.5 : 3.0,
        lifeExpectancy: is1953 ? 66 : 69,
        pressFreedom: is1953 ? 5 : 25,
        urbanizationRate: is1953 ? 40 : 56,
        medianAge: is1953 ? 32 : 36,
        birthRate: is1953 ? 58 : undefined,
      },
      HU_TRW: {
        medianIncome: is1953 ? 16_000 : 70_000,
        gdpGrowth: is1953 ? 4.5 : 3.0,
        lifeExpectancy: is1953 ? 66 : 69,
        pressFreedom: is1953 ? 5 : 25,
        urbanizationRate: is1953 ? 38 : 52,
        medianAge: is1953 ? 32 : 36,
        birthRate: is1953 ? 58 : undefined,
      },
      HU_TRS: {
        medianIncome: is1953 ? 14_400 : 64_000,
        gdpGrowth: is1953 ? 4.5 : 3.0,
        lifeExpectancy: is1953 ? 65 : 68,
        pressFreedom: is1953 ? 5 : 25,
        urbanizationRate: is1953 ? 34 : 46,
        medianAge: is1953 ? 32 : 36,
        birthRate: is1953 ? 60 : undefined,
      },
      HU_NOR: {
        medianIncome: is1953 ? 14_400 : 63_000,
        gdpGrowth: is1953 ? 4.5 : 3.0,
        lifeExpectancy: is1953 ? 65 : 68,
        pressFreedom: is1953 ? 5 : 25,
        urbanizationRate: is1953 ? 34 : 46,
        medianAge: is1953 ? 31 : 35,
        birthRate: is1953 ? 62 : undefined,
      },
      HU_ALF: {
        medianIncome: is1953 ? 13_300 : 60_000,
        gdpGrowth: is1953 ? 4.5 : 3.0,
        lifeExpectancy: is1953 ? 65 : 68,
        pressFreedom: is1953 ? 5 : 25,
        urbanizationRate: is1953 ? 30 : 42,
        medianAge: is1953 ? 31 : 35,
        // Great Plain (Alföld) — most rural, highest fertility within HU, but
        // still the bloc's lowest-fertility country overall.
        birthRate: is1953 ? 64 : undefined,
      },
    },
    is1953 ? "1953" : "1979"
  );
  return {
    countryId: "HU",
    categoryId: "hu_voterGroups",
    regions,
    parties: huParties,
    categories: makeEasternBlocCategories("hu_voterGroups", "Hungary Voter Groups"),
    metrics,
    baselines: makeEasternBlocBaselines(metrics),
  };
}

export const huSeedConfig: EasternBlocSeedConfig = getHuSeedConfig("2019-default");
export default huSeedConfig;
