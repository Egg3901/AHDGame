import * as Sentry from "@sentry/nextjs";
import type { Db, ObjectId } from "mongodb";
import type { Character, GameState, User } from "@/lib/db/types";
import type { DiscordBotFund, CasinoGameStats } from "@/lib/db/types/discordBotFund";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { buildPersonalBalanceInc, getHomeCurrency } from "@/lib/currency/characterFunds";
import { getCurrencyFxRate } from "@/lib/currency/corporationCapital";
import {
  atomicallyDebitCharacterCash,
  refundCharacterCash,
} from "@/lib/financialTxLog/atomicCashGuard";
import { emitTx } from "@/lib/financialTxLog/emit";

/**
 * The casino house bank.
 *
 * Every Discord casino game shares the pool blackjack has always used. Its
 * solvency is tracked in anchor units (`anchorBalance`) because players bet in
 * twenty-odd home currencies: the old per-currency buckets meant a player in
 * any currency nobody had lost in yet could never be paid a win.
 *
 * The house is a system account. Stakes leave a character's wallet into it and
 * winnings come out of it, so in the shadow ledger it books as a `casino`
 * mint/sink pair, the same as other system counterparties.
 */
export const CASINO_FUND_NAME = "blackjack_prize_pool" as const;
export const CASINO_SEED_ANCHOR = 200_000_000;

/** Largest single stake, as a share of the house bank. */
export const MAX_STAKE_SHARE = 0.02;
/** Largest single payout, as a share of the house bank. Bigger wins are clipped to it. */
export const MAX_PAYOUT_SHARE = 0.1;

export type CasinoGame =
  "blackjack" | "slots" | "roulette" | "crash" | "craps" | "highlow" | "race" | "lottery" | "poker";

export interface CasinoPlayer {
  discordId: string;
  characterId: ObjectId;
  characterName: string;
  countryId: string;
  currency: CurrencyCode;
  /** Local currency units per anchor unit. */
  rate: number;
}

export type ResolvePlayerResult =
  { ok: true; player: CasinoPlayer } | { ok: false; status: 403 | 404; error: string };

export async function resolveCasinoPlayer(db: Db, discordId: string): Promise<ResolvePlayerResult> {
  const user = await db.collection<User>("users").findOne({ discordId });
  if (!user) return { ok: false, status: 404, error: "No user found with that Discord ID" };
  if (user.isBanned) return { ok: false, status: 403, error: "This account is banned" };
  const character = await db.collection<Character>("characters").findOne({ userId: user._id });
  if (!character) {
    return { ok: false, status: 404, error: "User has no character. Create a character first." };
  }
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1 } });
  const currency = getHomeCurrency(character, gameState?.preset);
  const rate = await getCurrencyFxRate(db, currency);
  return {
    ok: true,
    player: {
      discordId,
      characterId: character._id,
      characterName: character.name,
      countryId: character.countryId,
      currency,
      rate,
    },
  };
}

export function toAnchor(localAmount: number, rate: number): number {
  return rate > 0 ? localAmount / rate : localAmount;
}

export function toLocal(anchorAmount: number, rate: number): number {
  return Math.floor(anchorAmount * (rate > 0 ? rate : 1));
}

/**
 * Load the house, creating it on first use and back-filling `anchorBalance`
 * from the legacy per-currency buckets the first time a new game touches it.
 */
export async function loadHouse(db: Db): Promise<DiscordBotFund & { anchorBalance: number }> {
  const funds = db.collection<DiscordBotFund>("discordBotFunds");
  let fund = await funds.findOne({ name: CASINO_FUND_NAME });
  if (!fund) {
    const now = new Date();
    await funds.updateOne(
      { name: CASINO_FUND_NAME },
      {
        $setOnInsert: {
          name: CASINO_FUND_NAME,
          balance: CASINO_SEED_ANCHOR,
          anchorBalance: CASINO_SEED_ANCHOR,
          totalWagered: 0,
          totalPaidOut: 0,
          totalCollected: 0,
          gamesPlayed: 0,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true }
    );
    fund = await funds.findOne({ name: CASINO_FUND_NAME });
  }
  if (!fund) throw new Error("Casino house could not be created");
  if (typeof fund.anchorBalance === "number")
    return fund as DiscordBotFund & { anchorBalance: number };

  // Era-rate fallback covers buckets in a currency with no live rate (a
  // legacy DDM balance on a euro-era world, say) instead of counting them 1:1.
  let anchorBalance = 0;
  for (const [code, amount] of Object.entries(fund.currencyBalances ?? {})) {
    if (typeof amount !== "number" || amount <= 0) continue;
    anchorBalance += toAnchor(amount, await getCurrencyFxRate(db, code as CurrencyCode));
  }
  if (!fund.currencyBalances) anchorBalance = Math.max(0, fund.balance ?? 0);
  anchorBalance = Math.floor(anchorBalance);
  await funds.updateOne(
    { name: CASINO_FUND_NAME, anchorBalance: { $exists: false } },
    { $set: { anchorBalance, updatedAt: new Date() } }
  );
  const migrated = await funds.findOne({ name: CASINO_FUND_NAME });
  return { ...(migrated ?? fund), anchorBalance: migrated?.anchorBalance ?? anchorBalance };
}

export interface HouseLimits {
  anchorBalance: number;
  maxStakeAnchor: number;
  maxPayoutAnchor: number;
}

export function houseLimits(anchorBalance: number): HouseLimits {
  const balance = Math.max(0, anchorBalance);
  return {
    anchorBalance: balance,
    maxStakeAnchor: Math.floor(balance * MAX_STAKE_SHARE),
    maxPayoutAnchor: Math.floor(balance * MAX_PAYOUT_SHARE),
  };
}

/** Limits expressed in one player's currency, for the bot to show. */
export function limitsFor(player: CasinoPlayer, limits: HouseLimits) {
  return {
    currency: player.currency,
    maxStake: toLocal(limits.maxStakeAnchor, player.rate),
    maxPayout: toLocal(limits.maxPayoutAnchor, player.rate),
  };
}

export type StakeResult =
  | { ok: true; anchorAmount: number }
  | { ok: false; status: 400 | 402; error: string; extra?: Record<string, unknown> };

/** Take a stake out of the player's home-currency wallet. */
export async function takeStake(
  db: Db,
  player: CasinoPlayer,
  localAmount: number,
  /** Null for shared-pot games, where the house carries no risk on the stake. */
  limits: HouseLimits | null
): Promise<StakeResult> {
  if (!Number.isFinite(localAmount) || localAmount < 1) {
    return { ok: false, status: 400, error: "Stake must be at least 1" };
  }
  const anchorAmount = toAnchor(localAmount, player.rate);
  if (limits && anchorAmount > limits.maxStakeAnchor) {
    return {
      ok: false,
      status: 400,
      error: "Stake is over the table limit",
      extra: { ...limitsFor(player, limits) },
    };
  }
  const debit = await atomicallyDebitCharacterCash(
    db,
    player.characterId,
    player.currency,
    localAmount,
    true
  );
  if (!debit.ok) {
    return {
      ok: false,
      status: 402,
      error: "Insufficient funds",
      extra: {
        message: `You do not have ${localAmount.toLocaleString()} ${player.currency} on hand.`,
      },
    };
  }
  return { ok: true, anchorAmount };
}

export async function returnStake(
  db: Db,
  player: Pick<CasinoPlayer, "characterId" | "currency">,
  localAmount: number
): Promise<boolean> {
  return refundCharacterCash(db, player.characterId, player.currency, localAmount, true);
}

export async function creditPlayer(
  db: Db,
  player: Pick<CasinoPlayer, "characterId" | "currency">,
  localAmount: number
): Promise<boolean> {
  if (localAmount <= 0) return true;
  const result = await db.collection<Character>("characters").updateOne(
    { _id: player.characterId },
    {
      $inc: buildPersonalBalanceInc(localAmount, player.currency, true),
      $set: { updatedAt: new Date() },
    }
  );
  return result.matchedCount > 0;
}

function statsInc(game: CasinoGame, stakeAnchor: number, paidAnchor: number, plays: number) {
  const prefix = `games.${game}` as const;
  return {
    [`${prefix}.handleAnchor`]: stakeAnchor,
    [`${prefix}.paidOutAnchor`]: paidAnchor,
    [`${prefix}.played`]: plays,
  } satisfies Record<`games.${string}.${keyof CasinoGameStats}`, number>;
}

/**
 * Move the house's side of a finished bet: it keeps `stakeAnchor` and pays
 * `paidAnchor`. A net payout only applies if the bank can cover it, in the same
 * atomic write, so two concurrent wins can never overdraw it.
 */
export async function applyHouseResult(
  db: Db,
  game: CasinoGame,
  stakeAnchor: number,
  paidAnchor: number,
  plays = 1
): Promise<boolean> {
  const net = stakeAnchor - paidAnchor;
  const filter: Record<string, unknown> = { name: CASINO_FUND_NAME };
  if (net < 0) filter.anchorBalance = { $gte: -net };
  const result = await db.collection<DiscordBotFund>("discordBotFunds").updateOne(filter, {
    $inc: { anchorBalance: net, ...statsInc(game, stakeAnchor, paidAnchor, plays) },
    $set: { updatedAt: new Date() },
  });
  return result.matchedCount > 0;
}

/** Undo `applyHouseResult` when a later write in the same play fails. */
export async function reverseHouseResult(
  db: Db,
  game: CasinoGame,
  stakeAnchor: number,
  paidAnchor: number,
  plays = 1
): Promise<void> {
  await db
    .collection<DiscordBotFund>("discordBotFunds")
    .updateOne(
      { name: CASINO_FUND_NAME },
      {
        $inc: {
          anchorBalance: paidAnchor - stakeAnchor,
          ...statsInc(game, -stakeAnchor, -paidAnchor, -plays),
        },
        $set: { updatedAt: new Date() },
      }
    )
    .catch((err) =>
      Sentry.captureException(err, { extra: { phase: "casino.reverseHouseResult" } })
    );
}

/** Clip a payout to the house's per-payout cap. Returns local units. */
export function capPayout(
  player: Pick<CasinoPlayer, "rate">,
  payoutLocal: number,
  limits: HouseLimits
): { payout: number; capped: boolean } {
  const capLocal = toLocal(limits.maxPayoutAnchor, player.rate);
  if (payoutLocal > capLocal) return { payout: capLocal, capped: true };
  return { payout: Math.floor(payoutLocal), capped: false };
}

/** Ledger rows for one finished bet: the stake out and, when there is one, the return. */
export function recordCasinoTx(
  db: Db,
  player: Pick<CasinoPlayer, "characterId" | "characterName" | "currency" | "rate">,
  game: CasinoGame,
  stakeLocal: number,
  payoutLocal: number,
  meta: Record<string, unknown>
): void {
  const now = new Date();
  const base = {
    turn: 0,
    createdAt: now,
    subjectType: "character" as const,
    subjectId: player.characterId,
    subjectName: player.characterName,
    currencyCode: player.currency,
    counterpartyType: "system" as const,
    counterpartyName: "Casino",
  };
  if (stakeLocal > 0) {
    void emitTx(db, {
      ...base,
      type: "casino_wager",
      amount: -stakeLocal,
      anchorAmount: -toAnchor(stakeLocal, player.rate),
      meta: { game, ...meta },
    });
  }
  if (payoutLocal > 0) {
    void emitTx(db, {
      ...base,
      type: "casino_payout",
      amount: payoutLocal,
      anchorAmount: toAnchor(payoutLocal, player.rate),
      meta: { game, ...meta },
    });
  }
}

export interface HouseBetOutcome {
  ok: true;
  stake: number;
  payout: number;
  capped: boolean;
  newHouseAnchor: number;
}

export type HouseBetResult = HouseBetOutcome | { ok: false; status: 500 | 503; error: string };

/**
 * Settle a bet against the house whose stake has already been taken.
 * On a house shortfall the stake goes back to the player and the play is void.
 */
export async function settleHouseBet(
  db: Db,
  args: {
    player: CasinoPlayer;
    game: CasinoGame;
    stakeLocal: number;
    multiplier: number;
    limits: HouseLimits;
    meta: Record<string, unknown>;
  }
): Promise<HouseBetResult> {
  const { player, game, stakeLocal, limits } = args;
  const { payout, capped } = capPayout(player, stakeLocal * args.multiplier, limits);
  const stakeAnchor = toAnchor(stakeLocal, player.rate);
  const paidAnchor = toAnchor(payout, player.rate);

  const applied = await applyHouseResult(db, game, stakeAnchor, paidAnchor);
  if (!applied) {
    await returnStake(db, player, stakeLocal);
    return {
      ok: false,
      status: 503,
      error: "The casino cannot cover that payout right now. Your stake was returned.",
    };
  }
  if (payout > 0 && !(await creditPlayer(db, player, payout))) {
    await reverseHouseResult(db, game, stakeAnchor, paidAnchor);
    return { ok: false, status: 500, error: "Failed to credit winnings" };
  }
  recordCasinoTx(db, player, game, stakeLocal, payout, args.meta);
  return {
    ok: true,
    stake: stakeLocal,
    payout,
    capped,
    newHouseAnchor: limits.anchorBalance + stakeAnchor - paidAnchor,
  };
}
