/** One closed, valued cash transfer for a frozen producer settlement. */
import { oid, type BankingTransition, type TransitionLeg } from "@/lib/banking/rules/boundary";
import type { MarketAccount } from "./rules";

export type ProducerCashBinding = {
  accountId: string;
  currency: string;
  localPerAnchor: number;
  /** Exact stored before-image, avoiding an FX round-trip in the write guard. */
  openingCashLocal: number;
} & (
  | { kind: "corporation"; corporationId: string }
  | { kind: "economyAccount"; economyAccountId: string }
);

/**
 * Participants settle their net cash change once, after all prices and deliveries
 * are frozen. No receipt can target a bank vault, deposit balance or loan asset.
 * Product revenues and input costs remain itemized in the producer receipts.
 */
export function producerCashTransition(input: {
  worldEpoch: string;
  turn: number;
  opening: readonly MarketAccount[];
  closing: readonly MarketAccount[];
  bindings: readonly ProducerCashBinding[];
  /** Content hash of the complete immutable production and trade receipt. */
  receiptDigest: string;
}): BankingTransition {
  if (!input.worldEpoch || !Number.isSafeInteger(input.turn) || input.turn < 0)
    throw new Error("Missing producer settlement identity");
  if (!/^[a-f0-9]{64}$/.test(input.receiptDigest)) throw new Error("Missing frozen receipt digest");
  const rows = (accounts: readonly MarketAccount[]) => {
    const result = new Map<string, number>();
    for (const a of accounts) {
      if (!a.id || result.has(a.id) || !Number.isFinite(a.cash) || a.cash < 0)
        throw new Error("Invalid producer cash snapshot");
      result.set(a.id, a.cash);
    }
    return result;
  };
  const opening = rows(input.opening);
  const closing = rows(input.closing);
  if (opening.size !== closing.size || [...opening.keys()].some((id) => !closing.has(id)))
    throw new Error("Producer participants changed during settlement");
  const bindings = new Map<string, ProducerCashBinding>();
  const targets = new Set<string>();
  const rates = new Map<string, number>();
  for (const binding of input.bindings) {
    if (bindings.has(binding.accountId) || !opening.has(binding.accountId))
      throw new Error("Duplicate or unknown producer cash binding");
    if (
      !binding.currency ||
      !Number.isFinite(binding.localPerAnchor) ||
      binding.localPerAnchor <= 0
    )
      throw new Error("Invalid frozen producer currency rate");
    const priorRate = rates.get(binding.currency);
    if (priorRate != null && priorRate !== binding.localPerAnchor)
      throw new Error("Inconsistent producer currency rate");
    rates.set(binding.currency, binding.localPerAnchor);
    const spendable = Math.max(0, binding.openingCashLocal / binding.localPerAnchor);
    if (
      !Number.isFinite(binding.openingCashLocal) ||
      Math.abs(spendable - opening.get(binding.accountId)!) > Math.max(1e-7, spendable * 1e-12)
    )
      throw new Error("Producer cash binding differs from the opening snapshot");
    const target =
      binding.kind === "corporation"
        ? `corporations:${binding.corporationId}`
        : `producerEconomyAccounts:${binding.economyAccountId}`;
    if (targets.has(target)) throw new Error("Two operating accounts target the same cash");
    if (binding.kind === "corporation" && !/^[a-f0-9]{24}$/i.test(binding.corporationId))
      throw new Error("Invalid producer corporation identity");
    if (binding.kind === "economyAccount" && !binding.economyAccountId)
      throw new Error("Invalid economy account identity");
    targets.add(target);
    bindings.set(binding.accountId, binding);
  }
  if (bindings.size !== opening.size) throw new Error("Missing operating cash binding");
  let net = 0;
  let gross = 0;
  const legs: TransitionLeg[] = [];
  for (const [id, cash] of [...opening].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const change = closing.get(id)! - cash;
    net += change;
    gross += Math.abs(change);
    if (change === 0) continue;
    const binding = bindings.get(id)!;
    const amount = Math.abs(change) * binding.localPerAnchor;
    if (!Number.isFinite(amount)) throw new Error("Non-finite native producer cash transfer");
    legs.push({
      kind: change < 0 ? "debit" : "credit",
      amount,
      valuation: { currencyCode: binding.currency, localPerAnchor: binding.localPerAnchor },
      collection: binding.kind === "corporation" ? "corporations" : "producerEconomyAccounts",
      filter:
        binding.kind === "corporation"
          ? { _id: oid(binding.corporationId), liquidCapital: binding.openingCashLocal }
          : {
              _id: binding.economyAccountId,
              worldEpoch: input.worldEpoch,
              cash: binding.openingCashLocal,
            },
      path: binding.kind === "corporation" ? "liquidCapital" : "cash",
      note: `Producer operating settlement ${id}`,
    });
  }
  if (
    !Number.isFinite(net) ||
    !Number.isFinite(gross) ||
    Math.abs(net) > Math.max(1e-7, gross * 1e-12)
  )
    throw new Error("Producer cash does not conserve value");
  return {
    key: `producer-economy:${input.worldEpoch}:${input.turn}`,
    kind: "producer-economy",
    turn: input.turn,
    currency: "ANCHOR",
    legs,
    projections: [],
    event: {
      kind: "monetary.executed",
      command: "producer.settle",
      meta: { worldEpoch: input.worldEpoch, receiptDigest: input.receiptDigest },
    },
  };
}
