import type { CountryInstitutions } from "../contract";
import { DE_CABINET_POSITIONS } from "@/lib/constants/deCabinet";
import { DE_MINISTERIAL_ORDERS } from "@/lib/constants/deCabinetOrders";
import { DE_CABINET_MECHANICS } from "@/lib/constants/deCabinetMechanics";
import {
  DE_CABINET_GROUPS,
  DE_CABINET_SEAT_IDS,
  DE_CONFIG,
  DE_ESTATE_PORTFOLIO,
  DE_LEGISLATIVE_PROCESS,
  DE_MILITARY_BRANCHES,
  DE_MILITARY_SCALE,
  DE_ORDERS_OF_BATTLE,
  DE_REGIONAL_BILL_ASSENT_OFFICE_KEY,
} from "./institutionsFacts";

/**
 * Germany's institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`. This composes them with the
 * cabinet, which is heavy; a registry wanting one seat id imports the facts
 * module or it ships the whole cabinet to the browser.
 */
export const DE_INSTITUTIONS: CountryInstitutions = {
  config: DE_CONFIG,
  legislativeProcess: DE_LEGISLATIVE_PROCESS,
  regionalBillAssentOfficeKey: DE_REGIONAL_BILL_ASSENT_OFFICE_KEY,
  positions: DE_CABINET_SEAT_IDS,
  estatePortfolio: DE_ESTATE_PORTFOLIO,
  military: {
    branches: DE_MILITARY_BRANCHES,
    scale: DE_MILITARY_SCALE,
    ordersOfBattle: DE_ORDERS_OF_BATTLE,
  },
  cabinet: {
    positions: DE_CABINET_POSITIONS,
    orders: DE_MINISTERIAL_ORDERS,
    mechanics: DE_CABINET_MECHANICS,
    groups: DE_CABINET_GROUPS,
  },
};
