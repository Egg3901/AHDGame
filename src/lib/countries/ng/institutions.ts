import type { CountryInstitutions } from "../contract";
import { NG_CABINET_POSITIONS } from "@/lib/constants/ngCabinet";
import { NG_CABINET_MECHANICS } from "@/lib/constants/ngCabinetMechanics";
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
 * ⚠️ NO `orders`, NO `estatePortfolio` AND NO `legislativeProcess`. Nigeria
 * has no row in `ORDERS_BY_COUNTRY` (10 keys), `ESTATE_PORTFOLIO_BY_COUNTRY`
 * (8 keys) or `LEGISLATIVE_PROCESS` (6 keys), and there is no `ngCabinetOrders.ts`
 * to point at. `getMinisterialOrders` returns `[]`, `seedCabinetEstates` skips
 * the country, and bill readers fall through to `DEFAULT_PROCESS` -- all three
 * predate this folder.
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
