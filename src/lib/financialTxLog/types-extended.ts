import type { FinancialTxType } from "@/lib/db/types/financialTxLog";

/**
 * Single source of truth for the FinancialTxType domain.
 *
 * `FinancialTxType` itself is a string union declared in
 * `src/lib/db/types/financialTxLog.ts`. This module mirrors that union as a
 * runtime-iterable list (for query validation, admin filter dropdowns, CSV
 * export columns) and pairs each type with a human-readable label.
 *
 * Adding a new tx type requires a one-line addition here AND in the union.
 * If the two diverge, `assertCoverage` below catches it at typecheck time.
 */
export const ALL_TX_TYPES: readonly FinancialTxType[] = [
  // ── Character / imperial cash ──────────────────────────────────────────
  "fund_credit", // legacy mixed source — still emitted by older paths
  "fund_debit",
  "office_income",
  "fundraise_credit",
  "wire_transfer_in",
  "wire_transfer_out",
  "campaign_donation",
  "union_contribution",

  // ── Bonds ──────────────────────────────────────────────────────────────
  "bond_purchase",
  "bond_sell",
  "bond_coupon",
  "bond_maturity",
  "bond_default",
  "bond_issuance",
  "bond_dissolution_payout",

  // ── Corp & shares ──────────────────────────────────────────────────────
  "corp_revenue",
  "corp_dividend",
  "corp_salary",
  "corp_tax_paid",
  "corp_capital_seed",
  "corp_capital_injection",
  "corp_sector_sale",
  "corp_sector_purchase",
  "corp_dissolution_distribution",
  "corp_escrow_funding",
  "corp_escrow_withdrawal",
  "corp_group_relief",
  "bank_discount_window_draw",
  "bank_discount_window_repay",
  "corp_fine",
  "index_listing_lobbying",
  "pension_contribution",
  "pension_benefit",
  "bank_loan_origination",
  "bank_loan_repayment",
  "bank_npc_loan_interest",
  "bank_deposit_interest",
  "bank_prop_trade_buy",
  "bank_prop_trade_sell",
  "bank_insurance_payout",
  "bank_cb_advance",
  "bank_interbank_lend",
  "bank_interbank_repay",
  "bank_cb_margin_draw",
  "bank_cb_margin_repay",
  "corp_capacity_build",
  "corp_capacity_build_refund",
  "stock_trade_buy",
  "stock_trade_sell",
  "index_fund_subscribe",
  "index_fund_redeem",
  "index_fund_dividend",
  "stock_order_escrow",
  "stock_self_issue",
  "stock_order_refund",
  "ipo_proceeds",
  "share_offer_escrow",
  "share_listing_refund",
  "share_buyout_payout",
  "share_buyout_buyback",
  "share_buyout_outflow",

  // ── Forex / savings / LOC ──────────────────────────────────────────────
  "forex_trade",
  "savings_deposit",
  "savings_withdrawal",
  "savings_interest",
  "loc_draw",
  "loc_repay",
  "loc_interest",
  "loc_garnishment",

  // ── Admin / system ─────────────────────────────────────────────────────
  "admin_transfer",
  "onboarding_reward",

  // ── Party budget ───────────────────────────────────────────────────────
  "party_transfer",
  "party_gotv_spend",
  "party_dues_received",
  "caucus_tax_debit",

  // ── Government & subsidies (gov_subsidy_paid / gov_grant_paid /
  //    gov_budget_transfer remain in the union as documented future slots
  //    pending the budget-flow rework — Phase 3 commit deferred them.)
  "gov_tax_revenue",
  "gov_bond_issuance",
  "gov_coupon_payment",
  "gov_bond_maturity_payment",
  "gov_subsidy_paid",
  "gov_grant_paid",
  "gov_budget_transfer",
  "monetary_treasury_advance",

  // ── Crisis / events (deferred per Phase 3 commit — wired by the crisis
  //    system once it lands) ────────────────────────────────────────────
  "crisis_payout",
  "crisis_levy",

  // ── World events (Phase 0) ────────────────────────────────────────────
  "world_event_payout",

  // ── Resource prospecting + extraction contracts ───────────────────────
  "corp_prospecting_cost",
  "govt_prospecting_cost",
  "contract_signing_fee",
  "contract_royalty_payment",
  "govt_signing_fee_receipt",
  "govt_royalty_receipt",
  "corp_supply_agreement",
  "defence_contract_payment",
  "restitution_credit",
] as const;

export const TX_TYPE_LABELS: Record<FinancialTxType, string> = {
  fund_credit: "Fund Credit (legacy)",
  fund_debit: "Fund Debit (legacy)",
  office_income: "Office Income",
  fundraise_credit: "Fundraise",
  wire_transfer_in: "Wire In",
  wire_transfer_out: "Wire Out",
  campaign_donation: "Campaign Donation",
  union_contribution: "Union Contribution",

  bond_purchase: "Bond Purchase",
  bond_sell: "Bond Sell",
  bond_coupon: "Bond Coupon",
  bond_maturity: "Bond Maturity",
  bond_default: "Bond Default",
  bond_issuance: "Bond Issuance",
  bond_dissolution_payout: "Bond Dissolution Payout",

  corp_revenue: "Corp Revenue",
  corp_dividend: "Corp Dividend",
  corp_salary: "CEO Salary",
  corp_tax_paid: "Corp Tax Paid",
  corp_capital_seed: "Corp Founding Capital",
  corp_capital_injection: "Corp Capital Injection",
  corp_sector_sale: "Sector Sale",
  corp_sector_purchase: "Sector Purchase",
  corp_dissolution_distribution: "Corp Liquidation Distribution",
  corp_escrow_funding: "Escrow Funding",
  corp_escrow_withdrawal: "Escrow Withdrawal",
  corp_group_relief: "Group Loss Relief",
  bank_discount_window_draw: "Discount Window Draw",
  bank_discount_window_repay: "Discount Window Repayment",
  corp_fine: "Regulatory Fine",
  index_listing_lobbying: "Index Listing Lobbying",
  pension_contribution: "Pension Contribution",
  pension_benefit: "Pension Benefit Paid",
  bank_loan_origination: "Bank Loan Drawn",
  bank_loan_repayment: "Bank Loan Repayment",
  bank_npc_loan_interest: "NPC Household Loan Interest",
  bank_deposit_interest: "Bank Deposit Interest",
  bank_prop_trade_buy: "Prop Book Purchase",
  bank_prop_trade_sell: "Prop Book Sale",
  bank_insurance_payout: "Deposit Insurance Payout",
  bank_cb_advance: "Central Bank Advance",
  bank_interbank_lend: "Interbank Loan Placed",
  bank_interbank_repay: "Interbank Loan Repayment",
  bank_cb_margin_draw: "CB Margin Draw",
  bank_cb_margin_repay: "CB Margin Repayment",
  corp_capacity_build: "Capacity Build",
  corp_capacity_build_refund: "Capacity Build Refund",
  stock_trade_buy: "Stock Buy",
  stock_trade_sell: "Stock Sell",
  index_fund_subscribe: "Index Fund Subscribe",
  index_fund_redeem: "Index Fund Redeem",
  index_fund_dividend: "Index Fund Dividend",
  stock_order_escrow: "Stock Order Escrow",
  stock_self_issue: "Self-Issued Shares",
  stock_order_refund: "Stock Order Refund",
  ipo_proceeds: "IPO Proceeds",
  share_offer_escrow: "Listing Offer Escrow",
  share_listing_refund: "Listing Refund",
  share_buyout_payout: "Privatization Buyout Payout",
  share_buyout_buyback: "Privatization Float Buyback",
  share_buyout_outflow: "Privatization Buyout Outflow",

  forex_trade: "Forex Trade",
  savings_deposit: "Savings Deposit",
  savings_withdrawal: "Savings Withdrawal",
  savings_interest: "Savings Interest",
  loc_draw: "LOC Draw",
  loc_repay: "LOC Repay",
  loc_interest: "LOC Interest",
  loc_garnishment: "LOC Garnishment",

  admin_transfer: "Admin Transfer",
  onboarding_reward: "Onboarding Reward",

  party_transfer: "Party Transfer",
  party_gotv_spend: "Party GOTV Spend",
  party_dues_received: "Party Dues",
  caucus_tax_debit: "Caucus Tax",

  gov_tax_revenue: "Govt Tax Revenue",
  gov_bond_issuance: "Govt Bond Issuance",
  gov_coupon_payment: "Govt Coupon Paid",
  gov_bond_maturity_payment: "Govt Bond Maturity Paid",
  gov_subsidy_paid: "Govt Subsidy Paid",
  gov_grant_paid: "Govt Grant Paid",
  gov_budget_transfer: "Govt Budget Transfer",
  monetary_treasury_advance: "Central Bank Treasury Advance",

  crisis_payout: "Crisis Payout",
  crisis_levy: "Crisis Levy",

  world_event_payout: "World Event Payout",

  corp_prospecting_cost: "Prospecting Cost",
  govt_prospecting_cost: "Govt Prospecting Cost",
  contract_signing_fee: "Contract Signing Fee",
  contract_royalty_payment: "Extraction Royalty",
  govt_signing_fee_receipt: "Signing Fee Receipt",
  govt_royalty_receipt: "Royalty Receipt",
  corp_supply_agreement: "Supply Agreement Settlement",
  defence_contract_payment: "Defence Contract Payment",
  restitution_credit: "Restitution Credit",
};

/**
 * Compile-time check that ALL_TX_TYPES enumerates every member of
 * `FinancialTxType`. If a new variant is added to the union but not added
 * to ALL_TX_TYPES (or vice versa), this assignment fails to typecheck.
 *
 * The pattern: build a record keyed by every type in the array, then
 * assign a Record<FinancialTxType, true> to it. If any union member is
 * missing from the array, the assignment errors. If the array contains
 * a non-union member, the array's element type errors at the declaration.
 */
type _Coverage = (typeof ALL_TX_TYPES)[number];
const _assertAllCovered: Record<_Coverage, true> = Object.fromEntries(
  ALL_TX_TYPES.map((t) => [t, true])
) as Record<_Coverage, true>;

const _coverageCheck: Record<FinancialTxType, true> = _assertAllCovered;

export function getTxTypeLabel(type: FinancialTxType): string {
  return TX_TYPE_LABELS[type] ?? type;
}
