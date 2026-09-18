import type { CountryInstitutions } from "../contract";

import {
  BAL_CABINET_SEAT_IDS,
  BAL_CONFIG,
  BAL_MILITARY_BRANCHES,
  BAL_MILITARY_SCALE,
  BAL_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * the Baltic States's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no BAL row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const BAL_INSTITUTIONS: CountryInstitutions = {
  config: BAL_CONFIG,
  positions: BAL_CABINET_SEAT_IDS,
  military: {
    branches: BAL_MILITARY_BRANCHES,
    scale: BAL_MILITARY_SCALE,
    ordersOfBattle: BAL_ORDERS_OF_BATTLE,
  },
  cabinet: {},
};
