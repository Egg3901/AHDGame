import { counterpartyAccount, mintSinkAccount, subjectAccount } from "@/lib/ledger/accounts";
import type { LedgerEntryInput, LedgerLeg } from "@/lib/ledger/types";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";

/**
 * Phase 1 double-emit shim: derive a shadow ledger entry from a single-entry
 * financialTxLog row.
 *
 * Each tx row is ONE directed movement from the subject's perspective, so it
 * produces one 2-leg entry:
 *   - primary leg  = the subject's real account (amount = row amount)
 *   - contra leg   = the real counterparty account when derivable (two-sided
 *                    rows), otherwise a mint:/sink: bucket (single-sided rows).
 *
 * The contra leg is deliberately booked against `mint:unattributed` /
 * `sink:unattributed` for single-sided rows — that bucket IS the Phase 3
 * coverage backlog, ranked by anchor value in the reconciler report. Proper
 * per-reason attribution and true two-sided linkage is Phase 3 work; the shim
 * exists so the reconciler's per-entry conservation check (Invariant #1) runs
 * green over the derivable subset from day one.
 *
 * See docs/plans/2026-07-05-shadow-ledger-plan.md §3 (Phase 1).
 */

const UNATTRIBUTED_REASON = "unattributed";

/**
 * Phase 3 coverage sweep — semantic mint/sink reasons for single-sided rows.
 *
 * A single-entry tx row has no counterparty account, so the shim books its
 * balancing contra leg against a system `mint:`/`sink:` bucket. Phase 1/2 booked
 * ALL of these against the generic `unattributed` bucket, which is what the
 * reconciler's Phase-3 backlog ranks. Assigning a semantic reason moves the top
 * flows out of that backlog and gives the money-supply check a meaningful,
 * per-reason breakdown.
 *
 * Reasons are deliberately SHARED across the two sides of a real transfer so the
 * money-supply reconciler nets them per currency instead of double-reporting:
 *   - a sovereign coupon/maturity payout (`gov_*_payment`, sink) pairs with the
 *     holders' `bond_coupon`/`bond_maturity` receipts (mint) → `bond_settlement`
 *     / `bond_coupon_settlement`;
 *   - a corporation's `corp_tax_paid` (sink) pairs with the government's
 *     `gov_tax_revenue` receipt (mint) → `taxation`.
 * `corp_revenue` is a genuine one-directional inflow from the (unmodeled) demand
 * side of the sim, so it has no matching sink — it is honestly a `sector_revenue`
 * mint rather than an attributed transfer.
 *
 * Everything not listed here keeps falling through to `unattributed`, which is
 * the remaining Phase-3 backlog. See docs/plans/2026-07-05-shadow-ledger-plan.md
 * §3 (Phase 3) and docs/plans/2026-07-06-shadow-ledger-phase3-backlog.md.
 */
const REASON_BY_TX_TYPE: Partial<Record<FinancialTxLogEntry["type"], string>> = {
  gov_bond_maturity_payment: "bond_settlement",
  bond_maturity: "bond_settlement",
  gov_coupon_payment: "bond_coupon_settlement",
  bond_coupon: "bond_coupon_settlement",
  corp_tax_paid: "taxation",
  gov_tax_revenue: "taxation",
  corp_revenue: "sector_revenue",
  party_dues_received: "party_dues",
  // Genuine one-directional system mint: the new-player checklist completion
  // bonus has no in-world payer, so it is an attributed mint rather than
  // Phase-3 `unattributed` backlog.
  onboarding_reward: "onboarding_reward",
  // Resource prospecting + extraction contracts. These are single-sided from
  // the payer's perspective — the survey cost / contract fee / royalty leaves
  // the corp (or government treasury) into the state/national budget, which is
  // moved by creditTreasury / a stateBudgets $inc rather than a paired tx row.
  // Attribute the sink so the money-supply check reports them per-reason instead
  // of pooling them in `unattributed`.
  corp_prospecting_cost: "prospecting_cost",
  govt_prospecting_cost: "prospecting_cost",
  contract_signing_fee: "extraction_contract_fee",
  contract_royalty_payment: "extraction_royalty",
  // Government-side receipts pair the two corp sinks above under the SAME
  // reasons (the corp_tax_paid ↔ gov_tax_revenue "taxation" convention) so the
  // money-supply reconciler nets each transfer instead of double-reporting.
  // Emitted only for national-treasury credits: the government:<countryId>
  // ledger account is backed by federalBudget.treasuryBalance alone
  // (balanceSnapshot.ts), so state-budget credits stay single-sided.
  govt_signing_fee_receipt: "extraction_contract_fee",
  govt_royalty_receipt: "extraction_royalty",
  // Capacity builds (P3a). The contra side of a build debit is the sector's
  // capitalized construction-in-progress, which is an ASSET account the shadow
  // ledger does not (yet) carry — it stock-checks money balances only. Both
  // directions therefore share ONE reason so the money-supply reconciler nets a
  // build against its own refund per currency instead of reporting two
  // unrelated single-sided flows, and so the standing CIP balance shows up as a
  // named, auditable `sink:capacity_capex` bucket rather than sinking into the
  // `unattributed` Phase-3 backlog.
  corp_capacity_build: "capacity_capex",
  corp_capacity_build_refund: "capacity_capex",
};

/** Semantic mint/sink reason for a single-sided row; `unattributed` when unmapped. */
export function reasonForTxType(txType: FinancialTxLogEntry["type"]): string {
  return REASON_BY_TX_TYPE[txType] ?? UNATTRIBUTED_REASON;
}

/** The tx-log fields the shim needs; anchorAmount must already be stamped. */
export type DerivableTx = Pick<
  FinancialTxLogEntry,
  | "type"
  | "turn"
  | "createdAt"
  | "subjectType"
  | "subjectId"
  | "countryId"
  | "amount"
  | "currencyCode"
  | "anchorAmount"
  | "counterpartyType"
  | "counterpartyId"
  | "meta"
>;

export function deriveLedgerEntry(
  tx: DerivableTx,
  emitSite = "financialTxLog/emit.ts:shim"
): LedgerEntryInput | null {
  const anchor = tx.anchorAmount;
  // No anchor value → not derivable in ₳ terms; skip rather than guess a rate
  // (deriving anchor from the live FX table causes historical drift — plan §5).
  if (anchor === undefined || !Number.isFinite(anchor)) return null;

  // State-party rows have no ObjectId subjectId; their identity is the composite
  // statePartyKey stamped in `meta` at emit time (see nppFundGeneration.ts).
  const statePartyKey =
    typeof tx.meta?.statePartyKey === "string" ? tx.meta.statePartyKey : undefined;
  const subject = subjectAccount(
    tx.subjectType,
    { subjectId: tx.subjectId?.toString(), countryId: tx.countryId, statePartyKey },
    tx.currencyCode
  );
  if (!subject) return null;

  const primary: LedgerLeg = {
    account: subject,
    amount: tx.amount,
    currencyCode: tx.currencyCode,
    anchorAmount: anchor,
    role: "primary",
  };

  const counterparty = counterpartyAccount(
    tx.counterpartyType,
    tx.counterpartyId?.toString(),
    tx.currencyCode
  );
  const contraAccount =
    counterparty ?? mintSinkAccount(anchor, reasonForTxType(tx.type), tx.currencyCode);

  const contra: LedgerLeg = {
    account: contraAccount,
    amount: -tx.amount,
    currencyCode: tx.currencyCode,
    anchorAmount: -anchor,
    role: "contra",
  };

  return {
    turn: tx.turn,
    createdAt: tx.createdAt,
    txType: tx.type,
    legs: [primary, contra],
    emitSite,
  };
}

export function deriveLedgerEntries(txs: DerivableTx[], emitSite?: string): LedgerEntryInput[] {
  const out: LedgerEntryInput[] = [];
  for (const tx of txs) {
    const entry = deriveLedgerEntry(tx, emitSite);
    if (entry) out.push(entry);
  }
  return out;
}
