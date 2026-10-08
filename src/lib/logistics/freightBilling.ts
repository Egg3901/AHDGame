/**
 * Freight billing splits state haul costs and income by physical buyer and
 * supplier shares. The portable allocation rules live in rules/freightBilling.
 */
export {
  apportionFreightBilling,
  FREIGHT_BILL_MAX_SHARE_OF_GOODS_VALUE,
  type FreightBillingApportionment,
  type FreightBillingSectorUnits,
} from "./rules/freightBilling";
