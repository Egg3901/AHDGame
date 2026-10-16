import { producerPayableReceiptKeys } from "@/lib/market/producerMarket/payablesRules";
/**
 * CEO cash arrears show completed repayments separately from income.
 * summarizeArrears restates operating and tax balances into the corporation's
 * currency without changing the underlying obligations or period scaling.
 */
export interface ArrearsReceipt {
  status?: string;
  currency?: string;
  event?: { amount?: number; meta?: Readonly<Record<string, string | number | boolean | null>> };
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
  producerCorporationId?: string;
  producerPayables?: readonly { amount: number }[];
}): ArrearsView {
  const positive = (n: number | undefined) =>
    typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
  const rate = (currency: string) => positive(input.rates.get(currency)) || 1;
  const local = (amount: number | undefined, currency: string) =>
    (positive(amount) / rate(currency)) * rate(input.currency);
  const keys = input.producerCorporationId
    ? producerPayableReceiptKeys(input.producerCorporationId)
    : null;
  const producerPaid = (receipt: ArrearsReceipt) => {
    if (!keys || receipt.status !== "applied") return 0;
    const currency = receipt.event?.meta?.[keys.currency];
    const amount = receipt.event?.meta?.[keys.amount];
    return typeof currency === "string" && typeof amount === "number" ? local(amount, currency) : 0;
  };
  return {
    turn: input.turn,
    paidLastTurn: input.receipts.reduce(
      (sum, receipt) =>
        sum +
        (receipt.status === "applied" && receipt.currency
          ? local(receipt.event?.amount, receipt.currency)
          : 0) +
        producerPaid(receipt),
      0
    ),
    remaining:
      Object.entries(input.operating ?? {}).reduce(
        (sum, [currency, amount]) => sum + local(amount, currency),
        0
      ) +
      (input.producerPayables ?? []).reduce(
        (sum, claim) => sum + positive(claim.amount) * rate(input.currency),
        0
      ) +
      Object.values(input.taxAnchor ?? {}).reduce<number>(
        (sum, amount) => sum + positive(amount) * rate(input.currency),
        0
      ),
  };
}
