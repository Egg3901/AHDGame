import type { CountryInstitutions } from "../contract";
import { SCO_CABINET_POSITIONS } from "@/lib/constants/scoCabinet";
import { SCO_MINISTERIAL_ORDERS } from "@/lib/constants/scoCabinet";
import {
  SCO_CABINET_SEAT_IDS,
  SCO_CONFIG,
  SCO_MILITARY_BRANCHES,
  SCO_MILITARY_SCALE,
} from "./institutionsFacts";

/**
 * Scotland's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ WHAT IS ABSENT IS ABSENT UPSTREAM, NOT FORGOTTEN. Fields are emitted
 * only where the facts module declares them and the cabinet file exists on disk.
 * Every omission here corresponds to a registry with no SCO row, recorded
 * in the runtime harness's ABSENT_UPSTREAM and checked in both directions.
 */
export const SCO_INSTITUTIONS: CountryInstitutions = {
  config: SCO_CONFIG,
  positions: SCO_CABINET_SEAT_IDS,
  military: {
    branches: SCO_MILITARY_BRANCHES,
    scale: SCO_MILITARY_SCALE,
  },
  cabinet: {
    positions: SCO_CABINET_POSITIONS,
    orders: SCO_MINISTERIAL_ORDERS,
  },
};
