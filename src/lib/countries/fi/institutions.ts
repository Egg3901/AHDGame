import type { CountryInstitutions } from "../contract";

import {
  FI_CABINET_SEAT_IDS,
  FI_CONFIG,
  FI_MILITARY_BRANCHES,
  FI_MILITARY_SCALE,
  FI_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * Finland's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no FI row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const FI_INSTITUTIONS: CountryInstitutions = {
  config: FI_CONFIG,
  positions: FI_CABINET_SEAT_IDS,
  military: {
    branches: FI_MILITARY_BRANCHES,
    scale: FI_MILITARY_SCALE,
    ordersOfBattle: FI_ORDERS_OF_BATTLE,
  },
  cabinet: {},
};
