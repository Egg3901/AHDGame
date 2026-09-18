import type { CountryInstitutions } from "../contract";
import { CN_CABINET_POSITIONS } from "@/lib/constants/cnCabinet";
import { CN_MINISTERIAL_ORDERS } from "@/lib/constants/cnCabinetOrders";
import { CN_CABINET_MECHANICS } from "@/lib/constants/cnCabinetMechanics";
import {
  CN_CABINET_GROUPS,
  CN_CABINET_SEAT_IDS,
  CN_CONFIG,
  CN_ESTATE_PORTFOLIO,
  CN_LEGISLATIVE_PROCESS,
  CN_MILITARY_BRANCHES,
  CN_MILITARY_SCALE,
  CN_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * China's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 *
 * ⚠️ NO `regionalBillAssentOfficeKey`, AND THAT IS THE DATA. Germany names
 * `ministerPresident`; China has no row in REGIONAL_BILL_ASSENT_OFFICE_KEY at
 * all. The field is optional in the contract precisely so the absence can be
 * carried as an absence rather than defaulted to another country's office.
 */
export const CN_INSTITUTIONS: CountryInstitutions = {
  config: CN_CONFIG,
  legislativeProcess: CN_LEGISLATIVE_PROCESS,
  positions: CN_CABINET_SEAT_IDS,
  estatePortfolio: CN_ESTATE_PORTFOLIO,
  military: {
    branches: CN_MILITARY_BRANCHES,
    scale: CN_MILITARY_SCALE,
    ordersOfBattle: CN_ORDERS_OF_BATTLE,
  },
  cabinet: {
    positions: CN_CABINET_POSITIONS,
    orders: CN_MINISTERIAL_ORDERS,
    mechanics: CN_CABINET_MECHANICS,
    groups: CN_CABINET_GROUPS,
  },
};
