import type { CountryInstitutions } from "../contract";
import { NG_CABINET_POSITIONS } from "./cabinet/ngCabinet";
import { NG_CABINET_MECHANICS } from "./cabinet/ngCabinetMechanics";
import {
  NG_CABINET_GROUPS,
  NG_CABINET_SEAT_IDS,
  NG_CONFIG,
  NG_MILITARY_BRANCHES,
  NG_MILITARY_SCALE,
  NG_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * Nigeria's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no NG row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const NG_INSTITUTIONS: CountryInstitutions = {
  config: NG_CONFIG,
  positions: NG_CABINET_SEAT_IDS,
  military: {
    branches: NG_MILITARY_BRANCHES,
    scale: NG_MILITARY_SCALE,
    ordersOfBattle: NG_ORDERS_OF_BATTLE,
  },
  cabinet: {
    positions: NG_CABINET_POSITIONS,
    mechanics: NG_CABINET_MECHANICS,
    groups: NG_CABINET_GROUPS,
  },
};
