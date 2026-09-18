import type { CountryInstitutions } from "../contract";
import { DD_CABINET_POSITIONS } from "@/lib/constants/ddCabinet";
import { DD_MINISTERIAL_ORDERS } from "@/lib/constants/ddCabinetOrders";
import { DD_CABINET_MECHANICS } from "@/lib/constants/ddCabinetMechanics";
import {
  DD_CABINET_SEAT_IDS,
  DD_CONFIG,
  DD_ESTATE_PORTFOLIO,
  DD_MILITARY_BRANCHES,
  DD_MILITARY_SCALE,
  DD_ORDERS_OF_BATTLE,
  DD_REGIONAL_BILL_ASSENT_OFFICE_KEY,
} from "./institutionsFacts";

/**
 * East Germany's institutions.
 *
 * ⚠️ NO `legislativeProcess` AND NO CABINET `groups`. Neither registry has
 * a DD row: readers fall through to `DEFAULT_PROCESS` and to "Centre" per
 * position respectively. Both fallbacks predate this folder, and writing them
 * in here would turn them into authored choices.
 */
export const DD_INSTITUTIONS: CountryInstitutions = {
  config: DD_CONFIG,
  regionalBillAssentOfficeKey: DD_REGIONAL_BILL_ASSENT_OFFICE_KEY,
  positions: DD_CABINET_SEAT_IDS,
  estatePortfolio: DD_ESTATE_PORTFOLIO,
  military: {
    branches: DD_MILITARY_BRANCHES,
    scale: DD_MILITARY_SCALE,
    ordersOfBattle: DD_ORDERS_OF_BATTLE,
  },
  cabinet: {
    positions: DD_CABINET_POSITIONS,
    orders: DD_MINISTERIAL_ORDERS,
    mechanics: DD_CABINET_MECHANICS,
  },
};
