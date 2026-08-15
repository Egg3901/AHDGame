/**
 * Charter a sponsored fund.
 *
 * The mandate is deliberately NOT a hand-picked basket of corporations. A
 * sponsor chooses the same two things the seeded funds are defined by — a scope
 * (one country, or global) and a kind (broad, or one industry) — and the
 * existing constituent-eligibility and rebalancing machinery does the rest. A
 * bespoke basket would need its own weighting, its own rebalance rules and its
 * own manipulation guards, and would stop being an index fund somewhere along
 * the way.
 *
 * What the sponsor actually chooses is the business: the name, the fee, and
 * whether to put ₳10m of their corporation's money at risk behind it.
 */

import { ObjectId, type Db } from "mongodb";
import type { Corporation, GameConfig } from "@/lib/db/types";
import type {
  IndexFund,
  IndexFundKind,
  IndexFundScope,
  IndexFundTransaction,
} from "@/lib/db/types/indexFund";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import {
  anchorToCorpLiquidCapital,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { atomicallyDebitCorpLiquidCapital } from "@/lib/financialTxLog/atomicCashGuard";
import { emitTx } from "@/lib/financialTxLog/emit";
import { creditTreasuryProceeds } from "@/lib/nationalization/treasury";
import { insertFund } from "@/lib/indexFunds/fundQueries";
import { INDEX_FUND_INITIAL_NAV } from "@/lib/indexFunds/unitAccounting";
import { recordAudit } from "@/lib/audit/recordAudit";
import {
  FUND_CHARTER_FEE_ANCHOR,
  FUND_MIN_SEED_CAPITAL_ANCHOR,
  FUND_SPONSOR_SECTOR,
  MAX_EXPENSE_RATIO_ANNUAL,
  MIN_EXPENSE_RATIO_ANNUAL,
} from "./constants";

const FUND_TX = "indexFundTransactions";

export interface CharterFundInput {
  sponsor: Corporation;
  name: string;
  tickerSymbol: string;
  scope: IndexFundScope;
  countryId?: CountryId;
  kind: IndexFundKind;
  sectorType?: CorporationType;
  expenseRatioAnnual: number;
  seedCapitalAnchor: number;
  currentTurn: number;
}

export type CharterFundResult =
  { ok: false; error: string; status: number } | { ok: true; fundId: ObjectId; slug: string };

/**
 * Validate a proposed charter WITHOUT touching the database. Exported so the
 * form can show the same refusals the command enforces.
 */
export function validateCharter(
  input: Pick<
    CharterFundInput,
    | "name"
    | "tickerSymbol"
    | "scope"
    | "countryId"
    | "kind"
    | "sectorType"
    | "expenseRatioAnnual"
    | "seedCapitalAnchor"
  >,
  sponsorSectorTypes: CorporationType[]
): string | null {
  if (!sponsorSectorTypes.includes(FUND_SPONSOR_SECTOR))
    return "Only a corporation with a financial sector can sponsor a fund.";

  const name = input.name.trim();
  if (name.length < 4 || name.length > 60) return "Fund name must be 4 to 60 characters.";
  if (!/^[A-Z]{3,8}$/.test(input.tickerSymbol)) return "Ticker must be 3 to 8 uppercase letters.";

  if (input.scope === "country" && !input.countryId)
    return "A country-scoped fund needs a country.";
  if (input.scope === "global" && input.countryId)
    return "A global fund cannot also name a country.";
  if (input.kind === "sector" && !input.sectorType) return "A sector fund needs an industry.";
  if (input.kind === "broad" && input.sectorType)
    return "A broad fund cannot also name an industry.";

  if (
    !Number.isFinite(input.expenseRatioAnnual) ||
    input.expenseRatioAnnual < MIN_EXPENSE_RATIO_ANNUAL ||
    input.expenseRatioAnnual > MAX_EXPENSE_RATIO_ANNUAL
  )
    return `Expense ratio must be between ${(MIN_EXPENSE_RATIO_ANNUAL * 100).toFixed(2)}% and ${(MAX_EXPENSE_RATIO_ANNUAL * 100).toFixed(2)}%.`;

  if (
    !Number.isFinite(input.seedCapitalAnchor) ||
    input.seedCapitalAnchor < FUND_MIN_SEED_CAPITAL_ANCHOR
  )
    return `Seed capital must be at least ₳${FUND_MIN_SEED_CAPITAL_ANCHOR.toLocaleString()}.`;

  return null;
}

/** Slug from the ticker, which is already uniqueness-checked. */
export function sponsoredFundSlug(tickerSymbol: string): string {
  return `sponsored-${tickerSymbol.toLowerCase()}`;
}

export async function charterFund(db: Db, input: CharterFundInput): Promise<CharterFundResult> {
  const { sponsor, currentTurn } = input;
  const tickerSymbol = input.tickerSymbol.trim().toUpperCase();
  const name = input.name.trim();

  // Player fund sponsorship is gated until explicitly enabled: the default
  // (system) funds trade normally, but corporations cannot charter their own.
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { playerFundSponsorshipEnabled: 1 } });
  if (!config?.playerFundSponsorshipEnabled) {
    return {
      ok: false,
      error: "Player-sponsored index funds are not available yet.",
      status: 403,
    };
  }

  const sectors = await db
    .collection<{ corporationId: ObjectId; sectorType: CorporationType }>("corporateSectors")
    .find({ corporationId: sponsor._id })
    .project<{ sectorType: CorporationType }>({ sectorType: 1 })
    .toArray();
  const invalid = validateCharter(
    { ...input, tickerSymbol, name },
    sectors.map((s) => s.sectorType)
  );
  if (invalid) return { ok: false, error: invalid, status: 400 };

  // Bank / fund separation: a corporation that runs a bank may not also sponsor
  // an index fund. Enforced at creation only, so corporations that already hold
  // both (pre-rule) are grandfathered. The mirror check lives in
  // `banking/charter.ts` checkCharterEligibility.
  if (sponsor.bankCharter?.status === "active") {
    return {
      ok: false,
      status: 400,
      error:
        "A corporation that operates a bank cannot also sponsor an index fund. Wind down the bank charter first.",
    };
  }

  // Ticker must not collide with an existing fund OR an existing corporation:
  // the two share a namespace on every market surface in the game.
  const slug = sponsoredFundSlug(tickerSymbol);
  const [tickerTaken, slugTaken, corpTickerTaken] = await Promise.all([
    db.collection<IndexFund>("indexFunds").countDocuments({ tickerSymbol }),
    db.collection<IndexFund>("indexFunds").countDocuments({ slug }),
    db.collection<Corporation>("corporations").countDocuments({ tickerSymbol }),
  ]);
  if (tickerTaken > 0 || slugTaken > 0 || corpTickerTaken > 0)
    return { ok: false, error: `Ticker ${tickerSymbol} is already in use.`, status: 409 };

  const totalAnchor = FUND_CHARTER_FEE_ANCHOR + input.seedCapitalAnchor;
  const fxRate = await getCorpFxRate(db, sponsor);
  const totalLocal = Math.round(anchorToCorpLiquidCapital(totalAnchor, sponsor, fxRate));
  const currencyCode = (resolveCorpLiquidCurrencyCode(sponsor) ?? "USD") as CurrencyCode;

  const debit = await atomicallyDebitCorpLiquidCapital(db, sponsor._id, totalLocal);
  if (!debit.ok)
    return {
      ok: false,
      status: 400,
      error: `Chartering this fund costs ${totalLocal.toLocaleString()} ${currencyCode} (₳${FUND_CHARTER_FEE_ANCHOR.toLocaleString()} fee plus seed capital). The corporation cannot cover it.`,
    };

  const now = new Date();
  const anchorCurrencyCode = (
    input.scope === "country" && input.countryId
      ? (COUNTRY_CURRENCY_MAP[input.countryId] ?? "USD")
      : "USD"
  ) as CurrencyCode;

  let fundId: ObjectId;
  try {
    fundId = await insertFund(db, {
      slug,
      name,
      tickerSymbol,
      scope: input.scope,
      kind: input.kind,
      ...(input.countryId ? { countryId: input.countryId } : {}),
      ...(input.sectorType ? { sectorType: input.sectorType } : {}),
      anchorCurrencyCode,
      status: "active",
      quotedNav: INDEX_FUND_INITIAL_NAV,
      // The seed buys no units. The sponsor's return is the expense ratio, not
      // an investor's stake in the fund's holdings — which is what keeps the
      // sponsor's incentive pointed at attracting holders rather than at
      // trading against them.
      unitSupply: 0,
      reserveUnits: 0,
      cashAnchor: input.seedCapitalAnchor,
      targetConstituents: [],
      holdings: [],
      sponsorCorporationId: sponsor._id,
      sponsorName: sponsor.name,
      expenseRatioAnnual: input.expenseRatioAnnual,
      charteredAtTurn: currentTurn,
      seedCapitalAnchor: input.seedCapitalAnchor,
      feesPaidToSponsorAnchor: 0,
      createdAt: now,
      updatedAt: now,
    } as Omit<IndexFund, "_id">);
  } catch (err) {
    // Nothing has moved except the debit; give it back rather than stranding it.
    await db
      .collection<Corporation>("corporations")
      .updateOne({ _id: sponsor._id }, { $inc: { liquidCapital: totalLocal } });
    throw err;
  }

  const feeLocal = Math.round(anchorToCorpLiquidCapital(FUND_CHARTER_FEE_ANCHOR, sponsor, fxRate));
  if (sponsor.countryId) {
    await creditTreasuryProceeds(db, sponsor.countryId as CountryId, feeLocal, now);
  }

  await Promise.all([
    emitTx(db, {
      type: "corp_capital_seed",
      turn: currentTurn,
      createdAt: now,
      subjectType: "corporation",
      subjectId: sponsor._id,
      subjectName: sponsor.name,
      amount: -totalLocal,
      currencyCode,
      counterpartyType: "government",
      counterpartyName: `${sponsor.countryId} treasury`,
      meta: {
        kind: "fund_charter",
        fundId: fundId.toString(),
        tickerSymbol,
        charterFeeAnchor: FUND_CHARTER_FEE_ANCHOR,
        seedCapitalAnchor: input.seedCapitalAnchor,
      },
    }),
    db.collection<IndexFundTransaction>(FUND_TX).insertOne({
      _id: new ObjectId(),
      fundId,
      kind: "sponsor_seed_capital",
      turn: currentTurn,
      corporationId: sponsor._id,
      amountAnchor: input.seedCapitalAnchor,
      note: `Seed capital from ${sponsor.name}`,
      createdAt: now,
    } as IndexFundTransaction),
  ]);

  recordAudit({
    source: "api",
    action: "indexFund.charter",
    category: "money",
    turn: currentTurn,
    ts: now,
    subject: { type: "corporation", id: sponsor._id, name: sponsor.name },
    refs: { corporationId: sponsor._id },
    outcome: "ok",
    meta: {
      fundId,
      tickerSymbol,
      scope: input.scope,
      kind: input.kind,
      countryId: input.countryId,
      sectorType: input.sectorType,
      expenseRatioAnnual: input.expenseRatioAnnual,
      seedCapitalAnchor: input.seedCapitalAnchor,
    },
  });

  return { ok: true, fundId, slug };
}
