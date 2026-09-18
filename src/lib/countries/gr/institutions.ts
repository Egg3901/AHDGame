import type { CountryInstitutions } from "../contract";

import {
  GR_CABINET_SEAT_IDS,
  GR_CONFIG,
  GR_MILITARY_BRANCHES,
  GR_MILITARY_SCALE,
  GR_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * Greece's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no GR row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const GR_INSTITUTIONS: CountryInstitutions = {
  config: GR_CONFIG,
  positions: GR_CABINET_SEAT_IDS,
  military: {
    branches: GR_MILITARY_BRANCHES,
    scale: GR_MILITARY_SCALE,
    ordersOfBattle: GR_ORDERS_OF_BATTLE,
  },
  cabinet: {},
};
