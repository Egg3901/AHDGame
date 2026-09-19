import type { CountryInstitutions } from "../contract";

import {
  ES_CABINET_SEAT_IDS,
  ES_CONFIG,
  ES_MILITARY_BRANCHES,
  ES_MILITARY_SCALE,
  ES_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * Spain's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no ES row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const ES_INSTITUTIONS: CountryInstitutions = {
  config: ES_CONFIG,
  positions: ES_CABINET_SEAT_IDS,
  military: {
    branches: ES_MILITARY_BRANCHES,
    scale: ES_MILITARY_SCALE,
    ordersOfBattle: ES_ORDERS_OF_BATTLE,
  },
  cabinet: {},
};
