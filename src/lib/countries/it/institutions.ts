import type { CountryInstitutions } from "../contract";

import {
  IT_CABINET_SEAT_IDS,
  IT_CONFIG,
  IT_MILITARY_BRANCHES,
  IT_MILITARY_SCALE,
  IT_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * Italy's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no IT row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const IT_INSTITUTIONS: CountryInstitutions = {
  config: IT_CONFIG,
  positions: IT_CABINET_SEAT_IDS,
  military: {
    branches: IT_MILITARY_BRANCHES,
    scale: IT_MILITARY_SCALE,
    ordersOfBattle: IT_ORDERS_OF_BATTLE,
  },
  cabinet: {},
};
