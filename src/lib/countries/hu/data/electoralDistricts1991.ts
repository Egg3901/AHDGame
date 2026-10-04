/**
 * Hungary's 1991 mixed ballot uses 20 territorial lists and 176 constituencies.
 * Statutory constituency/list capacities and filing minima are independent of
 * the historical 1990 seat result. County populations are KSH's January 1990 census.
 * https://njt.jog.gov.hu/jogszabaly/1989-34-00-00.0
 * https://www.ksh.hu/docs/hun/xtabla/oregedes/tablto09_04.html
 */
export interface Hu1991TerritorialDistrict {
  id: string;
  countyCode: string;
  label: string;
  regionId: string;
  constituencySeats: number;
  territorialSeats: number;
  minimumConstituencyNominees: number;
  population: number;
}

export const HU_1991_TERRITORIAL_DISTRICTS: readonly Hu1991TerritorialDistrict[] = [
  {
    id: "HU-territorial-01",
    countyCode: "01",
    label: "Budapest",
    regionId: "HU_BUD",
    constituencySeats: 32,
    territorialSeats: 28,
    minimumConstituencyNominees: 8,
    population: 2016774,
  },
  {
    id: "HU-territorial-02",
    countyCode: "02",
    label: "Baranya",
    regionId: "HU_TRS",
    constituencySeats: 7,
    territorialSeats: 6,
    minimumConstituencyNominees: 2,
    population: 418642,
  },
  {
    id: "HU-territorial-03",
    countyCode: "03",
    label: "Bács-Kiskun",
    regionId: "HU_ALF",
    constituencySeats: 10,
    territorialSeats: 8,
    minimumConstituencyNominees: 2,
    population: 544748,
  },
  {
    id: "HU-territorial-04",
    countyCode: "04",
    label: "Békés",
    regionId: "HU_ALF",
    constituencySeats: 7,
    territorialSeats: 6,
    minimumConstituencyNominees: 2,
    population: 411887,
  },
  {
    id: "HU-territorial-05",
    countyCode: "05",
    label: "Borsod-Abaúj-Zemplén",
    regionId: "HU_NOR",
    constituencySeats: 13,
    territorialSeats: 11,
    minimumConstituencyNominees: 3,
    population: 761963,
  },
  {
    id: "HU-territorial-06",
    countyCode: "06",
    label: "Csongrád",
    regionId: "HU_ALF",
    constituencySeats: 7,
    territorialSeats: 6,
    minimumConstituencyNominees: 2,
    population: 438842,
  },
  {
    id: "HU-territorial-07",
    countyCode: "07",
    label: "Fejér",
    regionId: "HU_TRW",
    constituencySeats: 7,
    territorialSeats: 6,
    minimumConstituencyNominees: 2,
    population: 420628,
  },
  {
    id: "HU-territorial-08",
    countyCode: "08",
    label: "Győr-Moson-Sopron",
    regionId: "HU_TRW",
    constituencySeats: 7,
    territorialSeats: 6,
    minimumConstituencyNominees: 2,
    population: 424439,
  },
  {
    id: "HU-territorial-09",
    countyCode: "09",
    label: "Hajdú-Bihar",
    regionId: "HU_ALF",
    constituencySeats: 9,
    territorialSeats: 8,
    minimumConstituencyNominees: 2,
    population: 548728,
  },
  {
    id: "HU-territorial-10",
    countyCode: "10",
    label: "Heves",
    regionId: "HU_NOR",
    constituencySeats: 6,
    territorialSeats: 5,
    minimumConstituencyNominees: 2,
    population: 334408,
  },
  {
    id: "HU-territorial-11",
    countyCode: "11",
    label: "Komárom-Esztergom",
    regionId: "HU_TRW",
    constituencySeats: 5,
    territorialSeats: 5,
    minimumConstituencyNominees: 2,
    population: 315208,
  },
  {
    id: "HU-territorial-12",
    countyCode: "12",
    label: "Nógrád",
    regionId: "HU_NOR",
    constituencySeats: 4,
    territorialSeats: 4,
    minimumConstituencyNominees: 2,
    population: 227137,
  },
  {
    id: "HU-territorial-13",
    countyCode: "13",
    label: "Pest",
    regionId: "HU_PES",
    constituencySeats: 16,
    territorialSeats: 14,
    minimumConstituencyNominees: 4,
    population: 949749,
  },
  {
    id: "HU-territorial-14",
    countyCode: "14",
    label: "Somogy",
    regionId: "HU_TRS",
    constituencySeats: 6,
    territorialSeats: 5,
    minimumConstituencyNominees: 2,
    population: 344708,
  },
  {
    id: "HU-territorial-15",
    countyCode: "15",
    label: "Szabolcs-Szatmár-Bereg",
    regionId: "HU_ALF",
    constituencySeats: 10,
    territorialSeats: 9,
    minimumConstituencyNominees: 2,
    population: 572301,
  },
  {
    id: "HU-territorial-16",
    countyCode: "16",
    label: "Jász-Nagykun-Szolnok",
    regionId: "HU_ALF",
    constituencySeats: 8,
    territorialSeats: 6,
    minimumConstituencyNominees: 2,
    population: 426491,
  },
  {
    id: "HU-territorial-17",
    countyCode: "17",
    label: "Tolna",
    regionId: "HU_TRS",
    constituencySeats: 5,
    territorialSeats: 4,
    minimumConstituencyNominees: 2,
    population: 253675,
  },
  {
    id: "HU-territorial-18",
    countyCode: "18",
    label: "Vas",
    regionId: "HU_TRW",
    constituencySeats: 5,
    territorialSeats: 4,
    minimumConstituencyNominees: 2,
    population: 275944,
  },
  {
    id: "HU-territorial-19",
    countyCode: "19",
    label: "Veszprém",
    regionId: "HU_TRW",
    constituencySeats: 7,
    territorialSeats: 6,
    minimumConstituencyNominees: 2,
    population: 382153,
  },
  {
    id: "HU-territorial-20",
    countyCode: "20",
    label: "Zala",
    regionId: "HU_TRW",
    constituencySeats: 5,
    territorialSeats: 5,
    minimumConstituencyNominees: 2,
    population: 306398,
  },
];

/** Exact statutory district numbers; within-county population is a bounded equal share. */
export const HU_1991_CONSTITUENCIES = HU_1991_TERRITORIAL_DISTRICTS.flatMap((county) =>
  Array.from({ length: county.constituencySeats }, (_, index) => ({
    id: `HU-constituency-${county.countyCode}-${String(index + 1).padStart(2, "0")}`,
    countyId: county.id,
    countyCode: county.countyCode,
    districtNumber: index + 1,
    regionId: county.regionId,
  }))
);
