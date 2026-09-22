import type { CountryInstitutions } from "../contract";

import {
  PL_CABINET_SEAT_IDS,
  PL_CONFIG,
  PL_MILITARY_BRANCHES,
  PL_MILITARY_SCALE,
  PL_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * Poland's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no PL row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const PL_INSTITUTIONS: CountryInstitutions = {
  config: PL_CONFIG,
  positions: PL_CABINET_SEAT_IDS,
  military: {
    branches: PL_MILITARY_BRANCHES,
    scale: PL_MILITARY_SCALE,
    ordersOfBattle: PL_ORDERS_OF_BATTLE,
  },
  cabinet: {},
};
