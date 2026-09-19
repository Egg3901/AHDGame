import type { CountryInstitutions } from "../contract";

import {
  RO_CABINET_SEAT_IDS,
  RO_CONFIG,
  RO_MILITARY_BRANCHES,
  RO_MILITARY_SCALE,
  RO_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * Romania's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no RO row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const RO_INSTITUTIONS: CountryInstitutions = {
  config: RO_CONFIG,
  positions: RO_CABINET_SEAT_IDS,
  military: {
    branches: RO_MILITARY_BRANCHES,
    scale: RO_MILITARY_SCALE,
    ordersOfBattle: RO_ORDERS_OF_BATTLE,
  },
  cabinet: {},
};
