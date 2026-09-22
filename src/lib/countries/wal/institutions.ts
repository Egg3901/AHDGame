import type { CountryInstitutions } from "../contract";
import { WAL_CABINET_POSITIONS } from "@/lib/constants/walCabinet";
import { WAL_MINISTERIAL_ORDERS } from "@/lib/constants/walCabinet";
import {
  WAL_CABINET_SEAT_IDS,
  WAL_CONFIG,
  WAL_MILITARY_BRANCHES,
  WAL_MILITARY_SCALE,
} from "./institutionsFacts";

/**
 * Wales's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no WAL row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const WAL_INSTITUTIONS: CountryInstitutions = {
  config: WAL_CONFIG,
  positions: WAL_CABINET_SEAT_IDS,
  military: {
    branches: WAL_MILITARY_BRANCHES,
    scale: WAL_MILITARY_SCALE,
  },
  cabinet: {
    positions: WAL_CABINET_POSITIONS,
    orders: WAL_MINISTERIAL_ORDERS,
  },
};
