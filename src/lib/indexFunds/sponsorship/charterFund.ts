import { fundCreationEligibility } from "./eligibility";
import { bankMayManageFunds, fundBankCharter } from "./rules/eligibility";
import { validatePickedStocks, type PickedStockMandate } from "../rules/mandate";
import { ObjectId, type Db } from "mongodb";
import type { Corporation, FederalBudget } from "@/lib/db/types";
import type {
  IndexFund,
  IndexFundKind,
  IndexFundScope,
  IndexFundTransaction,
} from "@/lib/db/types/indexFund";
import type { OperatingSectorType } from "@/lib/constants/corporations";
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
import { withSessionDb, afterCommit } from "@/lib/db/sessionDb";
import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";
import { sponsorSeedUnits } from "./rules/accounting";
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
  sectorType?: OperatingSectorType;
  expenseRatioAnnual: number;
  seedCapitalAnchor: number;
  currentTurn: number;
  pickedStocks?: PickedStockMandate["stocks"];
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
  sponsorSectorTypes: OperatingSectorType[]
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
  const { sponsor } = input;
  const tickerSymbol = input.tickerSymbol.trim().toUpperCase();
  const name = input.name.trim();

  const eligibility = await fundCreationEligibility(db, sponsor, {
    replay: !!(await db
      .collection("indexFunds")
      .findOne({ slug: sponsoredFundSlug(tickerSymbol), sponsorCorporationId: sponsor._id })),
  });
  if (eligibility) return { ok: false, status: 403, error: eligibility };

  return withSessionDb(db, (tx) => commitCharter(tx, input, tickerSymbol, name));
}

async function commitCharter(
  db: Db,
  input: CharterFundInput,
  tickerSymbol: string,
  name: string
): Promise<CharterFundResult> {
  const sponsor = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: input.sponsor._id });
  if (!sponsor || String(sponsor.userId) !== String(input.sponsor.userId))
    return {
      ok: false,
      status: 403,
      error: "Corporation ownership changed. Reload before creating a fund.",
    };
  const eligibility = await fundCreationEligibility(db, sponsor, {
    replay: !!(await db
      .collection("indexFunds")
      .findOne({ slug: sponsoredFundSlug(tickerSymbol), sponsorCorporationId: sponsor._id })),
  });
  if (eligibility) return { ok: false, status: 403, error: eligibility };
  let mandate: PickedStockMandate | undefined;
  const bank = fundBankCharter(sponsor.bankCharter);
  if (bank || input.pickedStocks) {
    if (!bankMayManageFunds(bank))
      return {
        ok: false,
        status: 403,
        error: "An active investment or universal bank charter is required.",
      };
    if (
      input.scope !== "country" ||
      input.countryId !== sponsor.countryId ||
      input.kind !== "broad" ||
      input.sectorType
    )
      return { ok: false, status: 400, error: "Pick companies in the bank's home country." };
    mandate = {
      version: 1,
      mode: "picked_stocks",
      scope: "country",
      kind: "broad",
      countryId: input.countryId,
      anchorCurrencyCode: COUNTRY_CURRENCY_MAP[input.countryId!] ?? "USD",
      cashWeightBps: 2500,
      issuerCapBps: 1500,
      stocks: input.pickedStocks ?? [],
    };
    const invalid = validatePickedStocks(mandate);
    if (invalid) return { ok: false, status: 400, error: invalid };
    const issuers = await db
      .collection<Corporation>("corporations")
      .find(
        {
          _id: { $in: mandate.stocks.map((s) => new ObjectId(s.corporationId)) },
          countryId: sponsor.countryId,
          isPrivate: { $ne: true },
          hiddenFromExchange: { $ne: true },
          isNationalized: { $ne: true },
          countryOwnerId: { $exists: false },
          sharePrice: { $gt: 0 },
          totalShares: { $gt: 0 },
          liquidCapital: { $gte: 0 },
        },
        { projection: { userId: 1, sharePrice: 1 } }
      )
      .toArray();
    if (
      issuers.length !== mandate.stocks.length ||
      issuers.some(
        (c) =>
          c._id.equals(sponsor._id) ||
          String(c.userId) === String(sponsor.userId) ||
          !Number.isFinite(c.sharePrice)
      )
    )
      return {
        ok: false,
        status: 400,
        error: "Pick public companies at home that you do not control.",
      };
  }
  const sectors = await db
    .collection<{ corporationId: ObjectId; sectorType: OperatingSectorType }>("corporateSectors")
    .find({ corporationId: sponsor._id }, { projection: { sectorType: 1 } })
    .toArray();
  const invalid = validateCharter(
    { ...input, tickerSymbol, name },
    sectors.map((sector) => sector.sectorType)
  );
  if (invalid) return { ok: false, status: 400, error: invalid };
  const { currentTurn } = input;
  const slug = sponsoredFundSlug(tickerSymbol);
  const prior = await db.collection<IndexFund>("indexFunds").findOne({ slug });
  if (
    prior &&
    prior.seedAccounting === "paid_units" &&
    String(prior.sponsorCorporationId) === String(sponsor._id) &&
    prior.name === name &&
    prior.scope === input.scope &&
    prior.kind === input.kind &&
    prior.countryId === input.countryId &&
    prior.sectorType === input.sectorType &&
    prior.expenseRatioAnnual === input.expenseRatioAnnual &&
    prior.seedCapitalAnchor === input.seedCapitalAnchor &&
    JSON.stringify(prior.mandate?.mode === "picked_stocks" ? prior.mandate : undefined) ===
      JSON.stringify(mandate)
  )
    return { ok: true, fundId: prior._id, slug };
  // The unique slug index arbitrates concurrent requests for the same contract.
  // Ticker must not collide with an existing fund OR an existing corporation:
  // the two share a namespace on every market surface in the game.
  const [tickerTaken, slugTaken, corpTickerTaken] = await Promise.all([
    db.collection<IndexFund>("indexFunds").countDocuments({ tickerSymbol }),
    db.collection<IndexFund>("indexFunds").countDocuments({ slug }),
    db.collection<Corporation>("corporations").countDocuments({ tickerSymbol }),
  ]);
  if (tickerTaken > 0 || slugTaken > 0 || corpTickerTaken > 0)
    return { ok: false, error: `Ticker ${tickerSymbol} is already in use.`, status: 409 };

  const fxRate = await getCorpFxRate(db, sponsor);
  const feeLocal = Math.round(anchorToCorpLiquidCapital(FUND_CHARTER_FEE_ANCHOR, sponsor, fxRate));
  const seedLocal = anchorToCorpLiquidCapital(input.seedCapitalAnchor, sponsor, fxRate);
  const totalLocal = feeLocal + seedLocal;
  const currencyCode = (resolveCorpLiquidCurrencyCode(sponsor) ?? "USD") as CurrencyCode;

  if (!Number.isFinite(fxRate) || fxRate <= 0) throw new Error("Sponsor exchange rate unavailable");
  const budget = sponsor.countryId
    ? await db.collection<FederalBudget>("federalBudget").findOne({ countryId: sponsor.countryId })
    : null;
  if (!budget || resolveCountryCurrencyCode(budget) !== currencyCode)
    return {
      ok: false,
      status: 400,
      error: "The fund creation fee cannot be settled in this currency.",
    };
  const units = sponsorSeedUnits(input.seedCapitalAnchor, INDEX_FUND_INITIAL_NAV);
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

  const fundId = await insertFund(db, {
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
    unitSupply: units,
    seedAccounting: "paid_units",
    ...(mandate ? { mandate } : {}),
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
  await db.collection("indexFundPositions").insertOne({
    _id: new ObjectId(),
    fundId,
    holderKind: "corporation",
    corporationId: sponsor._id,
    units,
    avgNavAnchor: INDEX_FUND_INITIAL_NAV,
    legacyUnits: 0,
    createdAt: now,
    updatedAt: now,
  });

  // The charter fee is government revenue, not destroyed money: it lands in
  // the sponsor country's treasury (same incorporation-fee treatment as the
  // spin-off path). Capture the credited amount so the treasury leg below is
  // booked for exactly what moved.
  const feeToTreasury = sponsor.countryId
    ? await creditTreasuryProceeds(db, sponsor.countryId as CountryId, feeLocal, now)
    : 0;

  // #992 tranche 3: the corp debit below covers seed + fee while the fund
  // receives the seed alone, so the debit row can never mirror the fund side.
  // Book the fund's seed receipt as its own fund-subject row: single-sided by
  // construction (the sponsor evidences the debit), netting against the debit
  // under the shared seed_capital reason instead of pooling in `unattributed`.
  const charterLegs: Promise<unknown>[] = [
    emitTx(db, {
      type: "corp_capital_seed",
      turn: currentTurn,
      createdAt: now,
      subjectType: "fund",
      subjectId: fundId,
      subjectName: name,
      amount: input.seedCapitalAnchor,
      anchorAmount: input.seedCapitalAnchor,
      currencyCode: anchorCurrencyCode,
      counterpartyType: "system",
      counterpartyName: sponsor.name,
      meta: {
        kind: "fund_charter_seed",
        fundId: fundId.toString(),
        fundCurrency: anchorCurrencyCode,
        seedCapitalAnchor: input.seedCapitalAnchor,
        charterFeeAnchor: FUND_CHARTER_FEE_ANCHOR,
      },
    }),
  ];
  if (feeToTreasury > 0 && sponsor.countryId) {
    charterLegs.push(
      emitTx(db, {
        type: "gov_tax_revenue",
        turn: currentTurn,
        createdAt: now,
        subjectType: "government",
        countryId: sponsor.countryId,
        subjectName: `${sponsor.countryId} treasury`,
        amount: feeToTreasury,
        anchorAmount: feeToTreasury / fxRate,
        currencyCode,
        counterpartyType: "corporation",
        counterpartyId: sponsor._id,
        counterpartyName: sponsor.name,
        meta: { kind: "fund_charter", side: "charter_fee", fundId: fundId.toString() },
      })
    );
  }

  const written = await Promise.all([
    emitTx(db, {
      type: "corp_capital_seed",
      turn: currentTurn,
      createdAt: now,
      subjectType: "corporation",
      subjectId: sponsor._id,
      subjectName: sponsor.name,
      amount: -totalLocal,
      anchorAmount: -(input.seedCapitalAnchor + feeLocal / fxRate),
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
    ...charterLegs,
  ]);
  if (written.includes("failed")) throw new Error("Fund charter witness failed");

  await afterCommit(db, async () => {
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
  });

  return { ok: true, fundId, slug };
}
