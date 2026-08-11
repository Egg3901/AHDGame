import type { EasternBlocSeedConfig } from "@/lib/admin/seed/seedEasternBloc";
import { uaRegions } from "./uaRegions";
import { uaRegions1953 } from "./uaRegions1953";
import { uaParties } from "./uaParties";
import { makeEasternBlocCategories } from "@/lib/seeds/shared/easternBlocModel";
import {
  makeEasternBlocStateMetrics,
  makeEasternBlocBaselines,
} from "@/lib/seeds/shared/easternBlocMetrics";

/** Ukraine (Ukrainian SSR) seed config.
 *  1953: Stalin's last year. Reconstruction economy - Donbas coal and Dnieper
 *       metallurgy carry the republic, the annexed west is agrarian, Uniate and
 *       still being pacified after the UPA insurgency.
 *  1979: Shcherbytsky era. Majority urban, Russification at its height, Donbas
 *       past its peak and the whole growth curve flattening. */
export function getUaSeedConfig(preset: string): EasternBlocSeedConfig {
  const is1953 = preset === "1953-default";
  const regions = is1953 ? uaRegions1953 : uaRegions;
  // 1953 default income is set against the republic's OWN 1953 GDP per head:
  // SUR 291.667B / 41.0M = SUR 7,114 (#income-gdp-scale-audit; the band in
  // medianIncomeGdpScale1953.test.ts is [0.8, 2.6] of GDP/capita). 9,250 is
  // ~1.30x, the same multiple Belarus and Bulgaria settle on after the audit,
  // which is the right company: a reconstruction economy where wages are
  // administratively compressed and consumer supply is thin, not a Poland with
  // its surviving private plots and higher postwar consumer standard.
  //
  // 1979 sits on the ruble scale the union seed already uses (ruStateMetrics
  // puts its UKR region at SUR 3,900 annual household income), so the per-region
  // spread here is authored around 4,000 rather than re-derived.
  const defaultIncome = is1953 ? 9_250 : 4_000;
  // The ordering that must survive both eras: Donbas and the Dnieper belt lead
  // on income and urbanisation, the west trails on everything and leads on
  // fertility, Podolia is the quiet agrarian floor.
  const metrics = makeEasternBlocStateMetrics(
    "UKR",
    defaultIncome,
    {
      UKR_KYI: {
        medianIncome: is1953 ? 9_600 : 4_200,
        gdpGrowth: is1953 ? 7.5 : 2.2, // reconstruction rebound vs late-Brezhnev stall
        povertyRate: is1953 ? 38 : 10,
        lifeExpectancy: is1953 ? 63 : 70,
        // Republican-branch press, so no independent line either way. 1953 is
        // the Stalinist floor; 1979 is Shcherbytsky, who ran a tighter shop
        // than the satellites (BG 14, PL 18) and tighter than Belarus.
        pressFreedom: is1953 ? 3 : 9,
        urbanizationRate: is1953 ? 32 : 62,
        // Ukraine's 1953 fertility is well below Poland's - the famine of
        // 1946-47 and the war's missing cohorts both bite - but the recovery
        // in births is real. Index set below the PL national ~84.
        birthRate: is1953 ? 74 : undefined,
      },
      UKR_WES: {
        medianIncome: is1953 ? 6_300 : 3_400,
        // Lowest growth: the west got the least plan investment and the most
        // security attention. Collectivisation there only began in 1948 and was
        // still being enforced against armed resistance into the early 1950s,
        // which is a poor setting for output growth.
        gdpGrowth: is1953 ? 5.0 : 2.0,
        povertyRate: is1953 ? 58 : 20,
        lifeExpectancy: is1953 ? 61 : 71, // rural, but also the cleanest air
        pressFreedom: is1953 ? 2 : 8, // the most heavily policed region in both eras
        urbanizationRate: is1953 ? 20 : 44,
        birthRate: is1953 ? 88 : undefined, // Catholic/Uniate west, highest fertility
      },
      UKR_POD: {
        medianIncome: is1953 ? 6_800 : 3_500,
        gdpGrowth: is1953 ? 5.5 : 1.8, // sugar beet and grain; no plan showpiece
        povertyRate: is1953 ? 52 : 18,
        lifeExpectancy: is1953 ? 62 : 71,
        pressFreedom: is1953 ? 3 : 9,
        urbanizationRate: is1953 ? 22 : 42,
        birthRate: is1953 ? 80 : undefined,
      },
      UKR_DON: {
        medianIncome: is1953 ? 10_200 : 4_600, // protected miners' wages, both eras
        // 1953 growth is the fastest in the republic because pithead output was
        // restored at almost any cost. By 1979 the seams are deep and dear and
        // Donbas is the slowest-growing region in Ukraine.
        gdpGrowth: is1953 ? 8.5 : 1.4,
        povertyRate: is1953 ? 26 : 7,
        airQuality: is1953 ? 48 : 62, // coal, coke and metallurgy in one basin
        lifeExpectancy: is1953 ? 60 : 68, // mining, and the shortest lives in Ukraine
        pressFreedom: is1953 ? 3 : 9,
        urbanizationRate: is1953 ? 62 : 86,
        birthRate: is1953 ? 66 : undefined, // most urban and industrial, lowest fertility
      },
      UKR_DNI: {
        medianIncome: is1953 ? 9_800 : 4_400,
        gdpGrowth: is1953 ? 8.0 : 2.0, // DniproHES back on line 1950; ore and steel
        povertyRate: is1953 ? 30 : 8,
        airQuality: is1953 ? 52 : 66, // Zaporizhzhia and Kryvyi Rih
        lifeExpectancy: is1953 ? 61 : 69,
        pressFreedom: is1953 ? 3 : 9,
        urbanizationRate: is1953 ? 52 : 76,
        birthRate: is1953 ? 70 : undefined,
      },
      UKR_SOU: {
        medianIncome: is1953 ? 8_400 : 4_100,
        gdpGrowth: is1953 ? 6.5 : 2.4, // ports and shipyards; irrigation lands later
        povertyRate: is1953 ? 40 : 11,
        lifeExpectancy: is1953 ? 63 : 71, // best climate, lightest industry of the industrial regions
        pressFreedom: is1953 ? 3 : 9,
        urbanizationRate: is1953 ? 40 : 66,
        birthRate: is1953 ? 72 : undefined,
      },
    },
    is1953 ? "1953" : "1979"
  );
  return {
    countryId: "UKR",
    categoryId: "ua_voterGroups",
    regions,
    parties: uaParties,
    categories: makeEasternBlocCategories("ua_voterGroups", "Ukraine Voter Groups"),
    metrics,
    baselines: makeEasternBlocBaselines(metrics),
  };
}

export const uaSeedConfig: EasternBlocSeedConfig = getUaSeedConfig("2019-default");
export default uaSeedConfig;
