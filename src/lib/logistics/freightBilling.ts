/**
 * Freight billing splits state haul costs and income by physical buyer and
 * supplier shares. The portable allocation rules live in rules/freightBilling.
 */
export {
  apportionFreightBilling,
  type FreightBillingApportionment,
  type FreightBillingSectorUnits,
} from "./rules/freightBilling";
