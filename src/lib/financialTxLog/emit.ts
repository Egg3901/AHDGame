import * as Sentry from "@sentry/nextjs";
import { ObjectId, type Db } from "mongodb";
import {
  DEFAULT_TX_THRESHOLDS,
  type FinancialTxLogEntry,
  type FinancialTxType,
  type FinancialSuspectFlag,
  type TxThresholds,
} from "@/lib/db/types/financialTxLog";
import type { ExchangeRate, SystemSettings } from "@/lib/db/types";
import {
  computeExpiresAt,
  computeExpiresAtSync,
  loadTurnLengthMinutes,
} from "@/lib/financialTxLog/expiresAt";
import { isLedgerShadowEnabled } from "@/lib/ledger/featureFlag";
import { deriveLedgerEntries } from "@/lib/ledger/deriveFromTx";
import { emitLedgerEntries } from "@/lib/ledger/emit";
import type { LedgerEntryInput } from "@/lib/ledger/types";
import { recordAudit, recordAuditBulk } from "@/lib/audit/recordAudit";
import type {
  ActionAuditCounterparty,
  ActionAuditInput,
  ActionAuditSubject,
} from "@/lib/db/types/actionAuditLog";

type TxInput = Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">;

function amountToAnchor(
  amount: number,
  currencyCode: string,
  ratesByCurrency: Map<string, number>
): number {
  const rate = ratesByCurrency.get(currencyCode);
  if (!rate || rate <= 0) return amount;
  return amount / rate;
}

async function loadAnchorRateMap(
  db: Db,
  entries: Pick<TxInput, "currencyCode" | "anchorAmount">[]
): Promise<Map<string, number>> {
  const currencies = [
    ...new Set(entries.filter((e) => e.anchorAmount === undefined).map((e) => e.currencyCode)),
  ];
  if (currencies.length === 0) return new Map();
  const rates = await db
    .collection<ExchangeRate>("exchangeRates")
    .find({ currencyCode: { $in: currencies } })
    .toArray();
  return new Map(rates.map((rate) => [rate.currencyCode as string, rate.rate]));
}

function withAnchorAmount(entry: TxInput, ratesByCurrency: Map<string, number>): TxInput {
  if (entry.anchorAmount !== undefined) return entry;
  return {
    ...entry,
    anchorAmount: amountToAnchor(entry.amount, entry.currencyCode, ratesByCurrency),
  };
}

// Load thresholds once per call site. Falls back to defaults if not configured in DB.
export async function loadTxThresholds(db: Db): Promise<TxThresholds> {
  const settings = await db
    .collection<SystemSettings>("systemSettings")
    .findOne({ _id: "current" });
  return settings?.financialTxLog?.thresholds ?? DEFAULT_TX_THRESHOLDS;
}

function evaluateTier1Flags(entry: TxInput, thresholds: TxThresholds): FinancialSuspectFlag[] {
  const flags: FinancialSuspectFlag[] = [];
  const now = new Date();

  if (entry.type === "admin_transfer") {
    flags.push({
      type: "admin_transfer",
      severity: "high",
      detail: "Admin-injected funds transfer",
      detectedAt: now,
    });
  }

  const subjectThresholds = thresholds[entry.subjectType];
  const threshold = subjectThresholds?.[entry.type];
  if (threshold !== undefined && Math.abs(entry.amount) > threshold) {
    flags.push({
      type: "large_transaction",
      severity: "high",
      detail: `${entry.type} of ${Math.abs(entry.amount).toLocaleString()} exceeds threshold ${threshold.toLocaleString()}`,
      detectedAt: now,
    });
  }

  return flags;
}

/**
 * Phase 1 double-emit shim: when the `ledgerShadow` flag is on, ALSO derive a
 * shadow double-entry ledger entry from each inserted tx-log row. Fully
 * fire-and-forget — the shadow ledger must NEVER fail a game write, so any
 * error is swallowed by emitLedgerEntries/isLedgerShadowEnabled internally.
 * See docs/plans/2026-07-05-shadow-ledger-plan.md §3 (Phase 1).
 */
async function shadowLedgerFromTx(db: Db, docs: FinancialTxLogEntry[]): Promise<void> {
  if (!(await isLedgerShadowEnabled())) return;
  const derived: LedgerEntryInput[] = deriveLedgerEntries(docs);
  await emitLedgerEntries(db, derived);
}

/**
 * `FinancialTxType` -> namespaced audit `action` verb (forensics/alt-detection
 * plan §3.1 T2.1). Kept as a lookup table rather than a naming convention so
 * the audit spine reads like "wire.send"/"bond.buy" instead of a 1:1 dump of
 * internal tx-type strings. Falls back to `"money.<type>"` for any type added
 * here without a nicer verb (see default branch in {@link txTypeToAuditAction}).
 */
const TX_TYPE_TO_AUDIT_ACTION: Partial<Record<FinancialTxType, string>> = {
  // Character / imperial cash
  fund_credit: "money.fund_credit",
  fund_debit: "money.fund_debit",
  office_income: "money.office_income",
  fundraise_credit: "money.fundraise",
  wire_transfer_in: "wire.receive",
  wire_transfer_out: "wire.send",
  campaign_donation: "party.donate",
  union_contribution: "union.contribute",

  // Bonds
  bond_purchase: "bond.buy",
  bond_sell: "bond.sell",
  bond_coupon: "bond.coupon",
  bond_maturity: "bond.maturity",
  bond_default: "bond.default",
  bond_issuance: "bond.issue",
  bond_dissolution_payout: "bond.dissolution_payout",

  // Corp & shares
  corp_revenue: "corp.revenue",
  corp_dividend: "corp.dividends",
  corp_salary: "corp.salary",
  corp_tax_paid: "corp.tax_paid",
  corp_capital_seed: "corp.capital_seed",
  corp_capital_injection: "corp.capital_injection",
  corp_sector_sale: "corp.sector_sale",
  corp_sector_purchase: "corp.sector_purchase",
  corp_supply_agreement: "corp.supply_agreement",
  defence_contract_payment: "corp.defence_contract_payment",
  corp_dissolution_distribution: "corp.dissolution_distribution",
  corp_escrow_funding: "corp.escrow_funding",
  corp_escrow_withdrawal: "corp.escrow_withdrawal",
  corp_group_relief: "corp.group_relief",
  bank_discount_window_draw: "bank.discount_window_draw",
  bank_discount_window_repay: "bank.discount_window_repay",
  bank_interbank_lend: "bank.interbank_lend",
  bank_interbank_repay: "bank.interbank_repay",
  bank_cb_margin_draw: "bank.cb_margin_draw",
  bank_cb_margin_repay: "bank.cb_margin_repay",
  corp_fine: "corp.fine",
  corp_capacity_build: "corp.capacity_build",
  corp_capacity_build_refund: "corp.capacity_build_refund",
  stock_trade_buy: "stock.buy",
  stock_trade_sell: "stock.sell",

  // Index funds / share orders
  index_fund_subscribe: "fund.subscribe",
  index_fund_redeem: "fund.redeem",
  index_fund_dividend: "fund.dividend",
  stock_order_escrow: "stock.order_escrow",
  stock_self_issue: "stock.self_issue",
  stock_order_refund: "stock.order_refund",
  ipo_proceeds: "stock.ipo_proceeds",
  share_offer_escrow: "share.offer_escrow",
  share_listing_refund: "share.listing_refund",
  share_buyout_payout: "share.buyout_payout",
  share_buyout_buyback: "share.buyout_buyback",
  share_buyout_outflow: "share.buyout_outflow",

  // Forex / savings / LOC
  forex_trade: "forex.trade",
  savings_deposit: "savings.deposit",
  savings_withdrawal: "savings.withdraw",
  savings_interest: "savings.interest",
  loc_draw: "loc.draw",
  loc_repay: "loc.repay",
  loc_interest: "loc.interest",
  loc_garnishment: "loc.garnishment",

  // Admin / system
  admin_transfer: "admin.transfer",
  onboarding_reward: "money.onboarding_reward",

  // Party budget
  party_transfer: "party.transfer",
  party_gotv_spend: "party.gotv_spend",
  party_dues_received: "party.dues_received",
  caucus_tax_debit: "party.caucus_tax",

  // Government & subsidies
  gov_tax_revenue: "gov.tax_revenue",
  gov_bond_issuance: "gov.bond_issue",
  gov_coupon_payment: "gov.coupon_payment",
  gov_bond_maturity_payment: "gov.bond_maturity_payment",
  gov_subsidy_paid: "gov.subsidy_paid",
  gov_grant_paid: "gov.grant_paid",
  gov_budget_transfer: "gov.budget_transfer",

  // Crisis / events
  crisis_payout: "crisis.payout",
  crisis_levy: "crisis.levy",

  // World events
  world_event_payout: "system.world_event_payout",

  // Resource prospecting + extraction contracts
  corp_prospecting_cost: "corp.prospecting_cost",
  govt_prospecting_cost: "gov.prospecting_cost",
  contract_signing_fee: "contract.signing_fee",
  contract_royalty_payment: "contract.royalty_payment",
  govt_signing_fee_receipt: "gov.signing_fee_receipt",
  govt_royalty_receipt: "gov.royalty_receipt",
};

function txTypeToAuditAction(type: FinancialTxType): string {
  return TX_TYPE_TO_AUDIT_ACTION[type] ?? `money.${type}`;
}

/**
 * Build the small audit-spine envelope for one already-persisted
 * `financialTxLog` row. `actor` is intentionally left unset so `recordAudit`/
 * `recordAuditBulk` fill it from the ambient request/turn-phase context
 * (`src/lib/observability/context.ts`) — the emit call sites here don't (and
 * shouldn't need to) know who initiated the transaction. `source` is
 * `"system"` because this helper runs for both API-triggered and turn-phase
 * emissions and the tx-log row itself doesn't carry which one it was.
 */
function buildAuditEnvelope(doc: FinancialTxLogEntry): ActionAuditInput {
  const subject: ActionAuditSubject = {
    type: doc.subjectType,
    id: doc.subjectId ?? doc.countryId,
    name: doc.subjectName,
  };
  const counterparty: ActionAuditCounterparty | undefined = doc.counterpartyType
    ? {
        type: doc.counterpartyType,
        id: doc.counterpartyId,
        name: doc.counterpartyName,
      }
    : undefined;

  return {
    source: "system",
    action: txTypeToAuditAction(doc.type),
    category: "money",
    subject,
    counterparty,
    amount: doc.amount,
    currencyCode: doc.currencyCode,
    anchorAmount: doc.anchorAmount,
    refs: { financialTxLogId: doc._id },
    outcome: "ok",
  };
}

// Fire-and-forget single emission. Failures are sent to Sentry, never thrown.
export async function emitTx(db: Db, entry: TxInput, thresholds?: TxThresholds): Promise<void> {
  try {
    const resolvedThresholds = thresholds ?? (await loadTxThresholds(db));
    const ratesByCurrency = await loadAnchorRateMap(db, [entry]);
    const entryWithAnchor = withAnchorAmount(entry, ratesByCurrency);
    const flags = evaluateTier1Flags(entryWithAnchor, resolvedThresholds);
    const doc: FinancialTxLogEntry = {
      ...entryWithAnchor,
      _id: new ObjectId(),
      expiresAt: await computeExpiresAt(db, entryWithAnchor.createdAt),
      suspectFlags: flags.length > 0 ? flags : undefined,
      flagged: flags.length > 0,
    };
    await db.collection<FinancialTxLogEntry>("financialTxLog").insertOne(doc);
    await shadowLedgerFromTx(db, [doc]);
    recordAudit(buildAuditEnvelope(doc));
  } catch (err) {
    Sentry.captureException(err, { extra: { phase: "emitTx", type: entry.type } });
  }
}

// Bulk emission — callers MUST pre-load thresholds with loadTxThresholds once before the loop.
export async function emitTxBulk(
  db: Db,
  entries: TxInput[],
  thresholds: TxThresholds
): Promise<void> {
  if (entries.length === 0) return;
  try {
    // Load turn cadence once per call instead of per-entry — emitTxBulk is on
    // the hot path of bondTurn / corporationTurn (~hundreds of entries/turn).
    const turnLengthMinutes = await loadTurnLengthMinutes(db);
    const ratesByCurrency = await loadAnchorRateMap(db, entries);
    const docs: FinancialTxLogEntry[] = entries.map((entry) => {
      const entryWithAnchor = withAnchorAmount(entry, ratesByCurrency);
      const flags = evaluateTier1Flags(entryWithAnchor, thresholds);
      return {
        ...entryWithAnchor,
        _id: new ObjectId(),
        expiresAt: computeExpiresAtSync(entryWithAnchor.createdAt, turnLengthMinutes),
        suspectFlags: flags.length > 0 ? flags : undefined,
        flagged: flags.length > 0,
      };
    });
    await db.collection<FinancialTxLogEntry>("financialTxLog").insertMany(docs, { ordered: false });
    await shadowLedgerFromTx(db, docs);
    // BULK path so the hot loop (bondTurn / corporationTurn, hundreds of
    // entries/turn) pays one insertMany at flush time, not one per row.
    recordAuditBulk(docs.map(buildAuditEnvelope));
  } catch (err) {
    Sentry.captureException(err, { extra: { phase: "emitTxBulk", count: entries.length } });
  }
}
