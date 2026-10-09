import * as Sentry from "@sentry/nextjs";
import { ObjectId, type Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import { RACER_IDS, runRace, type RacerId } from "./games/race";
import { settleByChips, splitPot, type PotShare } from "./games/pool";
import { cryptoRng, pickWeighted, type Rng } from "./rng";
import {
  applyHouseResult,
  creditPlayer,
  houseLimits,
  loadHouse,
  recordCasinoTx,
  returnStake,
  takeStake,
  toAnchor,
  toLocal,
  type CasinoPlayer,
} from "./house";

/**
 * Shared-pot games: players stake into a round and the round pays itself out.
 * The house carries no risk here, it only takes a rake, so these games cannot
 * drain the bank. Stakes are held on the round document until it settles or
 * is cancelled; the sweeper settles or refunds any round the bot abandons.
 */
export type RoundGame = "race" | "lottery" | "poker";
export type RoundStatus = "open" | "running" | "settling" | "settled" | "cancelled";
export type LotteryTier = "low" | "high";

export const RACE_RAKE = 0.05;
export const RACE_BETTING_SECONDS = { min: 15, max: 300, default: 45 };
export const LOTTERY_RAKE = 0.1;
export const LOTTERY_TICKET_ANCHOR: Record<LotteryTier, number> = { low: 50_000, high: 1_000_000 };
export const LOTTERY_MAX_TICKETS = 100;
export const LOTTERY_HOURS = { min: 1, max: 72, default: 24 };
export const POKER_RAKE = 0.05;
export const POKER_BUY_IN_ANCHOR = { min: 10_000, max: 5_000_000 };
export const POKER_PLAYERS = { min: 2, max: 8 };
export const POKER_STARTING_CHIPS = 1_000;

const RACE_GRACE_MS = 15 * 60_000;
const LOTTERY_GRACE_MS = 6 * 3_600_000;
const POKER_TABLE_MS = 3 * 3_600_000;
const STUCK_SETTLING_MS = 5 * 60_000;

export interface RoundEntry {
  discordId: string;
  characterId: ObjectId;
  characterName: string;
  currency: CurrencyCode;
  rate: number;
  /** Local units taken from the player. Refunds return exactly this. */
  stake: number;
  anchorAmount: number;
  selection?: RacerId;
  tickets?: number;
  enteredAt: Date;
}

export interface RoundPayout {
  discordId: string;
  characterId: ObjectId;
  characterName: string;
  currency: CurrencyCode;
  rate: number;
  amount: number;
  anchorAmount: number;
  kind: "win" | "refund";
  paid: boolean;
}

export interface CasinoRound {
  _id: ObjectId;
  game: RoundGame;
  status: RoundStatus;
  hostDiscordId: string | null;
  channelId: string | null;
  tier?: LotteryTier;
  ticketAnchor?: number;
  buyInAnchor?: number;
  startingChips?: number;
  maxPlayers?: number;
  entries: RoundEntry[];
  potAnchor: number;
  closesAt: Date;
  expiresAt: Date;
  outcome?: {
    winner?: RacerId;
    frames?: number[][];
    winnerDiscordId?: string;
    chips?: Record<string, number>;
    refunded?: boolean;
    reason?: string;
  };
  payouts?: RoundPayout[];
  rakeAnchor?: number;
  createdAt: Date;
  updatedAt: Date;
  settledAt?: Date;
}

type Fail = { ok: false; status: number; error: string; extra?: Record<string, unknown> };
type Ok<T> = { ok: true } & T;

const rounds = (db: Db) => db.collection<CasinoRound>("casinoRounds");

export function publicRound(r: CasinoRound) {
  return {
    roundId: r._id.toString(),
    game: r.game,
    status: r.status,
    hostDiscordId: r.hostDiscordId,
    channelId: r.channelId,
    tier: r.tier,
    ticketAnchor: r.ticketAnchor,
    buyInAnchor: r.buyInAnchor,
    startingChips: r.startingChips,
    maxPlayers: r.maxPlayers,
    potAnchor: Math.floor(r.potAnchor),
    closesAt: r.closesAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    entries: r.entries.map((e) => ({
      discordId: e.discordId,
      characterName: e.characterName,
      currency: e.currency,
      stake: e.stake,
      anchorAmount: Math.floor(e.anchorAmount),
      selection: e.selection,
      tickets: e.tickets,
    })),
    outcome: r.outcome,
    payouts: r.payouts?.map((p) => ({
      discordId: p.discordId,
      characterName: p.characterName,
      currency: p.currency,
      amount: p.amount,
      kind: p.kind,
    })),
    rakeAnchor: r.rakeAnchor === undefined ? undefined : Math.floor(r.rakeAnchor),
    settledAt: r.settledAt?.toISOString(),
  };
}

function parseId(roundId: string): ObjectId | null {
  return ObjectId.isValid(roundId) ? new ObjectId(roundId) : null;
}

export async function getRound(db: Db, roundId: string): Promise<CasinoRound | null> {
  const id = parseId(roundId);
  return id ? rounds(db).findOne({ _id: id }) : null;
}

export async function listRounds(
  db: Db,
  filter: { game?: RoundGame; status?: RoundStatus; due?: boolean; channelId?: string }
): Promise<CasinoRound[]> {
  const query: Record<string, unknown> = {};
  if (filter.game) query.game = filter.game;
  if (filter.channelId) query.channelId = filter.channelId;
  if (filter.due) {
    query.status = "open";
    query.game = filter.game ?? { $in: ["race", "lottery"] };
    query.closesAt = { $lte: new Date() };
  } else if (filter.status) {
    query.status = filter.status;
  } else {
    query.status = { $in: ["open", "running"] };
  }
  return rounds(db).find(query).sort({ createdAt: -1 }).limit(25).toArray();
}

export type CreateRoundInput =
  | { game: "race"; hostDiscordId: string; channelId: string | null; bettingSeconds?: number }
  | { game: "lottery"; tier: LotteryTier; channelId: string | null; hours?: number }
  | {
      game: "poker";
      host: CasinoPlayer;
      channelId: string | null;
      buyIn: number;
      maxPlayers?: number;
    };

export async function createRound(
  db: Db,
  input: CreateRoundInput
): Promise<Ok<{ round: CasinoRound; created: boolean }> | Fail> {
  const now = new Date();
  const base = {
    _id: new ObjectId(),
    status: "open" as const,
    entries: [],
    potAnchor: 0,
    createdAt: now,
    updatedAt: now,
  };

  if (input.game === "race") {
    const seconds = clamp(
      input.bettingSeconds ?? RACE_BETTING_SECONDS.default,
      RACE_BETTING_SECONDS.min,
      RACE_BETTING_SECONDS.max
    );
    const closesAt = new Date(now.getTime() + seconds * 1000);
    const round: CasinoRound = {
      ...base,
      game: "race",
      hostDiscordId: input.hostDiscordId,
      channelId: input.channelId,
      closesAt,
      expiresAt: new Date(closesAt.getTime() + RACE_GRACE_MS),
    };
    await rounds(db).insertOne(round);
    return { ok: true, round, created: true };
  }

  if (input.game === "lottery") {
    // One draw per tier at a time: buying a ticket joins the open one.
    const open = await rounds(db).findOne({ game: "lottery", tier: input.tier, status: "open" });
    if (open) return { ok: true, round: open, created: false };
    const hours = clamp(input.hours ?? LOTTERY_HOURS.default, LOTTERY_HOURS.min, LOTTERY_HOURS.max);
    const closesAt = new Date(now.getTime() + hours * 3_600_000);
    const round: CasinoRound = {
      ...base,
      game: "lottery",
      hostDiscordId: null,
      channelId: input.channelId,
      tier: input.tier,
      ticketAnchor: LOTTERY_TICKET_ANCHOR[input.tier],
      closesAt,
      expiresAt: new Date(closesAt.getTime() + LOTTERY_GRACE_MS),
    };
    await rounds(db).insertOne(round);
    return { ok: true, round, created: true };
  }

  const buyInAnchor = Math.floor(toAnchor(input.buyIn, input.host.rate));
  if (buyInAnchor < POKER_BUY_IN_ANCHOR.min || buyInAnchor > POKER_BUY_IN_ANCHOR.max) {
    return {
      ok: false,
      status: 400,
      error: "Buy-in is outside the table range",
      extra: {
        currency: input.host.currency,
        minBuyIn: Math.ceil(POKER_BUY_IN_ANCHOR.min * input.host.rate),
        maxBuyIn: toLocal(POKER_BUY_IN_ANCHOR.max, input.host.rate),
      },
    };
  }
  const round: CasinoRound = {
    ...base,
    game: "poker",
    hostDiscordId: input.host.discordId,
    channelId: input.channelId,
    buyInAnchor,
    startingChips: POKER_STARTING_CHIPS,
    maxPlayers: clamp(input.maxPlayers ?? POKER_PLAYERS.max, POKER_PLAYERS.min, POKER_PLAYERS.max),
    closesAt: new Date(now.getTime() + POKER_TABLE_MS),
    expiresAt: new Date(now.getTime() + POKER_TABLE_MS),
  };
  await rounds(db).insertOne(round);
  return { ok: true, round, created: true };
}

export type EnterInput = { stake?: number; selection?: string; tickets?: number };

export async function enterRound(
  db: Db,
  roundId: string,
  player: CasinoPlayer,
  input: EnterInput
): Promise<Ok<{ round: CasinoRound; stake: number }> | Fail> {
  const round = await getRound(db, roundId);
  if (!round) return { ok: false, status: 404, error: "Round not found" };
  if (round.status !== "open") return { ok: false, status: 409, error: "This round is closed" };
  const now = new Date();
  if (round.game !== "poker" && round.closesAt <= now) {
    return { ok: false, status: 409, error: "Betting has closed" };
  }

  let stake: number;
  let selection: RacerId | undefined;
  let tickets: number | undefined;
  let limits = null;
  if (round.game === "race") {
    if (!input.selection || !RACER_IDS.includes(input.selection as RacerId)) {
      return { ok: false, status: 400, error: `Pick a racer: ${RACER_IDS.join(", ")}` };
    }
    selection = input.selection as RacerId;
    stake = Math.floor(input.stake ?? 0);
    limits = houseLimits((await loadHouse(db)).anchorBalance);
  } else if (round.game === "lottery") {
    tickets = Math.floor(input.tickets ?? 1);
    if (tickets < 1 || tickets > LOTTERY_MAX_TICKETS) {
      return { ok: false, status: 400, error: `Buy between 1 and ${LOTTERY_MAX_TICKETS} tickets` };
    }
    stake = Math.ceil(tickets * (round.ticketAnchor ?? 0) * player.rate);
  } else {
    stake = Math.ceil((round.buyInAnchor ?? 0) * player.rate);
  }

  const taken = await takeStake(db, player, stake, limits);
  if (!taken.ok) return taken;

  const entry: RoundEntry = {
    discordId: player.discordId,
    characterId: player.characterId,
    characterName: player.characterName,
    currency: player.currency,
    rate: player.rate,
    stake,
    anchorAmount: taken.anchorAmount,
    selection,
    tickets,
    enteredAt: now,
  };

  let updated: CasinoRound | null = null;
  if (round.game === "lottery") {
    // Top up an existing ticket stack first, within the per-player cap.
    updated = await rounds(db).findOneAndUpdate(
      {
        _id: round._id,
        status: "open",
        closesAt: { $gt: now },
        entries: {
          $elemMatch: {
            discordId: player.discordId,
            currency: player.currency,
            tickets: { $lte: LOTTERY_MAX_TICKETS - (tickets ?? 0) },
          },
        },
      },
      {
        $inc: {
          "entries.$.tickets": tickets ?? 0,
          "entries.$.stake": stake,
          "entries.$.anchorAmount": taken.anchorAmount,
          potAnchor: taken.anchorAmount,
        },
        $set: { updatedAt: now },
      },
      { returnDocument: "after" }
    );
  }
  if (!updated) {
    const filter: Record<string, unknown> = {
      _id: round._id,
      status: "open",
      "entries.discordId": { $ne: player.discordId },
    };
    if (round.game !== "poker") filter.closesAt = { $gt: now };
    if (round.game === "poker")
      filter[`entries.${(round.maxPlayers ?? POKER_PLAYERS.max) - 1}`] = { $exists: false };
    updated = await rounds(db).findOneAndUpdate(
      filter,
      {
        $push: { entries: entry },
        $inc: { potAnchor: taken.anchorAmount },
        $set: { updatedAt: now },
      },
      { returnDocument: "after" }
    );
  }
  if (!updated) {
    await returnStake(db, player, stake);
    const reason =
      round.game === "lottery"
        ? `You can hold at most ${LOTTERY_MAX_TICKETS} tickets in one draw`
        : round.game === "poker"
          ? "You are already seated, or the table is full or has started"
          : "You already have a bet on this race";
    return { ok: false, status: 409, error: reason };
  }
  recordCasinoTx(db, player, round.game, stake, 0, {
    roundId: round._id.toString(),
    selection,
    tickets,
  });
  return { ok: true, round: updated, stake };
}

/** Close a poker table to new players once the host deals the first hand. */
export async function startRound(
  db: Db,
  roundId: string,
  hostDiscordId: string
): Promise<Ok<{ round: CasinoRound }> | Fail> {
  const id = parseId(roundId);
  if (!id) return { ok: false, status: 400, error: "Invalid roundId" };
  const started = await rounds(db).findOneAndUpdate(
    {
      _id: id,
      game: "poker",
      status: "open",
      hostDiscordId,
      [`entries.${POKER_PLAYERS.min - 1}`]: { $exists: true },
    },
    { $set: { status: "running", updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!started)
    return {
      ok: false,
      status: 409,
      error: "Only the host can start an open table with at least two players",
    };
  return { ok: true, round: started };
}

function refundPlan(entries: RoundEntry[]): RoundPayout[] {
  return entries.map((e) => ({
    discordId: e.discordId,
    characterId: e.characterId,
    characterName: e.characterName,
    currency: e.currency,
    rate: e.rate,
    amount: e.stake,
    anchorAmount: e.anchorAmount,
    kind: "refund" as const,
    paid: false,
  }));
}

function winPlan(
  entries: RoundEntry[],
  shares: PotShare[],
  rates: Map<CurrencyCode, number>
): RoundPayout[] {
  const byId = new Map(entries.map((e) => [e.discordId, e]));
  return shares
    .filter((s) => s.anchorAmount > 0)
    .map((s) => {
      const e = byId.get(s.key)!;
      const rate = rates.get(e.currency) ?? e.rate;
      return {
        discordId: e.discordId,
        characterId: e.characterId,
        characterName: e.characterName,
        currency: e.currency,
        rate,
        amount: toLocal(s.anchorAmount, rate),
        anchorAmount: s.anchorAmount,
        kind: "win" as const,
        paid: false,
      };
    });
}

/** Pay every unpaid line of a settling round. Each line is claimed before it is credited, so a retry never pays twice. */
async function payOutstanding(db: Db, round: CasinoRound): Promise<CasinoRound | null> {
  const payouts = round.payouts ?? [];
  for (let i = 0; i < payouts.length; i++) {
    const p = payouts[i];
    if (p.paid) continue;
    const claim = await rounds(db).updateOne(
      { _id: round._id, [`payouts.${i}.paid`]: false },
      { $set: { [`payouts.${i}.paid`]: true, updatedAt: new Date() } }
    );
    if (claim.modifiedCount === 0) continue;
    const credited = await creditPlayer(db, p, p.amount);
    if (!credited) {
      Sentry.captureMessage("casino round payout to a missing character", {
        extra: {
          roundId: round._id.toString(),
          discordId: p.discordId,
          amount: p.amount,
          currency: p.currency,
        },
      });
      continue;
    }
    recordCasinoTx(db, p, round.game, 0, p.amount, { roundId: round._id.toString(), kind: p.kind });
  }
  return rounds(db).findOneAndUpdate(
    { _id: round._id, status: "settling" },
    {
      $set: {
        status: round.outcome?.refunded ? "cancelled" : "settled",
        settledAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" }
  );
}

/** Claim the round for settlement with its full payout plan, book the rake, then pay. */
async function commitSettlement(
  db: Db,
  round: CasinoRound,
  outcome: NonNullable<CasinoRound["outcome"]>,
  payouts: RoundPayout[],
  rakeAnchor: number
): Promise<Ok<{ round: CasinoRound }> | Fail> {
  const claimed = await rounds(db).findOneAndUpdate(
    { _id: round._id, status: round.status },
    { $set: { status: "settling", outcome, payouts, rakeAnchor, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!claimed) {
    const current = await rounds(db).findOne({ _id: round._id });
    return current
      ? { ok: true, round: current }
      : { ok: false, status: 404, error: "Round not found" };
  }
  if (!outcome.refunded) {
    await applyHouseResult(db, round.game, round.potAnchor, round.potAnchor - rakeAnchor);
  }
  const done = await payOutstanding(db, claimed);
  return { ok: true, round: done ?? claimed };
}

export async function cancelRound(
  db: Db,
  round: CasinoRound,
  reason: string
): Promise<Ok<{ round: CasinoRound }> | Fail> {
  if (round.status !== "open" && round.status !== "running") {
    return { ok: false, status: 409, error: "This round is already finished" };
  }
  return commitSettlement(db, round, { refunded: true, reason }, refundPlan(round.entries), 0);
}

export async function settleRound(
  db: Db,
  roundId: string,
  input: { chips?: Record<string, number> },
  rng: Rng = cryptoRng
): Promise<Ok<{ round: CasinoRound }> | Fail> {
  const round = await getRound(db, roundId);
  if (!round) return { ok: false, status: 404, error: "Round not found" };
  if (round.status === "settled" || round.status === "cancelled") return { ok: true, round };
  if (round.status === "settling") {
    const done = await payOutstanding(db, round);
    return { ok: true, round: done ?? round };
  }

  if (round.entries.length === 0) return cancelRound(db, round, "No entries");

  if (round.game === "race" || round.game === "lottery") {
    if (round.closesAt > new Date())
      return { ok: false, status: 409, error: "Betting is still open" };
    const rates = await loadFxRatesByCurrency(db);
    if (round.game === "race") {
      const { winner, frames } = runRace(rng);
      const winners = round.entries.filter((e) => e.selection === winner);
      if (winners.length === 0) {
        return commitSettlement(
          db,
          round,
          { winner, frames, refunded: true, reason: "Nobody backed the winner" },
          refundPlan(round.entries),
          0
        );
      }
      const { shares, rake } = splitPot(
        round.potAnchor,
        RACE_RAKE,
        winners.map((e) => ({ key: e.discordId, anchorAmount: e.anchorAmount }))
      );
      return commitSettlement(
        db,
        round,
        { winner, frames },
        winPlan(round.entries, shares, rates),
        rake
      );
    }
    const winner = pickWeighted(
      rng,
      round.entries.map((e) => ({ value: e, weight: e.tickets ?? 1 }))
    );
    const { shares, rake } = splitPot(round.potAnchor, LOTTERY_RAKE, [
      { key: winner.discordId, anchorAmount: round.potAnchor },
    ]);
    return commitSettlement(
      db,
      round,
      { winnerDiscordId: winner.discordId },
      winPlan(round.entries, shares, rates),
      rake
    );
  }

  // Poker: the bot ran the hands, the server only redistributes the buy-ins it holds.
  const chips = input.chips;
  if (!chips) return { ok: false, status: 400, error: "Final chip counts are required" };
  const seated = new Set(round.entries.map((e) => e.discordId));
  const reported = Object.keys(chips);
  if (reported.length !== seated.size || reported.some((id) => !seated.has(id))) {
    return { ok: false, status: 400, error: "Chip counts must cover exactly the seated players" };
  }
  const starting = round.startingChips ?? POKER_STARTING_CHIPS;
  const total = reported.reduce((sum, id) => sum + chips[id], 0);
  if (
    reported.some((id) => !Number.isInteger(chips[id]) || chips[id] < 0) ||
    total !== starting * seated.size
  ) {
    return {
      ok: false,
      status: 400,
      error: `Chip counts must be whole numbers summing to ${starting * seated.size}`,
    };
  }
  const rates = await loadFxRatesByCurrency(db);
  const { shares, rake } = settleByChips(
    round.entries.map((e) => ({
      key: e.discordId,
      anchorAmount: e.anchorAmount,
      chips: chips[e.discordId],
      startingChips: starting,
    })),
    POKER_RAKE
  );
  return commitSettlement(db, round, { chips }, winPlan(round.entries, shares, rates), rake);
}

/**
 * Close out rounds the bot left behind: draw expired races and lotteries,
 * refund expired poker tables, and finish any settlement that stopped partway.
 */
export async function sweepRounds(db: Db, now = new Date(), rng: Rng = cryptoRng): Promise<number> {
  const expired = await rounds(db)
    .find({ status: { $in: ["open", "running"] }, expiresAt: { $lte: now } })
    .limit(25)
    .toArray();
  for (const round of expired) {
    if (round.game === "poker") await cancelRound(db, round, "Table expired");
    else await settleRound(db, round._id.toString(), {}, rng);
  }
  const stuck = await rounds(db)
    .find({ status: "settling", updatedAt: { $lte: new Date(now.getTime() - STUCK_SETTLING_MS) } })
    .limit(25)
    .toArray();
  for (const round of stuck) await payOutstanding(db, round);
  return expired.length + stuck.length;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(n)));
}
