import type { CountryInstitutions } from "../contract";

import {
  BG_CABINET_SEAT_IDS,
  BG_CONFIG,
  BG_MILITARY_BRANCHES,
  BG_MILITARY_SCALE,
  BG_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * Bulgaria's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no BG row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const BG_INSTITUTIONS: CountryInstitutions = {
  config: BG_CONFIG,
  positions: BG_CABINET_SEAT_IDS,
  military: {
    branches: BG_MILITARY_BRANCHES,
    scale: BG_MILITARY_SCALE,
    ordersOfBattle: BG_ORDERS_OF_BATTLE,
  },
  cabinet: {},
};
