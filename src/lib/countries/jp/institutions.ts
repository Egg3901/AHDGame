import type { CountryInstitutions } from "../contract";
import { JP_CABINET_POSITIONS } from "./cabinet/positions";
import { JP_MINISTERIAL_ORDERS } from "./cabinet/orders";
import { JP_CABINET_MECHANICS } from "./cabinet/mechanics";
import {
  JP_CABINET_SEAT_IDS,
  JP_CONFIG,
  JP_ESTATE_PORTFOLIO,
  JP_LEGISLATIVE_PROCESS,
  JP_MILITARY_BRANCHES,
  JP_MILITARY_SCALE,
  JP_ORDERS_OF_BATTLE,
  JP_REGIONAL_BILL_ASSENT_OFFICE_KEY,
} from "./institutionsFacts";

/**
 * Japan's institutions. Phase D3, re-split in D7.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`, NOT HERE. This module composes
 * them with the cabinet, and the cabinet is heavy: `mechanics` alone is 28 KB.
 * Registries that need one seat id or the legislative process must import from
 * `./institutionsFacts`, never from here, or they ship the cabinet to the
 * browser. `clientSafeLeafModules.test.ts` enforces that.
 *
 * ORDERS_BY_COUNTRY.JP *is* JP_MINISTERIAL_ORDERS and MECHANICS_BY_COUNTRY.JP
 * *is* JP_CABINET_MECHANICS -- those registries forward to the same modules
 * composed here, so there is exactly one copy of each.
 */
export const JP_INSTITUTIONS: CountryInstitutions = {
  config: JP_CONFIG,
  legislativeProcess: JP_LEGISLATIVE_PROCESS,
  regionalBillAssentOfficeKey: JP_REGIONAL_BILL_ASSENT_OFFICE_KEY,
  positions: JP_CABINET_SEAT_IDS,
  estatePortfolio: JP_ESTATE_PORTFOLIO,
  military: {
    branches: JP_MILITARY_BRANCHES,
    scale: JP_MILITARY_SCALE,
    ordersOfBattle: JP_ORDERS_OF_BATTLE,
  },
  cabinet: {
    positions: JP_CABINET_POSITIONS,
    orders: JP_MINISTERIAL_ORDERS,
    mechanics: JP_CABINET_MECHANICS,
    groups: {
      chief_cabinet_secretary: "Centre",
      finance_minister: "Economy",
      economy_minister: "Economy",
      foreign_affairs_minister: "Security & Foreign",
      justice_minister: "Security & Foreign",
      defense_minister: "Security & Foreign",
      health_minister: "Society",
      education_minister: "Society",
      land_minister: "Domestic",
      environment_minister: "Domestic",
      internal_affairs_minister: "Domestic",
    },
  },
};
