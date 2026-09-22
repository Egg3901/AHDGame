import type { CountryInstitutions } from "../contract";

import {
  TR_CABINET_SEAT_IDS,
  TR_CONFIG,
  TR_MILITARY_BRANCHES,
  TR_MILITARY_SCALE,
  TR_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * Turkey's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no TR row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const TR_INSTITUTIONS: CountryInstitutions = {
  config: TR_CONFIG,
  positions: TR_CABINET_SEAT_IDS,
  military: {
    branches: TR_MILITARY_BRANCHES,
    scale: TR_MILITARY_SCALE,
    ordersOfBattle: TR_ORDERS_OF_BATTLE,
  },
  cabinet: {},
};
