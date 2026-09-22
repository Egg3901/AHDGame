import type { CountryInstitutions } from "../contract";
import { IE_CABINET_POSITIONS } from "@/lib/constants/ieCabinet";
import { IE_MINISTERIAL_ORDERS } from "@/lib/constants/ieCabinetOrders";
import { IE_CABINET_MECHANICS } from "@/lib/constants/ieCabinetMechanics";
import {
  IE_CABINET_GROUPS,
  IE_CABINET_SEAT_IDS,
  IE_CONFIG,
  IE_ESTATE_PORTFOLIO,
  IE_LEGISLATIVE_PROCESS,
  IE_MILITARY_BRANCHES,
  IE_MILITARY_SCALE,
  IE_ORDERS_OF_BATTLE,
  IE_REGIONAL_BILL_ASSENT_OFFICE_KEY,
} from "./institutionsFacts";

/**
 * Ireland's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 */
export const IE_INSTITUTIONS: CountryInstitutions = {
  config: IE_CONFIG,
  legislativeProcess: IE_LEGISLATIVE_PROCESS,
  regionalBillAssentOfficeKey: IE_REGIONAL_BILL_ASSENT_OFFICE_KEY,
  positions: IE_CABINET_SEAT_IDS,
  estatePortfolio: IE_ESTATE_PORTFOLIO,
  military: {
    branches: IE_MILITARY_BRANCHES,
    scale: IE_MILITARY_SCALE,
    ordersOfBattle: IE_ORDERS_OF_BATTLE,
  },
  cabinet: {
    positions: IE_CABINET_POSITIONS,
    orders: IE_MINISTERIAL_ORDERS,
    mechanics: IE_CABINET_MECHANICS,
    groups: IE_CABINET_GROUPS,
  },
};
