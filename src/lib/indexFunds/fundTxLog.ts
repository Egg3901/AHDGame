import { ObjectId, type Db } from "mongodb";
import type { Character, ImperialCharacter, IndexFund } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { emitTx, emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

export type IndexFundTxSource = "player" | "cron_queue";

type FundRef = Pick<IndexFund, "_id" | "slug" | "name" | "tickerSymbol" | "anchorCurrencyCode">;

export interface IndexFundHolderContext {
  holderKind: "character" | "imperial_character";
  holderId: ObjectId;
  holderName: string;
  userId?: ObjectId;
  username?: string;
  countryId?: CountryId;
}

function buildFundMeta(fund: FundRef, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    fundId: fund._id.toString(),
    fundSlug: fund.slug,
    fundName: fund.name,
    fundTicker: fund.tickerSymbol,
    ...extra,
  };
}

function logIndexFundActivity(
  db: Db,
  params: {
    actionType: "index_fund_subscribe" | "index_fund_redeem";
    holder: IndexFundHolderContext;
    fund: FundRef;
    units: number;
    navAnchor: number;
    amountAnchor: number;
    turn: number;
    fundsChange: number;
    message: string;
    details?: Record<string, unknown>;
  }
): void {
  if (!params.holder.userId) return;

  void db.collection("activityLog").insertOne({
    type: "game_action",
    timestamp: new Date(),
    userId: params.holder.userId,
    characterId: params.holder.holderId,
    characterName: params.holder.holderName,
    username: params.holder.username,
    countryId: params.holder.countryId,
    actionType: params.actionType,
    actionCost: 0,
    turn: params.turn,
    targetId: params.fund._id,
    targetName: params.fund.name,
    targetType: "company",
    result: {
      success: true,
      fundsChange: params.fundsChange,
      message: params.message,
    },
    summary: `${params.actionType} — ${params.holder.holderName}: ${params.message}`,
    details: {
      fundId: params.fund._id.toString(),
      fundSlug: params.fund.slug,
      fundTicker: params.fund.tickerSymbol,
      units: params.units,
      navAnchor: params.navAnchor,
      amountAnchor: params.amountAnchor,
      currencyCode: params.fund.anchorCurrencyCode,
      ...params.details,
    },
  });
}

/** Record a player or cron payout for fund unit subscription (cash debit). */
export async function logIndexFundSubscribe(
  db: Db,
  params: {
    fund: FundRef;
    holder: IndexFundHolderContext;
    units: number;
    navAnchor: number;
    /** ₳ value of the leg. */
    amountAnchor: number;
    /** Fund-currency value actually moved on the wallet; defaults to the ₳ value. */
    amountNative?: number;
    balanceAfter?: number;
    source?: IndexFundTxSource;
    turn?: number;
  }
): Promise<void> {
  const turn = params.turn ?? (await getCurrentTurn(db));
  const now = new Date();
  const source = params.source ?? "player";

  await emitTx(db, {
    type: "index_fund_subscribe",
    turn,
    createdAt: now,
    subjectType: "character",
    subjectId: params.holder.holderId,
    subjectName: params.holder.holderName,
    amount: -(params.amountNative ?? params.amountAnchor),
    // `amountAnchor` is ₳ (fund cash, NAV and every fund leg are ₳). `amount` is
    // what the wallet actually moved, in the fund's currency, so the two are only
    // equal at parity. Stating `anchorAmount` outright stops emitTx re-deriving
    // it from a native figure and keeps the ledger's ₳ value exact.
    anchorAmount: -params.amountAnchor,
    balanceAfter: params.balanceAfter,
    currencyCode: params.fund.anchorCurrencyCode as CurrencyCode,
    counterpartyType: "system",
    counterpartyName: params.fund.name,
    meta: buildFundMeta(params.fund, {
      units: params.units,
      navAnchor: params.navAnchor,
      source,
      ...(params.holder.holderKind === "imperial_character" ? { imperial: true } : {}),
    }),
  });

  if (source === "player") {
    logIndexFundActivity(db, {
      actionType: "index_fund_subscribe",
      holder: params.holder,
      fund: params.fund,
      units: params.units,
      navAnchor: params.navAnchor,
      amountAnchor: params.amountAnchor,
      turn,
      fundsChange: -params.amountAnchor,
      message: `Subscribed to ${params.units} units of ${params.fund.tickerSymbol} at NAV ${params.navAnchor.toLocaleString()}`,
      details: { source },
    });
  }
}

/** Record fund unit redemption proceeds credited to the holder (cash credit). */
export async function logIndexFundRedeem(
  db: Db,
  params: {
    fund: FundRef;
    holder: IndexFundHolderContext;
    units: number;
    navAnchor: number;
    amountAnchor: number;
    /** Fund-currency value actually moved on the wallet; defaults to the ₳ value. */
    amountNative?: number;
    balanceAfter?: number;
    source?: IndexFundTxSource;
    queuedRemainder?: number;
    turn?: number;
  }
): Promise<void> {
  const turn = params.turn ?? (await getCurrentTurn(db));
  const now = new Date();
  const source = params.source ?? "player";

  await emitTx(db, {
    type: "index_fund_redeem",
    turn,
    createdAt: now,
    subjectType: "character",
    subjectId: params.holder.holderId,
    subjectName: params.holder.holderName,
    amount: params.amountNative ?? params.amountAnchor,
    anchorAmount: params.amountAnchor,
    balanceAfter: params.balanceAfter,
    currencyCode: params.fund.anchorCurrencyCode as CurrencyCode,
    // `amountAnchor` is ₳; `amount` is the native figure the wallet moved. See
    // logIndexFundSubscribe for why anchorAmount is stated rather than derived.
    counterpartyType: "system",
    counterpartyName: params.fund.name,
    meta: buildFundMeta(params.fund, {
      units: params.units,
      navAnchor: params.navAnchor,
      source,
      ...(params.queuedRemainder && params.queuedRemainder > 0
        ? { queuedUnits: params.queuedRemainder }
        : {}),
      ...(params.holder.holderKind === "imperial_character" ? { imperial: true } : {}),
    }),
  });
}

/** One activity-log row summarizing a player-initiated redemption request. */
export function logIndexFundRedeemActivity(
  db: Db,
  params: {
    fund: FundRef;
    holder: IndexFundHolderContext;
    requestedUnits: number;
    redeemedUnits: number;
    paidAmountAnchor: number;
    navAnchor: number;
    queuedUnits: number;
    turn: number;
  }
): void {
  const queueNote = params.queuedUnits > 0 ? ` (${params.queuedUnits} units queued)` : "";
  logIndexFundActivity(db, {
    actionType: "index_fund_redeem",
    holder: params.holder,
    fund: params.fund,
    units: params.redeemedUnits,
    navAnchor: params.navAnchor,
    amountAnchor: params.paidAmountAnchor,
    turn: params.turn,
    fundsChange: params.paidAmountAnchor,
    message: `Redeemed ${params.redeemedUnits}/${params.requestedUnits} units of ${params.fund.tickerSymbol} for ${params.paidAmountAnchor.toLocaleString()}${queueNote}`,
    details: {
      source: "player",
      requestedUnits: params.requestedUnits,
      redeemedUnits: params.redeemedUnits,
      queuedUnits: params.queuedUnits,
    },
  });
}

export function buildIndexFundDividendTxEntry(params: {
  fund: FundRef;
  holder: Pick<IndexFundHolderContext, "holderKind" | "holderId" | "holderName">;
  amountAnchor: number;
  units: number;
  /** Fund-currency value actually credited; defaults to the ₳ value. */
  amountNative?: number;
  corporationId: ObjectId;
  corporationName?: string;
  turn: number;
  createdAt?: Date;
}): Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged"> {
  const createdAt = params.createdAt ?? new Date();
  return {
    type: "index_fund_dividend",
    turn: params.turn,
    createdAt,
    subjectType: "character",
    subjectId: params.holder.holderId,
    subjectName: params.holder.holderName,
    amount: params.amountNative ?? params.amountAnchor,
    anchorAmount: params.amountAnchor,
    currencyCode: params.fund.anchorCurrencyCode as CurrencyCode,
    // `amountAnchor` is ₳; `amount` is the native figure the wallet moved. See
    // logIndexFundSubscribe for why anchorAmount is stated rather than derived.
    counterpartyType: "system",
    counterpartyName: params.fund.name,
    meta: buildFundMeta(params.fund, {
      units: params.units,
      corporationId: params.corporationId.toString(),
      ...(params.corporationName ? { corporationName: params.corporationName } : {}),
      ...(params.holder.holderKind === "imperial_character" ? { imperial: true } : {}),
    }),
  };
}

/** Resolve a redemption-queue holder for financial-tx attribution. */
export async function resolveIndexFundHolder(
  db: Db,
  entry: {
    holderKind: "character" | "imperial_character" | "npp";
    characterId?: ObjectId;
    imperialCharacterId?: ObjectId;
  }
): Promise<IndexFundHolderContext | null> {
  if (entry.holderKind === "character" && entry.characterId) {
    const character = await db
      .collection<Character>("characters")
      .findOne({ _id: entry.characterId }, { projection: { name: 1, countryId: 1, userId: 1 } });
    if (!character) return null;
    return {
      holderKind: "character",
      holderId: entry.characterId,
      holderName: character.name,
      userId: character.userId,
      countryId: character.countryId,
    };
  }

  if (entry.holderKind === "imperial_character" && entry.imperialCharacterId) {
    const imperial = await db
      .collection<ImperialCharacter>("imperialCharacters")
      .findOne(
        { _id: entry.imperialCharacterId },
        { projection: { name: 1, countryId: 1, userId: 1 } }
      );
    if (!imperial) return null;
    return {
      holderKind: "imperial_character",
      holderId: entry.imperialCharacterId,
      holderName: imperial.name,
      userId: imperial.userId,
      countryId: imperial.countryId,
    };
  }

  return null;
}

/** Bulk-emit dividend pass-through credits after holder balances are updated. */
export async function logIndexFundDividendBulk(
  db: Db,
  entries: Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">[]
): Promise<void> {
  if (entries.length === 0) return;
  const thresholds = await loadTxThresholds(db);
  await emitTxBulk(db, entries, thresholds);
}
