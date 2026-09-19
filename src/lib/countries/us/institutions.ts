import type { CountryInstitutions } from "../contract";
import { CABINET_POSITIONS } from "./cabinet/positions";
import { US_MINISTERIAL_ORDERS } from "./cabinet/orders";
import { US_CABINET_MECHANICS } from "./cabinet/mechanics";
import {
  US_CABINET_GROUPS,
  US_CABINET_SEAT_IDS,
  US_CONFIG,
  US_ESTATE_PORTFOLIO,
  US_LEGISLATIVE_PROCESS,
  US_MILITARY_BRANCHES,
  US_MILITARY_SCALE,
  US_ORDERS_OF_BATTLE,
  US_REGIONAL_BILL_ASSENT_OFFICE_KEY,
} from "./institutionsFacts";

/**
 * The United States' institutions.
 *
 * ⚠️ THE FACTS LIVE IN `./institutionsFacts`, NOT HERE. This module composes them
 * with the cabinet, and the cabinet is heavy: `mechanics` alone is 1,915 lines.
 * A registry that needs one seat id or the legislative process must import from
 * `./institutionsFacts`, never from here, or it ships the whole cabinet to the
 * browser. `clientSafeLeafModules.test.ts` enforces that.
 *
 * ⚠️ `MECHANICS_BY_COUNTRY.US` *is* `US_CABINET_MECHANICS` and
 * `ORDERS_BY_COUNTRY.US` *is* `US_MINISTERIAL_ORDERS` -- those registries
 * forward to the same modules composed here, so there is exactly one copy of
 * each rather than a second source of 2,232 lines.
 *
 * ⚠️ `CABINET_POSITIONS` KEEPS ITS UNPREFIXED NAME. Every other country exports
 * `UK_CABINET_POSITIONS`, `JP_CABINET_POSITIONS` and so on; the US had the bare
 * name because it is the default country, and twelve API routes read it through
 * the `@/lib/constants` barrel. Renaming it is a separate change from moving it,
 * and doing both at once would have hidden one in the other.
 */
export const US_INSTITUTIONS: CountryInstitutions = {
  config: US_CONFIG,
  legislativeProcess: US_LEGISLATIVE_PROCESS,
  regionalBillAssentOfficeKey: US_REGIONAL_BILL_ASSENT_OFFICE_KEY,
  positions: US_CABINET_SEAT_IDS,
  estatePortfolio: US_ESTATE_PORTFOLIO,
  military: {
    branches: US_MILITARY_BRANCHES,
    scale: US_MILITARY_SCALE,
    ordersOfBattle: US_ORDERS_OF_BATTLE,
  },
  cabinet: {
    positions: CABINET_POSITIONS,
    orders: US_MINISTERIAL_ORDERS,
    mechanics: US_CABINET_MECHANICS,
    groups: US_CABINET_GROUPS,
  },
};
