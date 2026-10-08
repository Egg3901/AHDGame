/**
 * CEO cash arrears show completed repayments separately from income.
 * summarizeArrears restates operating and tax balances into the corporation's
 * currency without changing the underlying obligations or period scaling.
 */
export interface ArrearsReceipt {
  status?: string;
  currency?: string;
  event?: { amount?: number };
}

export interface ArrearsView {
  turn: number;
  paidLastTurn: number;
  remaining: number;
}

export function summarizeArrears(input: {
  turn: number;
  currency: string;
  rates: ReadonlyMap<string, number>;
  operating?: Readonly<Record<string, number | undefined>>;
  taxAnchor?: Readonly<Record<string, number | undefined>>;
  receipts: readonly ArrearsReceipt[];
}): ArrearsView {
  const positive = (n: number | undefined) =>
    typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
  const rate = (currency: string) => positive(input.rates.get(currency)) || 1;
  const local = (amount: number | undefined, currency: string) =>
    (positive(amount) / rate(currency)) * rate(input.currency);
  return {
    turn: input.turn,
    paidLastTurn: input.receipts.reduce(
      (sum, receipt) =>
        sum +
        (receipt.status === "applied" && receipt.currency
          ? local(receipt.event?.amount, receipt.currency)
          : 0),
      0
    ),
    remaining:
      Object.entries(input.operating ?? {}).reduce(
        (sum, [currency, amount]) => sum + local(amount, currency),
        0
      ) +
      Object.values(input.taxAnchor ?? {}).reduce<number>(
        (sum, amount) => sum + positive(amount) * rate(input.currency),
        0
      ),
  };
}
