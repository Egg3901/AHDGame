import type { CountryInstitutions } from "../contract";

import {
  UKR_CABINET_SEAT_IDS,
  UKR_CONFIG,
  UKR_MILITARY_BRANCHES,
  UKR_MILITARY_SCALE,
  UKR_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * Ukraine's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no UKR row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const UKR_INSTITUTIONS: CountryInstitutions = {
  config: UKR_CONFIG,
  positions: UKR_CABINET_SEAT_IDS,
  military: {
    branches: UKR_MILITARY_BRANCHES,
    scale: UKR_MILITARY_SCALE,
    ordersOfBattle: UKR_ORDERS_OF_BATTLE,
  },
  cabinet: {},
};
