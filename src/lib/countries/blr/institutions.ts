import type { CountryInstitutions } from "../contract";

import {
  BLR_CABINET_SEAT_IDS,
  BLR_CONFIG,
  BLR_MILITARY_BRANCHES,
  BLR_MILITARY_SCALE,
  BLR_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * Belarus's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no BLR row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const BLR_INSTITUTIONS: CountryInstitutions = {
  config: BLR_CONFIG,
  positions: BLR_CABINET_SEAT_IDS,
  military: {
    branches: BLR_MILITARY_BRANCHES,
    scale: BLR_MILITARY_SCALE,
    ordersOfBattle: BLR_ORDERS_OF_BATTLE,
  },
  cabinet: {},
};
