import type { CountryInstitutions } from "../contract";

import {
  YU_CABINET_SEAT_IDS,
  YU_CONFIG,
  YU_MILITARY_BRANCHES,
  YU_MILITARY_SCALE,
  YU_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * Yugoslavia's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no YU row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const YU_INSTITUTIONS: CountryInstitutions = {
  config: YU_CONFIG,
  positions: YU_CABINET_SEAT_IDS,
  military: {
    branches: YU_MILITARY_BRANCHES,
    scale: YU_MILITARY_SCALE,
    ordersOfBattle: YU_ORDERS_OF_BATTLE,
  },
  cabinet: {},
};
