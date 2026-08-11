/**
 * Country-agnostic ministerial orders barrel.
 * Routes to the correct per-country order config by countryId.
 */
import type { CountryId } from "./countries";
import type { MinisterialOrderConfig } from "./cabinetMechanicsTypes";
import { DE_MINISTERIAL_ORDERS } from "./deCabinetOrders";
import { IE_MINISTERIAL_ORDERS } from "./ieCabinetOrders";
import { JP_MINISTERIAL_ORDERS } from "./jpCabinetOrders";
import { UK_MINISTERIAL_ORDERS } from "./ukCabinetOrders";
import { US_MINISTERIAL_ORDERS } from "./usCabinetOrders";
import { CN_MINISTERIAL_ORDERS } from "./cnCabinetOrders";
import { RU_MINISTERIAL_ORDERS } from "./ruCabinetOrders";
import { DD_MINISTERIAL_ORDERS } from "./ddCabinetOrders";
import { SCO_MINISTERIAL_ORDERS } from "./scoCabinet";
import { WAL_MINISTERIAL_ORDERS } from "./walCabinet";

export type { MinisterialOrderConfig } from "./cabinetMechanicsTypes";
export {
  MINISTERIAL_ACTION_CAP,
  MINISTERIAL_ACTION_REGEN_INTERVAL,
  DEFAULT_ORDER_DURATION,
} from "./cabinetMechanicsTypes";

const ORDERS_BY_COUNTRY: Record<string, Record<string, MinisterialOrderConfig[]>> = {
  DE: DE_MINISTERIAL_ORDERS,
  IE: IE_MINISTERIAL_ORDERS,
  UK: UK_MINISTERIAL_ORDERS,
  US: US_MINISTERIAL_ORDERS,
  JP: JP_MINISTERIAL_ORDERS,
  CN: CN_MINISTERIAL_ORDERS,
  RU: RU_MINISTERIAL_ORDERS,
  DD: DD_MINISTERIAL_ORDERS,
  SCO: SCO_MINISTERIAL_ORDERS,
  WAL: WAL_MINISTERIAL_ORDERS,
};

/** Get ministerial orders for a position in a country. */
export function getMinisterialOrders(
  countryId: CountryId | string,
  positionId: string
): MinisterialOrderConfig[] {
  return ORDERS_BY_COUNTRY[countryId]?.[positionId] ?? [];
}
