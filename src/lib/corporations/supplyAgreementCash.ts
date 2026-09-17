/**
 * Last-turn supply-agreement cash for one corporation.
 *
 * Settlement is a contract-for-difference layered on top of ordinary P&L, so
 * `realizedIncome` never includes it. Financials has to name this number or a
 * CEO watching healthy income and flat liquid capital cannot diagnose the
 * debit (ticket 1326 / issue #2019).
 */

export type SupplyAgreementCashRow = {
  supplierCorpId: { toString(): string } | string;
  buyerCorpId: { toString(): string } | string;
  lastDeliveryTurn?: number;
  lastSupplierCashDelta?: number;
  lastBuyerCashDelta?: number;
  lastUnpaidSettlementAnchor?: number;
};

export function lastTurnSupplyAgreementCash(args: {
  corpId: string;
  turn: number;
  agreements: readonly SupplyAgreementCashRow[];
}): { netLocal: number; unpaidAnchor: number } {
  let netLocal = 0;
  let unpaidAnchor = 0;
  for (const agreement of args.agreements) {
    if (agreement.lastDeliveryTurn !== args.turn) continue;
    const supplierId = String(agreement.supplierCorpId);
    const buyerId = String(agreement.buyerCorpId);
    const isSupplier = supplierId === args.corpId;
    const isBuyer = buyerId === args.corpId;
    if (!isSupplier && !isBuyer) continue;
    if (isSupplier) netLocal += agreement.lastSupplierCashDelta ?? 0;
    if (isBuyer) netLocal += agreement.lastBuyerCashDelta ?? 0;
    unpaidAnchor += Math.max(0, agreement.lastUnpaidSettlementAnchor ?? 0);
  }
  return { netLocal, unpaidAnchor };
}
