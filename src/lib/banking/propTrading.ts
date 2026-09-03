import { ObjectId, type Db } from "mongodb";
import type { BankCharter, PropPosition } from "@/lib/db/types/bank";
import type { Bond } from "@/lib/db/types/bond";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import type { Corporation } from "@/lib/db/types";
import type { IndexFund } from "@/lib/db/types/indexFund";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { ZOD_CURRENCY_ENUM } from "@/lib/constants/currencies";
import {
  anchorToCorpCapital,
  corpCapitalToAnchor,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
  shareTradeAnchorValue,
} from "@/lib/currency/corporationCapital";
import { isBankPropTradingEnabled } from "@/lib/banking/featureFlag";
import { mayDistribute } from "./capitalAdequacy";
import { getCashReserves } from "./bankCash";
import { charterMay } from "@/lib/banking/rules/capabilities";
import { emitTx } from "@/lib/financialTxLog/emit";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { escapeRegex } from "@/lib/utils/escapeRegex";

/** Provisional - max propBookMarkValue / equityBase. */
export const PROP_LEVERAGE_MULTIPLE = 3;

/** Provisional - max forex mark value per currency as a fraction of equityBase. */
export const PER_CURRENCY_FOREX_CAP_FRACTION = 0.5;

function isCurrencyCode(value: string): value is CurrencyCode {
  return (ZOD_CURRENCY_ENUM as readonly string[]).includes(value);
}

export type PropAsset = PropPosition["asset"];

export type OpenPositionInput = {
  asset: PropAsset;
  ref: string;
  units: number;
};

export type OpenPositionResult =
  | {
      ok: true;
      position: PropPosition;
      cost: number;
      cashReserves: number;
      propBookMarkValue: number;
    }
  | { ok: false; error: string };

export type ClosePositionResult =
  | {
      ok: true;
      proceeds: number;
      realizedPnl: number;
      cashReserves: number;
      propBookMarkValue: number;
    }
  | { ok: false; error: string };

export type MarkBookResult = {
  positions: PropPosition[];
  propBookMarkValue: number;
};

type ResolvedPositionRef = { ok: true; ref: string } | { ok: false; error: string };

function finiteOrZero(value: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isPropCharter(charter: BankCharter | undefined): charter is BankCharter {
  return charterMay(charter, "proprietaryTrading");
}

/**
 * Player-facing prop tickets can identify an equity by its displayed company
 * name or public sequential ID. Positions always retain the canonical ObjectId
 * so subsequent marks, closes, and duplicate detection are unambiguous.
 */
async function resolvePositionRef(
  db: Db,
  asset: PropAsset,
  submittedRef: string
): Promise<ResolvedPositionRef> {
  const ref = submittedRef.trim();
  if (!ref) return { ok: false, error: "Position ref is required" };

  if (asset === "forex") {
    const currency = ref.toUpperCase();
    return isCurrencyCode(currency)
      ? { ok: true, ref: currency }
      : { ok: false, error: "Forex ref must be a currency code" };
  }

  if (asset !== "equity") {
    if (asset === "bond") {
      return ObjectId.isValid(ref)
        ? { ok: true, ref: new ObjectId(ref).toString() }
        : { ok: false, error: "Bond positions require a valid id" };
    }
    if (ObjectId.isValid(ref)) return { ok: true, ref: new ObjectId(ref).toString() };
    const fund = await db.collection<IndexFund>("indexFunds").findOne(
      {
        $or: [
          { slug: ref.toLowerCase() },
          { name: { $regex: `^${escapeRegex(ref)}$`, $options: "i" } },
        ],
      },
      { projection: { _id: 1 } }
    );
    return fund
      ? { ok: true, ref: fund._id.toString() }
      : { ok: false, error: "Index fund not found" };
  }

  const corporations = db.collection<Corporation>("corporations");
  let corporation: Pick<Corporation, "_id"> | null = null;
  if (ObjectId.isValid(ref)) {
    corporation = await corporations.findOne(
      { _id: new ObjectId(ref) },
      { projection: { _id: 1 } }
    );
  } else if (/^\d+$/.test(ref)) {
    corporation = await corporations.findOne(
      { sequentialId: Number(ref) },
      { projection: { _id: 1 } }
    );
  } else {
    corporation = await corporations.findOne(
      { name: { $regex: `^${escapeRegex(ref)}$`, $options: "i" } },
      { projection: { _id: 1 } }
    );
  }

  return corporation
    ? { ok: true, ref: corporation._id.toString() }
    : { ok: false, error: "Equity corporation not found" };
}

/**
 * Equity base for prop leverage: bank cash + prop mark - interbank debt - CB
 * margin debt. Corporations have no CB savings surface (characters do), so
 * nothing is netted for CB-held savings.
 *
 * `postedCapital` is deliberately absent. Posting capital moves cash into
 * `cashReserves` and increments the memo, so adding both counted the same money
 * twice and handed every bank a free slice of leverage headroom equal to its
 * contributed capital.
 */
export function computePropEquityBase(
  cashReserves: number,
  charter: Pick<BankCharter, "propBookMarkValue" | "interbankDebt" | "cbMarginDebt" | "propBook">,
  markValueOverride?: number
): number {
  const liquid = Math.max(0, finiteOrZero(cashReserves));
  const mark =
    markValueOverride !== undefined
      ? Math.max(0, finiteOrZero(markValueOverride))
      : charter.propBookMarkValue !== undefined
        ? Math.max(0, finiteOrZero(charter.propBookMarkValue))
        : sumPositionMarks(charter.propBook);
  const interbank = Math.max(0, finiteOrZero(charter.interbankDebt ?? 0));
  const margin = Math.max(0, finiteOrZero(charter.cbMarginDebt ?? 0));
  return liquid + mark - interbank - margin;
}

export function sumPositionMarks(positions: PropPosition[] | undefined): number {
  if (!positions || positions.length === 0) return 0;
  let total = 0;
  for (const p of positions) {
    total += Math.max(0, finiteOrZero(p.markValue ?? p.costBasis));
  }
  return total;
}

function forexMarkByCurrency(positions: PropPosition[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of positions) {
    if (p.asset !== "forex") continue;
    const key = p.ref;
    map.set(key, (map.get(key) ?? 0) + Math.max(0, finiteOrZero(p.markValue ?? p.costBasis)));
  }
  return map;
}

/**
 * Resolve a single position's mark value in the bank's home currency.
 * Price sources:
 * - equity: corporation.sharePrice (local) via shareTradeAnchorValue → home FX
 * - indexUnit: indexFunds.quotedNav (anchor) → home FX
 * - bond: units × BOND_UNIT_FACE_VALUE × marketPrice in bond currency → home FX
 * - forex: foreign units converted through FX rates (local per ₳)
 */
export async function markPositionValue(
  db: Db,
  position: Pick<PropPosition, "asset" | "ref" | "units">,
  homeCurrency: CurrencyCode,
  fxRates?: Map<CurrencyCode, number>
): Promise<number> {
  const units = finiteOrZero(position.units);
  if (!(units > 0)) return 0;

  const rates = fxRates ?? (await loadFxRatesByCurrency(db));
  const homeRate = rates.get(homeCurrency) ?? 1;

  if (position.asset === "equity") {
    if (!ObjectId.isValid(position.ref)) return 0;
    const corp = await db
      .collection<Corporation>("corporations")
      .findOne(
        { _id: new ObjectId(position.ref) },
        { projection: { sharePrice: 1, liquidCurrencyCode: 1, countryId: 1 } }
      );
    if (!corp) return 0;
    const corpCode = resolveCorpLiquidCurrencyCode(corp);
    const corpRate = corpCode ? (rates.get(corpCode) ?? 1) : 1;
    const anchor = shareTradeAnchorValue(units, corp, corpRate);
    return anchorToCorpCapital(anchor, homeCurrency, homeRate);
  }

  if (position.asset === "indexUnit") {
    if (!ObjectId.isValid(position.ref)) return 0;
    const fund = await db
      .collection<IndexFund>("indexFunds")
      .findOne({ _id: new ObjectId(position.ref) }, { projection: { quotedNav: 1 } });
    const navAnchor = finiteOrZero(fund?.quotedNav ?? 0);
    return anchorToCorpCapital(units * navAnchor, homeCurrency, homeRate);
  }

  if (position.asset === "bond") {
    if (!ObjectId.isValid(position.ref)) return 0;
    const bond = await db
      .collection<Bond>("bonds")
      .findOne(
        { _id: new ObjectId(position.ref) },
        { projection: { marketPrice: 1, faceValue: 1, countryId: 1, corporationId: 1 } }
      );
    if (!bond) return 0;
    const face = finiteOrZero(bond.faceValue) || BOND_UNIT_FACE_VALUE;
    const price = finiteOrZero(bond.marketPrice);
    const localFace = units * face * price;
    // Bond face is in the issuer's currency; resolve via issuer corp when possible.
    let bondCurrency: CurrencyCode | undefined;
    if (bond.corporationId) {
      const issuer = await db
        .collection<Corporation>("corporations")
        .findOne(
          { _id: bond.corporationId },
          { projection: { liquidCurrencyCode: 1, countryId: 1 } }
        );
      bondCurrency = resolveCorpLiquidCurrencyCode(issuer) ?? undefined;
    }
    if (bondCurrency && bondCurrency !== homeCurrency) {
      const bondRate = rates.get(bondCurrency) ?? 1;
      const anchor = corpCapitalToAnchor(localFace, bondCurrency, bondRate);
      return anchorToCorpCapital(anchor, homeCurrency, homeRate);
    }
    return localFace;
  }

  // forex: ref is the foreign currency code; units are foreign face amount.
  if (!isCurrencyCode(position.ref)) return 0;
  const foreign = position.ref as CurrencyCode;
  if (foreign === homeCurrency) return units;
  const foreignRate = rates.get(foreign) ?? 1;
  const anchor = corpCapitalToAnchor(units, foreign, foreignRate);
  return anchorToCorpCapital(anchor, homeCurrency, homeRate);
}

/** Mark every position; returns a new array with fresh markValue fields. */
export async function markBook(db: Db, charter: BankCharter): Promise<MarkBookResult> {
  const homeCurrency = charter.currency as CurrencyCode;
  const book = charter.propBook ?? [];
  if (book.length === 0) {
    return { positions: [], propBookMarkValue: 0 };
  }
  const fxRates = await loadFxRatesByCurrency(db);
  const positions: PropPosition[] = [];
  let total = 0;
  for (const p of book) {
    const markValue = await markPositionValue(db, p, homeCurrency, fxRates);
    positions.push({ ...p, markValue });
    total += markValue;
  }
  return { positions, propBookMarkValue: total };
}

/**
 * Open (or add to) a prop position. Buys debit the bank's reserves at the live mark
 * into the position cost basis; the market is the cash counterparty (same cash
 * leg shape as float share trading: buyer pays mark × units up front).
 */
export async function openPosition(
  db: Db,
  corporationId: ObjectId,
  input: OpenPositionInput
): Promise<OpenPositionResult> {
  if (!(await isBankPropTradingEnabled())) {
    return { ok: false, error: "Prop trading is not enabled" };
  }
  if (!Number.isFinite(input.units) || !(input.units > 0)) {
    return { ok: false, error: "Units must be a positive number" };
  }
  if (!input.ref || typeof input.ref !== "string")
    return { ok: false, error: "Position ref is required" };
  const resolvedRef = await resolvePositionRef(db, input.asset, input.ref);
  if (!resolvedRef.ok) return resolvedRef;
  const positionInput = { ...input, ref: resolvedRef.ref };

  const corp = await db.collection<Corporation>("corporations").findOne({ _id: corporationId });
  if (!corp) return { ok: false, error: "Corporation not found" };
  const charter = corp.bankCharter;
  if (!isPropCharter(charter)) {
    return {
      ok: false,
      error: "Only active investment or universal charters may run a prop book",
    };
  }

  // B7: a bank that fails the supervisory capital test may not take on NEW
  // risk. Closing positions stays open — forcing a thin bank to hold a book it
  // cannot support would be the opposite of the intent.
  if (charter.capitalStanding && !mayDistribute(charter.capitalStanding)) {
    return {
      ok: false,
      error:
        charter.capitalStanding === "undercapitalized"
          ? "This bank is below the minimum capital requirement and cannot open new positions until it recapitalizes."
          : "This bank does not survive the supervisory stress scenario and cannot open new positions until its capital improves.",
    };
  }

  const homeCurrency = charter.currency as CurrencyCode;
  const cost = await markPositionValue(
    db,
    { asset: positionInput.asset, ref: positionInput.ref, units: positionInput.units },
    homeCurrency
  );
  if (!(cost > 0)) {
    return { ok: false, error: "Could not price position (missing market data)" };
  }

  const liquid = getCashReserves(corp.bankCharter);
  if (cost > liquid + 1e-9) {
    return { ok: false, error: "Insufficient liquid capital for purchase" };
  }

  const marked = await markBook(db, charter);
  const nextBook = marked.positions.map((p) => ({ ...p }));
  const existingIdx = nextBook.findIndex(
    (p) => p.asset === positionInput.asset && p.ref === positionInput.ref
  );
  if (existingIdx >= 0) {
    const prev = nextBook[existingIdx]!;
    nextBook[existingIdx] = {
      ...prev,
      units: prev.units + positionInput.units,
      costBasis: prev.costBasis + cost,
      markValue: (prev.markValue ?? prev.costBasis) + cost,
    };
  } else {
    nextBook.push({
      asset: positionInput.asset,
      ref: positionInput.ref,
      units: positionInput.units,
      costBasis: cost,
      markValue: cost,
    });
  }

  const nextMark = sumPositionMarks(nextBook);
  const nextLiquid = liquid - cost;
  const equity = computePropEquityBase(nextLiquid, charter, nextMark);
  if (equity <= 0 || nextMark > PROP_LEVERAGE_MULTIPLE * equity + 1e-9) {
    return { ok: false, error: "Trade would breach prop leverage multiple" };
  }

  if (positionInput.asset === "forex") {
    const byCcy = forexMarkByCurrency(nextBook);
    const cap = PER_CURRENCY_FOREX_CAP_FRACTION * equity;
    const ccyMark = byCcy.get(positionInput.ref) ?? 0;
    if (ccyMark > cap + 1e-9) {
      return { ok: false, error: "Trade would breach per-currency forex cap" };
    }
  }

  const updated = await db.collection<Corporation>("corporations").updateOne(
    {
      _id: corporationId,
      "bankCharter.status": "active",
      "bankCharter.cashReserves": { $gte: cost },
      // Re-gate the supervisory standing IN the write, not just on the read
      // above. Between the two the solvency pass can mark this bank stressed or
      // undercapitalized, and putting depositor cash at risk on a bank the
      // supervisor has just barred from taking risk is the check-then-write
      // hole every other distribution path has already closed.
      $or: [
        { "bankCharter.capitalStanding": { $exists: false } },
        { "bankCharter.capitalStanding": "adequate" },
      ],
    },
    {
      $inc: { "bankCharter.cashReserves": -cost },
      $set: {
        "bankCharter.propBook": nextBook,
        "bankCharter.propBookMarkValue": nextMark,
        updatedAt: new Date(),
      },
    }
  );
  if (updated.matchedCount !== 1) {
    return { ok: false, error: "Failed to settle purchase (capital moved)" };
  }

  // A trade is a RECLASS between the bank's cash and its own trading book, not
  // a loss, so only the cash side is a money movement and it derives to the
  // shared `prop_book` reason. Same shape as capacity capex: the contra side is
  // an asset account the shadow ledger does not carry, and pairing both
  // directions on one reason lets the reconciler net a purchase against its own
  // sale instead of reporting two unrelated single-sided flows.
  await emitTx(db, {
    type: "bank_prop_trade_buy",
    turn: await getCurrentTurn(db),
    createdAt: new Date(),
    subjectType: "corporation",
    subjectId: corporationId,
    subjectName: corp.name,
    amount: -cost,
    currencyCode: homeCurrency,
    counterpartyType: "system",
    counterpartyName: "Prop book",
    meta: { asset: positionInput.asset, ref: positionInput.ref, units: positionInput.units },
  });

  const position = nextBook.find(
    (p) => p.asset === positionInput.asset && p.ref === positionInput.ref
  )!;
  return {
    ok: true,
    position,
    cost,
    cashReserves: nextLiquid,
    propBookMarkValue: nextMark,
  };
}

/**
 * Close units of a prop position at the live mark. Credits the bank's reserves;
 * realized P&L is proceeds vs pro-rata cost basis (market is cash counterparty).
 */
export async function closePosition(
  db: Db,
  corporationId: ObjectId,
  input: OpenPositionInput
): Promise<ClosePositionResult> {
  if (!(await isBankPropTradingEnabled())) {
    return { ok: false, error: "Prop trading is not enabled" };
  }
  if (!Number.isFinite(input.units) || !(input.units > 0)) {
    return { ok: false, error: "Units must be a positive number" };
  }

  const corp = await db.collection<Corporation>("corporations").findOne({ _id: corporationId });
  if (!corp) return { ok: false, error: "Corporation not found" };
  const charter = corp.bankCharter;
  if (!isPropCharter(charter)) {
    return {
      ok: false,
      error: "Only active investment or universal charters may run a prop book",
    };
  }

  const book = charter.propBook ?? [];
  const idx = book.findIndex((p) => p.asset === input.asset && p.ref === input.ref);
  if (idx < 0) return { ok: false, error: "Position not found" };
  const held = book[idx]!;
  if (input.units > held.units + 1e-12) {
    return { ok: false, error: "Cannot close more units than held" };
  }

  const homeCurrency = charter.currency as CurrencyCode;
  const proceeds = await markPositionValue(
    db,
    { asset: input.asset, ref: input.ref, units: input.units },
    homeCurrency
  );
  const fraction = input.units / held.units;
  const costReleased = held.costBasis * fraction;
  const realizedPnl = proceeds - costReleased;

  const nextBook = book.map((p) => ({ ...p }));
  if (input.units >= held.units - 1e-12) {
    nextBook.splice(idx, 1);
  } else {
    const prev = nextBook[idx]!;
    nextBook[idx] = {
      ...prev,
      units: prev.units - input.units,
      costBasis: prev.costBasis - costReleased,
      markValue: Math.max(0, (prev.markValue ?? prev.costBasis) - proceeds),
    };
  }

  const nextMark = sumPositionMarks(nextBook);
  const nextLiquid = Math.max(0, getCashReserves(corp.bankCharter) + proceeds);

  const updated = await db.collection<Corporation>("corporations").updateOne(
    {
      _id: corporationId,
      "bankCharter.status": "active",
    },
    {
      $inc: { "bankCharter.cashReserves": proceeds },
      $set: {
        "bankCharter.propBook": nextBook,
        "bankCharter.propBookMarkValue": nextMark,
        updatedAt: new Date(),
      },
    }
  );
  if (updated.matchedCount !== 1) {
    return { ok: false, error: "Failed to settle sale" };
  }

  await emitTx(db, {
    type: "bank_prop_trade_sell",
    turn: await getCurrentTurn(db),
    createdAt: new Date(),
    subjectType: "corporation",
    subjectId: corporationId,
    subjectName: corp.name,
    amount: proceeds,
    currencyCode: homeCurrency,
    counterpartyType: "system",
    counterpartyName: "Prop book",
    meta: { asset: input.asset, ref: input.ref, units: input.units },
  });

  return {
    ok: true,
    proceeds,
    realizedPnl,
    cashReserves: nextLiquid,
    propBookMarkValue: nextMark,
  };
}

/**
 * Proportionally shrink every position so markValue <= PROP_LEVERAGE_MULTIPLE *
 * equityBase. Sells at current marks (cash back, positions shrunk). Equity is
 * unchanged at flat marks; leverage falls with the mark side.
 */
export async function forceLiquidateToLeverageCap(
  db: Db,
  corporationId: ObjectId,
  cashReserves: number,
  charter: BankCharter,
  marked: MarkBookResult
): Promise<{ cashReserves: number; charter: BankCharter; forced: boolean }> {
  const equity = computePropEquityBase(cashReserves, charter, marked.propBookMarkValue);
  const cap = PROP_LEVERAGE_MULTIPLE * Math.max(0, equity);
  if (!(marked.propBookMarkValue > cap + 1e-9) || marked.propBookMarkValue <= 0) {
    return {
      cashReserves,
      charter: {
        ...charter,
        propBook: marked.positions,
        propBookMarkValue: marked.propBookMarkValue,
      },
      forced: false,
    };
  }

  const keepFraction = Math.max(0, Math.min(1, cap / marked.propBookMarkValue));
  const sellFraction = 1 - keepFraction;
  let cashBack = 0;
  const nextPositions: PropPosition[] = [];
  for (const p of marked.positions) {
    const mark = Math.max(0, finiteOrZero(p.markValue ?? p.costBasis));
    const soldMark = mark * sellFraction;
    cashBack += soldMark;
    const keepUnits = p.units * keepFraction;
    if (keepUnits <= 1e-12) continue;
    nextPositions.push({
      asset: p.asset,
      ref: p.ref,
      units: keepUnits,
      costBasis: p.costBasis * keepFraction,
      markValue: mark * keepFraction,
    });
  }

  const nextMark = sumPositionMarks(nextPositions);
  const nextLiquid = cashReserves + cashBack;
  const nextCharter: BankCharter = {
    ...charter,
    propBook: nextPositions,
    propBookMarkValue: nextMark,
  };

  await db.collection<Corporation>("corporations").updateOne(
    { _id: corporationId, "bankCharter.status": "active" },
    {
      $set: {
        "bankCharter.cashReserves": nextLiquid,
        "bankCharter.propBook": nextPositions,
        "bankCharter.propBookMarkValue": nextMark,
        updatedAt: new Date(),
      },
    }
  );

  return { cashReserves: nextLiquid, charter: nextCharter, forced: true };
}
