/** Prior bills retain their creditor and expense history until cash actually pays them. */
import type { MarketAccount } from "./rules";

export interface ProducerPayable {
  id: string;
  debtorAccountId: string;
  creditorAccountId: string;
  producerId: string;
  kind: "labour" | "operating";
  /** Anchor-valued invoice amount. Conversion to native cash happens at payment. */
  amount: number;
}

export function producerPayableId(claim: Omit<ProducerPayable, "id" | "amount">): string {
  return JSON.stringify([
    claim.debtorAccountId,
    claim.creditorAccountId,
    claim.producerId,
    claim.kind,
  ]);
}

export function accrueProducerPayable(
  claims: Map<string, ProducerPayable>,
  claim: Omit<ProducerPayable, "id">
): void {
  if (!Number.isFinite(claim.amount) || claim.amount < 0)
    throw new Error("Invalid producer payable");
  if (claim.amount === 0) return;
  if (claim.debtorAccountId === claim.creditorAccountId)
    throw new Error("Invalid producer payable creditor");
  const id = producerPayableId(claim);
  const amount = (claims.get(id)?.amount ?? 0) + claim.amount;
  if (!Number.isFinite(amount)) throw new Error("Producer payable overflow");
  claims.set(id, { ...claim, id, amount });
}

/** Opening cash pays old creditors pro rata before new production can commit it. */
export function settlePriorProducerPayables(input: {
  accounts: readonly MarketAccount[];
  payables: readonly ProducerPayable[];
}) {
  const cash = new Map(input.accounts.map((account) => [account.id, account.cash]));
  if (
    cash.size !== input.accounts.length ||
    input.accounts.some(
      (account) => !account.id || !Number.isFinite(account.cash) || account.cash < 0
    )
  )
    throw new Error("Invalid payable cash account");
  const due = new Map<string, number>();
  const ids = new Set<string>();
  for (const claim of input.payables) {
    if (
      !claim.producerId ||
      (claim.kind !== "labour" && claim.kind !== "operating") ||
      claim.id !== producerPayableId(claim) ||
      ids.has(claim.id) ||
      !cash.has(claim.debtorAccountId) ||
      !cash.has(claim.creditorAccountId) ||
      claim.debtorAccountId === claim.creditorAccountId ||
      !Number.isFinite(claim.amount) ||
      claim.amount < 0
    )
      throw new Error("Invalid opening producer payable");
    ids.add(claim.id);
    const total = (due.get(claim.debtorAccountId) ?? 0) + claim.amount;
    if (!Number.isFinite(total)) throw new Error("Producer payable overflow");
    due.set(claim.debtorAccountId, total);
  }
  const budgets = new Map(cash);
  const credits = new Map<string, number>();
  const payables: ProducerPayable[] = [];
  const payments: ProducerPayable[] = [];
  for (const claim of [...input.payables].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  )) {
    const total = due.get(claim.debtorAccountId)!;
    const fraction = total > 0 ? Math.min(1, budgets.get(claim.debtorAccountId)! / total) : 0;
    const paid = claim.amount * fraction;
    if (paid > 0) {
      cash.set(claim.debtorAccountId, Math.max(0, cash.get(claim.debtorAccountId)! - paid));
      credits.set(claim.creditorAccountId, (credits.get(claim.creditorAccountId) ?? 0) + paid);
      payments.push({ ...claim, amount: paid });
    }
    if (claim.amount > paid) payables.push({ ...claim, amount: claim.amount - paid });
  }
  // No chain of unreceived payments funds another overdue bill in this pass.
  for (const [id, amount] of credits) cash.set(id, cash.get(id)! + amount);
  if ([...cash.values()].some((amount) => !Number.isFinite(amount)))
    throw new Error("Producer payable cash overflow");
  return {
    accounts: [...cash].map(([id, balance]) => ({ id, cash: balance })),
    payables,
    payments,
  };
}

/** Private journal fields can be projected for one corporation without reading other payments. */
export function producerPayableReceiptKeys(corporationId: string) {
  if (!/^[a-f0-9]{24}$/i.test(corporationId))
    throw new Error("Invalid producer payable receipt identity");
  return {
    amount: `producerPayablePaid_${corporationId}`,
    currency: `producerPayableCurrency_${corporationId}`,
  };
}
