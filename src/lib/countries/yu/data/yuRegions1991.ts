import type { State } from "@/lib/db/types";
import { SUCCESSOR_REGIONS_1991 } from "@/lib/seeds/reference/successorRegions1991";
import { YU_1991_ESTIMATED_REGION_GDP_YUD } from "@/lib/seeds/reference/yuRegionalGdp1991";

/**
 * January 1991 SFRY regions. GDP is a census/output reconstruction, stored in
 * millions of the circulating YUD. The Federal Chamber assigned 30 delegates
 * per republic and 20 per autonomous province; the Chamber of Republics and
 * Provinces assigned 12 and 8 respectively. Those allocations come from the
 * 1974 constitution still in force at the scenario start:
 * https://digitallibrary.un.org/record/35750/files/CERD_C_91_Add-22-EN.pdf
 * https://digitallibrary.un.org/record/83903/files/CERD_C_118_Add-23-EN.pdf
 */
export const yuRegions1991: State[] = SUCCESSOR_REGIONS_1991.YU.map((region) => {
  const province = region._id === "YU_VOJ" || region._id === "YU_KOS";
  return {
    ...region,
    gdp: YU_1991_ESTIMATED_REGION_GDP_YUD[region._id] / 1_000_000,
    houseDistricts: province ? 20 : 30,
    stateSenateSeats: province ? 8 : 12,
    votingSystem: "fptp",
  };
});
