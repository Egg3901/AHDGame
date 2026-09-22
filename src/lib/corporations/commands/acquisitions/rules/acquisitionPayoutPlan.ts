/**
 * Pinned acquisition payout plan (rules zone: plain data in, plain data out).
 *
 * The plan pins every holder amount and recipient once per offer, before any
 * money moves. A retry replays the pinned legs verbatim instead of recomputing
 * them, so FX drift or roster changes between attempts can never change (or
 * duplicate) a payout. Amount math mirrors `payShareholders` bucket by bucket;
 * only the application is new (stamped single-doc legs, see
 * `acquisitionSettlement.ts`).
 *
 * Deliberately replicates two pre-existing quirks of `allocateShareholderPool`
 * rather than fixing them here: per-row `Math.floor` dust and shareholder rows
 * that match no bucket (e.g. `nppId` holders) are paid to nobody. Fixing the
 * distribution would be a balance change; the settlement accounts for the
 * difference on the compensation path instead.
 */

import type { ShareholderAllocation } from "@/lib/bonds/corporateBondDefault";
import {
  anchorToCorpLiquidCapital,
  type CorpCapitalCurrencyInfo,
} from "@/lib/currency/corporationCapital";
import { buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import { writeGovBudgetLocal } from "@/lib/currency/govBudgetFields";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { AcquisitionLegKind } from "@/lib/db/types/acquisitionSettlement";

export interface PlannedLedger {
  type: "share_buyout_payout" | "share_buyout_outflow" | "corp_dissolution_distribution";
  amount: number;
  currencyCode: string;
  subjectType: "character" | "corporation" | "government";
  /** Holder hex. Absent for government subjects (keyed by `countryId` instead). */
  subjectId?: string;
  subjectName: string;
  countryId?: string;
  counterpartyType: "character" | "corporation" | "government";
  counterpartyId: string;
  counterpartyName?: string;
  meta: Record<string, unknown>;
}

export interface PlannedLeg {
  key: string;
  kind: AcquisitionLegKind;
  collection: "characters" | "imperialCharacters" | "corporations" | "federalBudget" | "indexFunds";
  /** Hex string for `_id` docs, country id for the treasury leg. */
  id: string;
  inc: Record<string, number>;
  pull?: { path: string; selector: Record<string, unknown> };
  guardPath?: string;
  guardGte?: number;
  payoutAnchor: number;
  costInAcquirerCapital: number;
  currencyCode: string;
  note: string;
  ledgers: PlannedLedger[];
}

export interface PayoutPlanInput {
  offerHex: string;
  priceAnchor: number;
  priceInAcquirerCapital: number;
  acquirerHex: string;
  acquirerName: string;
  acquirerCurrency: string;
  /** Pinned acquirer snapshot fields the cost conversion reads. */
  acquirerForCost: CorpCapitalCurrencyInfo | null | undefined;
  acquirerFxRate: number;
  targetHex: string;
  targetName: string;
  targetCountryId: string;
  targetLiquidCurrencyCode?: string | null;
  allocation: ShareholderAllocation;
  /** Recipient home currency by holder hex (characters + imperials). Absent = holder doc missing. */
  currencyByHolderHex: Record<string, string>;
  /** Creditor snapshot by holder hex (corporate holders). Absent = holder doc missing. */
  creditorByHolderHex: Record<string, CorpCapitalCurrencyInfo | null | undefined>;
  /** Fund docs present by fund hex. */
  fundsPresentHex: string[];
  /** Whether the treasury (federalBudget) doc for the target country exists. */
  treasuryPresent: boolean;
  fxByCurrency: Record<string, number>;
  forexEnabled: boolean;
  /** Shell-cash relocation in anchor + acquirer-capital units (0 when none). */
  shellCashAnchor: number;
  shellCashInAcquirerCapital: number;
  /**
   * Shell cash in the TARGET's own units, for the release memo leg. The legacy
   * flush books the release in target units/currency (not acquirer units), so
   * the plan pins both sides to keep the ledger byte-identical.
   */
  shellCashTargetLocal: number;
  targetCurrency: string;
}

export interface PayoutPlan {
  key: string;
  legs: PlannedLeg[];
  /** Holder rows with no payable recipient. Non-empty aborts before money moves. */
  unpayable: Array<{ key: string; reason: string }>;
}

const KIND = "agreed_acquisition";

export function acquisitionSettlementKey(offerHex: string): string {
  return `agreed_acquisition:${offerHex}`;
}

function anchorToLocal(
  payoutAnchor: number,
  currency: string,
  fxByCurrency: Record<string, number>
): number {
  const rate = fxByCurrency[currency];
  return Number.isFinite(rate) && rate && rate > 0 ? payoutAnchor * rate : payoutAnchor;
}

export function buildAcquisitionPayoutPlan(input: PayoutPlanInput): PayoutPlan {
  const key = acquisitionSettlementKey(input.offerHex);
  const legs: PlannedLeg[] = [];
  const unpayable: Array<{ key: string; reason: string }> = [];
  const { allocation, acquirerHex, acquirerName, targetHex, targetName } = input;

  const costOfAnchor = (payoutAnchor: number): number =>
    Math.round(
      anchorToCorpLiquidCapital(payoutAnchor, input.acquirerForCost, input.acquirerFxRate)
    );

  const counterparty = {
    counterpartyType: "corporation" as const,
    counterpartyId: targetHex,
    counterpartyName: targetName,
  };

  if (input.priceInAcquirerCapital > 0) {
    legs.push({
      key: "debit",
      kind: "acquirer_debit",
      collection: "corporations",
      id: acquirerHex,
      inc: { liquidCapital: -input.priceInAcquirerCapital },
      guardPath: "liquidCapital",
      guardGte: input.priceInAcquirerCapital,
      payoutAnchor: 0,
      costInAcquirerCapital: 0,
      currencyCode: input.acquirerCurrency,
      note: "acquirer pays the agreed price",
      ledgers: [
        {
          type: "share_buyout_outflow",
          amount: -input.priceInAcquirerCapital,
          currencyCode: input.acquirerCurrency,
          subjectType: "corporation",
          subjectId: acquirerHex,
          subjectName: acquirerName,
          ...counterparty,
          meta: { kind: KIND, offerId: input.offerHex },
        },
      ],
    });
  }

  for (const row of allocation.characterRows) {
    if (!(row.payout > 0)) continue;
    const currency = input.currencyByHolderHex[row.characterId];
    if (!currency) {
      unpayable.push({
        key: `holder:${row.isImperial ? "imperial" : "character"}:${row.characterId}`,
        reason: "holder document no longer exists",
      });
      continue;
    }
    const amt = input.forexEnabled
      ? anchorToLocal(row.payout, currency, input.fxByCurrency)
      : row.payout;
    const imperial = row.isImperial === true;
    legs.push({
      key: `holder:${imperial ? "imperial" : "character"}:${row.characterId}`,
      kind: "holder_credit",
      collection: imperial ? "imperialCharacters" : "characters",
      id: row.characterId,
      inc: buildPersonalBalanceInc(amt, currency as CurrencyCode, input.forexEnabled),
      payoutAnchor: row.payout,
      costInAcquirerCapital: costOfAnchor(row.payout),
      currencyCode: currency,
      note: imperial ? "imperial holder buyout credit" : "holder buyout credit",
      ledgers: [
        {
          type: "share_buyout_payout",
          amount: Math.round(amt),
          currencyCode: currency,
          subjectType: "character",
          subjectId: row.characterId,
          subjectName: "(shareholder)",
          ...counterparty,
          meta: { kind: KIND, ...(imperial ? { imperial: true } : {}) },
        },
      ],
    });
  }

  for (const row of allocation.corporationRows) {
    if (!(row.payout > 0)) continue;
    const creditor = input.creditorByHolderHex[row.corporationId];
    if (!creditor) {
      unpayable.push({
        key: `holder:corporation:${row.corporationId}`,
        reason: "holder corporation no longer exists",
      });
      continue;
    }
    const creditorCurrency = (creditor.liquidCurrencyCode ??
      COUNTRY_CURRENCY_MAP[creditor.countryId as CountryId] ??
      "USD") as CurrencyCode;
    const rate = input.fxByCurrency[creditorCurrency] ?? 1;
    const amtInCapital = Math.round(anchorToCorpLiquidCapital(row.payout, creditor, rate));
    legs.push({
      key: `holder:corporation:${row.corporationId}`,
      kind: "holder_credit",
      collection: "corporations",
      id: row.corporationId,
      inc: { liquidCapital: amtInCapital },
      payoutAnchor: row.payout,
      costInAcquirerCapital: costOfAnchor(row.payout),
      currencyCode: creditorCurrency,
      note: "corporate holder buyout credit",
      ledgers: [
        {
          type: "share_buyout_payout",
          amount: Math.round(amtInCapital),
          currencyCode: creditorCurrency,
          subjectType: "corporation",
          subjectId: row.corporationId,
          subjectName: "(corp shareholder)",
          ...counterparty,
          meta: { kind: KIND },
        },
      ],
    });
  }

  if (allocation.publicFloatRow && allocation.publicFloatRow.payout > 0) {
    if (!input.treasuryPresent) {
      unpayable.push({ key: "holder:treasury", reason: "treasury account is missing" });
    } else {
      const floatCurrency = (input.targetLiquidCurrencyCode ??
        COUNTRY_CURRENCY_MAP[input.targetCountryId as CountryId] ??
        "USD") as CurrencyCode;
      const rate = input.fxByCurrency[floatCurrency] ?? 1;
      const floatLocal = Math.round(
        writeGovBudgetLocal(allocation.publicFloatRow.payout, floatCurrency, rate)
      );
      legs.push({
        key: "holder:treasury",
        kind: "holder_credit",
        collection: "federalBudget",
        id: input.targetCountryId,
        inc: { treasuryBalance: floatLocal },
        payoutAnchor: allocation.publicFloatRow.payout,
        costInAcquirerCapital: costOfAnchor(allocation.publicFloatRow.payout),
        currencyCode: floatCurrency,
        note: "public-float buyout credit to the treasury",
        ledgers: [
          {
            type: "share_buyout_payout",
            amount: Math.round(floatLocal),
            currencyCode: floatCurrency,
            subjectType: "government",
            subjectName: `${input.targetCountryId} treasury`,
            countryId: input.targetCountryId,
            ...counterparty,
            meta: { kind: KIND, side: "public_float" },
          },
        ],
      });
    }
  }

  const fundsPresent = new Set(input.fundsPresentHex);
  for (const row of allocation.fundRows) {
    if (!(row.payout > 0)) continue;
    if (!fundsPresent.has(row.fundId)) {
      unpayable.push({ key: `holder:fund:${row.fundId}`, reason: "index fund no longer exists" });
      continue;
    }
    legs.push({
      key: `holder:fund:${row.fundId}`,
      kind: "holder_credit",
      collection: "indexFunds",
      id: row.fundId,
      inc: { cashAnchor: row.payout },
      // Idempotent cleanup first: dropping an already-removed holding is a
      // no-op, so a crash between the pull and the credit still credits once.
      pull: { path: "holdings", selector: { corporationId: targetHex } },
      payoutAnchor: row.payout,
      costInAcquirerCapital: costOfAnchor(row.payout),
      currencyCode: "USD",
      note: "index-fund holder buyout credit",
      // No ledger: fund cash is not yet a ledger account, same as the legacy flow.
      ledgers: [],
    });
  }

  // Legacy gates are `targetCashAnchor > 0` (money + absorb memo) and raw target
  // cash `> 0` (release memo). A positive anchor implies positive raw cash, so
  // one gate covers both; the dust corner (anchor > 0 converting to exactly 0,
  // where legacy emits only the release memo) is documented and not replicated.
  if (input.shellCashAnchor > 0 && input.shellCashInAcquirerCapital > 0) {
    legs.push({
      key: "shell-cash",
      kind: "shell_cash_credit",
      collection: "corporations",
      id: acquirerHex,
      inc: { liquidCapital: input.shellCashInAcquirerCapital },
      payoutAnchor: input.shellCashAnchor,
      costInAcquirerCapital: input.shellCashInAcquirerCapital,
      currencyCode: input.acquirerCurrency,
      note: "target shell cash relocates to the acquirer",
      ledgers: [
        {
          type: "corp_dissolution_distribution",
          amount: input.shellCashInAcquirerCapital,
          currencyCode: input.acquirerCurrency,
          subjectType: "corporation",
          subjectId: acquirerHex,
          subjectName: acquirerName,
          counterpartyType: "corporation",
          counterpartyId: targetHex,
          counterpartyName: targetName,
          meta: { kind: KIND, side: "shell_cash_absorbed" },
        },
        {
          type: "corp_dissolution_distribution",
          amount: -input.shellCashTargetLocal,
          currencyCode: input.targetCurrency,
          subjectType: "corporation",
          subjectId: targetHex,
          subjectName: targetName,
          counterpartyType: "corporation",
          counterpartyId: acquirerHex,
          counterpartyName: acquirerName,
          meta: { kind: KIND, side: "shell_cash_released" },
        },
      ],
    });
  }

  return { key, legs, unpayable };
}
