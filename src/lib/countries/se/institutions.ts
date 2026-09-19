import type { CountryInstitutions } from "../contract";

import {
  SE_CABINET_SEAT_IDS,
  SE_CONFIG,
  SE_MILITARY_BRANCHES,
  SE_MILITARY_SCALE,
  SE_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * Sweden's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no SE row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const SE_INSTITUTIONS: CountryInstitutions = {
  config: SE_CONFIG,
  positions: SE_CABINET_SEAT_IDS,
  military: {
    branches: SE_MILITARY_BRANCHES,
    scale: SE_MILITARY_SCALE,
    ordersOfBattle: SE_ORDERS_OF_BATTLE,
  },
  cabinet: {},
};
