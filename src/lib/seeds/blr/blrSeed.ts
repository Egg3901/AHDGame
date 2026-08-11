import type { EasternBlocSeedConfig } from "@/lib/admin/seed/seedEasternBloc";
import { blrRegions } from "./blrRegions";
import { blrRegions1953 } from "./blrRegions1953";
import { blrParties } from "./blrParties";
import { makeEasternBlocCategories } from "@/lib/seeds/shared/easternBlocModel";
import {
  makeEasternBlocStateMetrics,
  makeEasternBlocBaselines,
} from "@/lib/seeds/shared/easternBlocMetrics";

/** Byelorussian SSR seed config — six oblasts in both Cold-War eras.
 *  1953: reconstruction after the worst war damage of any Soviet republic.
 *       Minsk being rebuilt from the foundations, MAZ trucks just stood up,
 *       Soligorsk potash barely into mining, the west still pacifying after the
 *       anti-Soviet partisan war, and the Brest crossing carrying the union's
 *       traffic to Poland.
 *  1979: the union's machine-building and electronics showcase. MAZ/BelAZ/MTZ,
 *       Polatsk and Mazyr refineries on Druzhba crude, potash at full output.
 *       Growth is Soviet-average and slowing.
 *
 *  Every override key must be a region `_id` from blrRegions*.ts (the `BLR_`
 *  codes that also key public/blr-regions.json and src/lib/maps/blrGeometry.ts).
 *  A key that matches no region is silently dropped, which is exactly what the
 *  old `BY_BEL` typo did to this country. */
export function getBlrSeedConfig(preset: string): EasternBlocSeedConfig {
  const is1953 = preset === "1953-default";
  const regions = is1953 ? blrRegions1953 : blrRegions;
  // 1953 rescaled to ~1.3x GDP/capita (SUR 140B / 8.1M = SUR 17,284;
  // #income-gdp-scale-audit): the prior 2,500 implied ratio ~0.145x pre-fix —
  // badly UNDER-scaled (medianIncomeGdpScale1953.test.ts band is [0.8, 2.6]).
  // Scaled up ~9x, in line with the other bloc republics' post-fix ratios.
  // 1953 incomes are pinned to the region-sum GDP basis (SUR 50,000M over 7.7M
  // people = SUR 6,494 a head), not the old SUR 140B budget figure the stub
  // carried. 8,450 is ~1.30x GDP per head, the same multiple Ukraine uses, and
  // sits inside the [0.8, 2.6] band medianIncomeGdpScale1953.test.ts enforces.
  const defaultIncome = is1953 ? 8_450 : 4_000;
  // Per-region incomes are deliberately COMPRESSED against the regional GDP
  // spread: 1953 gdp/head runs from SUR 8,421 in Minsk to SUR 5,000 in Brest
  // (a 1.68x range) but Soviet wages were administered on a union tariff scale,
  // so household income only carries about half that spread. The ordering still
  // follows output — capital, then the industrial east, then the two western
  // oblasts annexed in 1939.
  const metrics = makeEasternBlocStateMetrics(
    "BLR",
    defaultIncome,
    {
      BLR_MIN: {
        medianIncome: is1953 ? 9_700 : 4_600,
        // The capital soaks up union reconstruction capital, so it grows
        // fastest of the six in 1953 and stays above republic average in 1979
        // on the back of automotive and electronics.
        gdpGrowth: is1953 ? 9.0 : 3.4,
        povertyRate: is1953 ? 30 : 6,
        lifeExpectancy: is1953 ? 64 : 71,
        pressFreedom: is1953 ? 4 : 10, // republican party and KGB apparatus sits here
        urbanizationRate: is1953 ? 34 : 68,
        // Byelorussia's 1953 fertility sat below the rural bloc south: the war
        // removed much of the cohort that would have been having children. The
        // capital, absorbing young single labour into barracks housing, is the
        // lowest of the six.
        birthRate: is1953 ? 68 : undefined,
      },
      BLR_HOM: {
        medianIncome: is1953 ? 8_200 : 3_950,
        gdpGrowth: is1953 ? 8.0 : 3.0, // timber and machine tools rebuilding
        povertyRate: is1953 ? 35 : 8,
        lifeExpectancy: is1953 ? 63 : 70,
        urbanizationRate: is1953 ? 27 : 55,
        birthRate: is1953 ? 74 : undefined,
      },
      BLR_VIT: {
        medianIncome: is1953 ? 8_200 : 3_950,
        gdpGrowth: is1953 ? 7.8 : 3.0,
        povertyRate: is1953 ? 36 : 8,
        lifeExpectancy: is1953 ? 63 : 70,
        // Polatsk/Navapolatsk petrochemicals make this the republic's dirtiest
        // oblast by 1979; in 1953 there is nothing there yet to pollute.
        airQuality: is1953 ? 82 : 66,
        urbanizationRate: is1953 ? 25 : 56,
        birthRate: is1953 ? 72 : undefined, // hardest-hit oblast, thinnest parent cohort
      },
      BLR_MOG: {
        medianIncome: is1953 ? 8_250 : 3_900,
        gdpGrowth: is1953 ? 7.5 : 2.8, // slowest of the eastern oblasts
        povertyRate: is1953 ? 36 : 9,
        lifeExpectancy: is1953 ? 63 : 70,
        airQuality: is1953 ? 84 : 70, // synthetic fibre and metallurgy by 1979
        urbanizationRate: is1953 ? 24 : 54,
        birthRate: is1953 ? 74 : undefined,
      },
      BLR_BRE: {
        medianIncome: is1953 ? 7_500 : 3_600,
        // Polish until 1939 and agrarian: it gets the transit corridor, not the
        // investment, so it grows slowest in 1953 despite the border traffic.
        gdpGrowth: is1953 ? 6.5 : 2.6,
        povertyRate: is1953 ? 44 : 12,
        lifeExpectancy: is1953 ? 63 : 71,
        pressFreedom: is1953 ? 3 : 10, // pacification of the western partisan war
        urbanizationRate: is1953 ? 20 : 46,
        birthRate: is1953 ? 84 : undefined, // most rural, highest fertility
      },
      BLR_GRO: {
        medianIncome: is1953 ? 7_900 : 3_550,
        gdpGrowth: is1953 ? 6.5 : 2.6,
        povertyRate: is1953 ? 45 : 13,
        lifeExpectancy: is1953 ? 63 : 71,
        pressFreedom: is1953 ? 3 : 10, // largest Polish and Catholic population
        urbanizationRate: is1953 ? 19 : 44,
        birthRate: is1953 ? 86 : undefined,
      },
    },
    is1953 ? "1953" : "1979"
  );
  return {
    countryId: "BLR",
    categoryId: "blr_voterGroups",
    regions,
    parties: blrParties,
    categories: makeEasternBlocCategories("blr_voterGroups", "Belarus Voter Groups"),
    metrics,
    baselines: makeEasternBlocBaselines(metrics),
  };
}

export const blrSeedConfig: EasternBlocSeedConfig = getBlrSeedConfig("2019-default");
export default blrSeedConfig;
