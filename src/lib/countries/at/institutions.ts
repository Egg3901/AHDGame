import type { CountryInstitutions } from "../contract";

import {
  AT_CABINET_SEAT_IDS,
  AT_CONFIG,
  AT_MILITARY_BRANCHES,
  AT_MILITARY_SCALE,
  AT_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * Austria's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no AT row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const AT_INSTITUTIONS: CountryInstitutions = {
  config: AT_CONFIG,
  positions: AT_CABINET_SEAT_IDS,
  military: {
    branches: AT_MILITARY_BRANCHES,
    scale: AT_MILITARY_SCALE,
    ordersOfBattle: AT_ORDERS_OF_BATTLE,
  },
  cabinet: {},
};
