import type { CountryInstitutions } from "../contract";

import {
  CS_CABINET_SEAT_IDS,
  CS_CONFIG,
  CS_MILITARY_BRANCHES,
  CS_MILITARY_SCALE,
  CS_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * Czechoslovakia's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no CS row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const CS_INSTITUTIONS: CountryInstitutions = {
  config: CS_CONFIG,
  positions: CS_CABINET_SEAT_IDS,
  military: {
    branches: CS_MILITARY_BRANCHES,
    scale: CS_MILITARY_SCALE,
    ordersOfBattle: CS_ORDERS_OF_BATTLE,
  },
  cabinet: {},
};
