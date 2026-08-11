import type { EasternBlocSeedConfig } from "@/lib/admin/seed/seedEasternBloc";
import { csRegions } from "./csRegions";
import { csRegions1953 } from "./csRegions1953";
import { csParties } from "./csParties";
import { makeEasternBlocCategories } from "@/lib/seeds/shared/easternBlocModel";
import {
  makeEasternBlocStateMetrics,
  makeEasternBlocBaselines,
} from "@/lib/seeds/shared/easternBlocMetrics";

/** Czechoslovakia seed config.
 *  1953: Most industrialized Eastern Bloc; Slánský show trials just concluded;
 *       Jáchymov uranium mined by political prisoners for USSR.
 *  1979: Husák "normalization" after Prague Spring. */
export function getCsSeedConfig(preset: string): EasternBlocSeedConfig {
  const is1953 = preset === "1953-default";
  const regions = is1953 ? csRegions1953 : csRegions;
  const defaultIncome = is1953 ? 28_000 : 30_000;
  // Bohemia is the industrial heart; Slovakia lags it through both eras
  // (federal equalization narrowed but never closed the gap).
  const metrics = makeEasternBlocStateMetrics(
    "CS",
    defaultIncome,
    {
      CS_PRG: {
        medianIncome: is1953 ? 34_000 : 37_000,
        gdpGrowth: is1953 ? 6.0 : 2.5,
        lifeExpectancy: is1953 ? 69 : 71,
        pressFreedom: is1953 ? 4 : 12,
        urbanizationRate: is1953 ? 92 : 96,
      },
      CS_BOH: {
        medianIncome: is1953 ? 32_000 : 34_000,
        gdpGrowth: is1953 ? 6.0 : 2.5, // industrial growth under First Five-Year Plan
        lifeExpectancy: is1953 ? 68 : 70, // good healthcare tradition
        pressFreedom: is1953 ? 4 : 12, // Stalinist show trial era
        urbanizationRate: is1953 ? 62 : 70,
      },
      CS_MOR: {
        medianIncome: is1953 ? 28_000 : 30_000,
        gdpGrowth: is1953 ? 6.0 : 2.5,
        lifeExpectancy: is1953 ? 68 : 70,
        pressFreedom: is1953 ? 4 : 12,
        urbanizationRate: is1953 ? 54 : 62,
      },
      CS_SVK: {
        medianIncome: is1953 ? 21_000 : 26_000,
        gdpGrowth: is1953 ? 6.5 : 3.0, // catch-up industrialization runs hotter
        lifeExpectancy: is1953 ? 65 : 69,
        pressFreedom: is1953 ? 4 : 12,
        urbanizationRate: is1953 ? 38 : 52,
      },
    },
    is1953 ? "1953" : "1979"
  );
  return {
    countryId: "CS",
    categoryId: "cs_voterGroups",
    regions,
    parties: csParties,
    categories: makeEasternBlocCategories("cs_voterGroups", "Czechoslovakia Voter Groups"),
    metrics,
    baselines: makeEasternBlocBaselines(metrics),
  };
}

export const csSeedConfig: EasternBlocSeedConfig = getCsSeedConfig("2019-default");
export default csSeedConfig;
