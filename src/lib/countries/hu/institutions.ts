import type { CountryInstitutions } from "../contract";

import {
  HU_CABINET_SEAT_IDS,
  HU_CONFIG,
  HU_MILITARY_BRANCHES,
  HU_MILITARY_SCALE,
  HU_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * Hungary's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no HU row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const HU_INSTITUTIONS: CountryInstitutions = {
  config: HU_CONFIG,
  positions: HU_CABINET_SEAT_IDS,
  military: {
    branches: HU_MILITARY_BRANCHES,
    scale: HU_MILITARY_SCALE,
    ordersOfBattle: HU_ORDERS_OF_BATTLE,
  },
  cabinet: {},
};
