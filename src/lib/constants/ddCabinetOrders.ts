/**
 * East Germany (DD) ministerial orders.
 *
 * DD's cabinet position IDs mirror RU's one-for-one (see ddCabinet.ts), so DD
 * reuses RU_MINISTERIAL_ORDERS verbatim, remapping only the head-of-government
 * key (RU `premier` → DD `generalSecretary`). This is the same reuse the
 * mechanics take in ddCabinetMechanics.ts, and it keeps DD from drifting.
 */
import type { MinisterialOrderConfig } from "./cabinetMechanicsTypes";
import { RU_MINISTERIAL_ORDERS } from "./ruCabinetOrders";

const { premier, ...sharedCouncilOrders } = RU_MINISTERIAL_ORDERS;

export const DD_MINISTERIAL_ORDERS: Record<string, MinisterialOrderConfig[]> = {
  generalSecretary: premier,
  ...sharedCouncilOrders,
};
