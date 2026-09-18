import type { CountryInstitutions } from "../contract";
import { RU_CABINET_POSITIONS } from "@/lib/constants/ruCabinet";
import { RU_MINISTERIAL_ORDERS } from "@/lib/constants/ruCabinetOrders";
import { RU_CABINET_MECHANICS } from "@/lib/constants/ruCabinetMechanics";
import {
  RU_CABINET_GROUPS,
  RU_CABINET_SEAT_IDS,
  RU_CONFIG,
  RU_ESTATE_PORTFOLIO,
  RU_MILITARY_BRANCHES,
  RU_MILITARY_SCALE,
  RU_ORDERS_OF_BATTLE,
} from "./institutionsFacts";

/**
 * Russia's institutions.
 *
 * ⚠️ NO `legislativeProcess`, AND THAT IS THE FINDING THIS COUNTRY BROUGHT.
 * `LEGISLATIVE_PROCESS` holds six keys -- exactly the six countries converted
 * before this one -- and Russia is not among them; readers fall through to
 * `DEFAULT_PROCESS`. The field was required on the contract only because the
 * first cohort all happened to have it. Writing the default in here would say
 * Russia authored a process it never did.
 */
export const RU_INSTITUTIONS: CountryInstitutions = {
  config: RU_CONFIG,
  positions: RU_CABINET_SEAT_IDS,
  estatePortfolio: RU_ESTATE_PORTFOLIO,
  military: {
    branches: RU_MILITARY_BRANCHES,
    scale: RU_MILITARY_SCALE,
    ordersOfBattle: RU_ORDERS_OF_BATTLE,
  },
  cabinet: {
    positions: RU_CABINET_POSITIONS,
    orders: RU_MINISTERIAL_ORDERS,
    mechanics: RU_CABINET_MECHANICS,
    groups: RU_CABINET_GROUPS,
  },
};
