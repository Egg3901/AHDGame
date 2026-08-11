import type { EasternBlocSeedConfig } from "@/lib/admin/seed/seedEasternBloc";
import { roRegions } from "./roRegions";
import { roRegions1953 } from "./roRegions1953";
import { roParties } from "./roParties";
import { makeEasternBlocCategories } from "@/lib/seeds/shared/easternBlocModel";
import {
  makeEasternBlocStateMetrics,
  makeEasternBlocBaselines,
} from "@/lib/seeds/shared/easternBlocMetrics";

/** Romania seed config.
 *  1953: Gheorghiu-Dej — Ploiești oil; collectivization beginning; canal forced labor.
 *  1979: Ceaușescu — systematic austerity; partial independence from USSR. */
export function getRoSeedConfig(preset: string): EasternBlocSeedConfig {
  const is1953 = preset === "1953-default";
  const regions = is1953 ? roRegions1953 : roRegions;
  // 1953 default rescaled to ~1.3x GDP/capita (Lei 80B / 16.6M = Lei 4,819;
  // #income-gdp-scale-audit): the prior 20,000 implied ratio ~4.3-5.6x pre-fix
  // (medianIncomeGdpScale1953.test.ts band is [0.8, 2.6]) — disconnected from
  // the 1953 budget's own GDP scale. Scaled by ~0.304 off the old figures,
  // preserving each region's relative standing; Romania set at the bloc's
  // lower end (more agrarian than PL/CS, matching Gheorghiu-Dej-era Romania's
  // lower postwar consumption).
  const defaultIncome = is1953 ? 6_100 : 30_000;
  const metrics = makeEasternBlocStateMetrics(
    "RO",
    defaultIncome,
    {
      RO_BUC: {
        medianIncome: is1953 ? 8_200 : 38_000,
        gdpGrowth: is1953 ? 5.5 : 3.2,
        lifeExpectancy: is1953 ? 65 : 70,
        povertyRate: is1953 ? 32 : 22,
        pressFreedom: is1953 ? 5 : 6,
        urbanizationRate: is1953 ? 85 : 92,
      },
      RO_MUN: {
        medianIncome: is1953 ? 6_700 : 32_000,
        gdpGrowth: is1953 ? 5.5 : 3.2, // Ploiești oil belt
        lifeExpectancy: is1953 ? 63 : 69,
        povertyRate: is1953 ? 42 : 30,
        pressFreedom: is1953 ? 5 : 6,
        urbanizationRate: is1953 ? 28 : 42,
      },
      RO_OLT: {
        medianIncome: is1953 ? 5_500 : 27_000,
        gdpGrowth: is1953 ? 4.5 : 2.8,
        lifeExpectancy: is1953 ? 62 : 68,
        povertyRate: is1953 ? 50 : 38,
        urbanizationRate: is1953 ? 24 : 40,
      },
      RO_TRA: {
        medianIncome: is1953 ? 6_700 : 32_000,
        gdpGrowth: is1953 ? 5.0 : 3.0,
        lifeExpectancy: is1953 ? 64 : 70,
        povertyRate: is1953 ? 42 : 30,
        urbanizationRate: is1953 ? 32 : 52,
      },
      RO_VST: {
        medianIncome: is1953 ? 7_000 : 33_000, // Banat historically the wealthiest countryside
        gdpGrowth: is1953 ? 5.0 : 3.0,
        lifeExpectancy: is1953 ? 64 : 70,
        povertyRate: is1953 ? 38 : 28,
        urbanizationRate: is1953 ? 32 : 54,
      },
      RO_MOL: {
        medianIncome: is1953 ? 4_600 : 23_000,
        gdpGrowth: is1953 ? 4.0 : 2.6,
        lifeExpectancy: is1953 ? 61 : 67,
        povertyRate: is1953 ? 58 : 44,
        urbanizationRate: is1953 ? 22 : 38,
      },
      RO_DOB: {
        medianIncome: is1953 ? 5_500 : 28_000, // canal labor camps 1953; Constanța port 1979
        gdpGrowth: is1953 ? 4.5 : 3.0,
        lifeExpectancy: is1953 ? 62 : 68,
        povertyRate: is1953 ? 48 : 34,
        urbanizationRate: is1953 ? 30 : 50,
      },
    },
    is1953 ? "1953" : "1979"
  );
  return {
    countryId: "RO",
    categoryId: "ro_voterGroups",
    regions,
    parties: roParties,
    categories: makeEasternBlocCategories("ro_voterGroups", "Romania Voter Groups"),
    metrics,
    baselines: makeEasternBlocBaselines(metrics),
  };
}

export const roSeedConfig: EasternBlocSeedConfig = getRoSeedConfig("2019-default");
export default roSeedConfig;
