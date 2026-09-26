import type { State } from "@/lib/db/types";
import { trRegions } from "./trRegions";

/**
 * 1990 census population in Turkey's seven geographic regions. Ankara province
 * is split from Central Anatolia to match the existing simulation region IDs.
 * The 1990 census gives Ankara 3,236,378 and Central Anatolia 9,913,306.
 * Source: Union of Municipalities of Türkiye, 1990 General Population Census
 * definitive results, https://www.tbb.gov.tr/sites/default/files/online/dergiler/2002_ocak/files/basic-html/page7.html
 * The 1990 national total is also confirmed by TÜİK's census series.
 * GDP weights remain from the existing bundle and are reconciled to the
 * 1991 national budget at bootstrap. The Senate was abolished in 1980.
 */
export const TR_1991_REGION_POPULATION: Readonly<Record<string, number>> = {
  TR_IST: 13_295_878,
  TR_ANK: 3_236_378,
  TR_IZM: 7_594_977,
  TR_MED: 7_026_489,
  TR_BLA: 8_136_713,
  TR_ESA: 5_348_512,
  TR_SEA: 5_157_160,
  TR_CEN: 6_676_928,
};

export const trRegions1991: State[] = trRegions.map((region) => ({
  ...region,
  population: TR_1991_REGION_POPULATION[region._id],
  stateSenateSeats: 0,
}));
