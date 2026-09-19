import type { CountryInstitutions } from "../contract";

import {
  BR_CABINET_SEAT_IDS,
  BR_CONFIG,
  BR_MILITARY_BRANCHES,
  BR_MILITARY_SCALE,
  BR_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * Brazil's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no BR row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const BR_INSTITUTIONS: CountryInstitutions = {
  config: BR_CONFIG,
  positions: BR_CABINET_SEAT_IDS,
  military: {
    branches: BR_MILITARY_BRANCHES,
    scale: BR_MILITARY_SCALE,
    ordersOfBattle: BR_ORDERS_OF_BATTLE,
  },
  cabinet: {},
};
