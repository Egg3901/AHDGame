import type { CountryInstitutions } from "../contract";

import {
  FR_CABINET_SEAT_IDS,
  FR_CONFIG,
  FR_MILITARY_BRANCHES,
  FR_MILITARY_SCALE,
  FR_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * France's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no FR row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const FR_INSTITUTIONS: CountryInstitutions = {
  config: FR_CONFIG,
  positions: FR_CABINET_SEAT_IDS,
  military: {
    branches: FR_MILITARY_BRANCHES,
    scale: FR_MILITARY_SCALE,
    ordersOfBattle: FR_ORDERS_OF_BATTLE,
  },
  cabinet: {},
};
