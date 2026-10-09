import { ObjectId, type Db } from "mongodb";
import {
  HIGHLOW_MAX_STEPS,
  drawHighLowCard,
  highLowStepMultiplier,
  resolveHighLowStep,
  type HighLowGuess,
} from "./games/highlow";
import { cryptoRng, type Rng } from "./rng";
import {
  applyHouseResult,
  capPayout,
  creditPlayer,
  houseLimits,
  loadHouse,
  recordCasinoTx,
  returnStake,
  reverseHouseResult,
  takeStake,
  toAnchor,
  type CasinoPlayer,
} from "./house";

/**
 * High-low is the one house game that spans several requests, so its state
 * lives on the server: the bot sends a call, the server draws the card. A
 * session left idle past `expiresAt` is cashed out for the player by the
 * sweeper rather than forfeited.
 */
export const HIGHLOW_SESSION_MS = 10 * 60_000;

export type HighLowStatus = "active" | "lost" | "cashed";

export interface HighLowSession {
  _id: ObjectId;
  discordId: string;
  characterId: ObjectId;
  characterName: string;
  currency: CasinoPlayer["currency"];
  rate: number;
  stake: number;
  card: number;
  multiplier: number;
  steps: number;
  history: { card: number; guess: HighLowGuess; next: number; correct: boolean }[];
  status: HighLowStatus;
  payout?: number;
  capped?: boolean;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

const sessions = (db: Db) => db.collection<HighLowSession>("casinoHighLowSessions");

export function publicSession(s: HighLowSession) {
  return {
    sessionId: s._id.toString(),
    status: s.status,
    stake: s.stake,
    currency: s.currency,
    card: s.card,
    multiplier: s.multiplier,
    steps: s.steps,
    maxSteps: HIGHLOW_MAX_STEPS,
    history: s.history,
    payout: s.payout,
    capped: s.capped,
    potential: Math.floor(s.stake * s.multiplier),
    higherMultiplier: highLowStepMultiplier(s.card, "higher"),
    lowerMultiplier: highLowStepMultiplier(s.card, "lower"),
    expiresAt: s.expiresAt.toISOString(),
  };
}

type Fail = { ok: false; status: number; error: string; extra?: Record<string, unknown> };

export async function startHighLow(
  db: Db,
  player: CasinoPlayer,
  stake: number,
  rng: Rng = cryptoRng
): Promise<{ ok: true; session: HighLowSession } | Fail> {
  const existing = await sessions(db).findOne({ discordId: player.discordId, status: "active" });
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: "You already have a high-low hand open",
      extra: { session: publicSession(existing) },
    };
  }
  const limits = houseLimits((await loadHouse(db)).anchorBalance);
  const taken = await takeStake(db, player, stake, limits);
  if (!taken.ok) return taken;
  const now = new Date();
  const session: HighLowSession = {
    _id: new ObjectId(),
    discordId: player.discordId,
    characterId: player.characterId,
    characterName: player.characterName,
    currency: player.currency,
    rate: player.rate,
    stake,
    card: drawHighLowCard(rng),
    multiplier: 1,
    steps: 0,
    history: [],
    status: "active",
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + HIGHLOW_SESSION_MS),
  };
  try {
    await sessions(db).insertOne(session);
  } catch (err) {
    await returnStake(db, player, stake);
    throw err;
  }
  return { ok: true, session };
}

/** Pay out a session at its current multiplier. Used by the cash-out call, the step cap and the sweeper. */
async function cashOut(
  db: Db,
  s: HighLowSession
): Promise<{ ok: true; session: HighLowSession } | Fail> {
  const limits = houseLimits((await loadHouse(db)).anchorBalance);
  const { payout, capped } = capPayout(s, s.stake * s.multiplier, limits);
  const stakeAnchor = toAnchor(s.stake, s.rate);
  const paidAnchor = toAnchor(payout, s.rate);
  if (!(await applyHouseResult(db, "highlow", stakeAnchor, paidAnchor))) {
    return {
      ok: false,
      status: 503,
      error: "The casino cannot cover that payout right now. Try cashing out again shortly.",
    };
  }
  const closed = await sessions(db).findOneAndUpdate(
    { _id: s._id, status: "active", steps: s.steps },
    { $set: { status: "cashed", payout, capped, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!closed) {
    await reverseHouseResult(db, "highlow", stakeAnchor, paidAnchor);
    return { ok: false, status: 409, error: "That hand was already settled" };
  }
  if (!(await creditPlayer(db, s, payout))) {
    await reverseHouseResult(db, "highlow", stakeAnchor, paidAnchor);
    await sessions(db).updateOne(
      { _id: s._id },
      { $set: { status: "active", updatedAt: new Date() }, $unset: { payout: "", capped: "" } }
    );
    return { ok: false, status: 500, error: "Failed to credit winnings" };
  }
  recordCasinoTx(db, s, "highlow", s.stake, payout, {
    sessionId: s._id.toString(),
    steps: s.steps,
  });
  return { ok: true, session: closed };
}

/** Return the stake of a session that never made a call. */
async function voidSession(db: Db, s: HighLowSession): Promise<void> {
  const closed = await sessions(db).findOneAndUpdate(
    { _id: s._id, status: "active", steps: 0 },
    { $set: { status: "cashed", payout: s.stake, updatedAt: new Date() } }
  );
  if (closed) await returnStake(db, s, s.stake);
}

export async function actHighLow(
  db: Db,
  discordId: string,
  sessionId: string,
  action: HighLowGuess | "cashout",
  rng: Rng = cryptoRng
): Promise<{ ok: true; session: HighLowSession } | Fail> {
  if (!ObjectId.isValid(sessionId)) return { ok: false, status: 400, error: "Invalid sessionId" };
  const s = await sessions(db).findOne({ _id: new ObjectId(sessionId), discordId });
  if (!s) return { ok: false, status: 404, error: "High-low hand not found" };
  if (s.status !== "active") return { ok: true, session: s };

  if (action === "cashout") {
    if (s.steps === 0) {
      await voidSession(db, s);
      const after = await sessions(db).findOne({ _id: s._id });
      return after
        ? { ok: true, session: after }
        : { ok: false, status: 404, error: "High-low hand not found" };
    }
    return cashOut(db, s);
  }

  if (highLowStepMultiplier(s.card, action) === 0) {
    return { ok: false, status: 400, error: `Nothing is ${action} than that card` };
  }
  const next = drawHighLowCard(rng);
  const { correct, stepMultiplier } = resolveHighLowStep(s.card, next, action);
  const entry = { card: s.card, guess: action, next, correct };

  if (!correct) {
    const lost = await sessions(db).findOneAndUpdate(
      { _id: s._id, status: "active", steps: s.steps },
      {
        $set: { status: "lost", card: next, payout: 0, updatedAt: new Date() },
        $push: { history: entry },
      },
      { returnDocument: "after" }
    );
    if (!lost) return { ok: false, status: 409, error: "That hand moved on. Try again." };
    await applyHouseResult(db, "highlow", toAnchor(s.stake, s.rate), 0);
    recordCasinoTx(db, s, "highlow", s.stake, 0, {
      sessionId: s._id.toString(),
      steps: s.steps + 1,
    });
    return { ok: true, session: lost };
  }

  const advanced = await sessions(db).findOneAndUpdate(
    { _id: s._id, status: "active", steps: s.steps },
    {
      $set: {
        card: next,
        multiplier: Math.floor(s.multiplier * stepMultiplier * 10_000) / 10_000,
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + HIGHLOW_SESSION_MS),
      },
      $inc: { steps: 1 },
      $push: { history: entry },
    },
    { returnDocument: "after" }
  );
  if (!advanced) return { ok: false, status: 409, error: "That hand moved on. Try again." };
  if (advanced.steps >= HIGHLOW_MAX_STEPS) return cashOut(db, advanced);
  return { ok: true, session: advanced };
}

export async function activeHighLow(db: Db, discordId: string): Promise<HighLowSession | null> {
  return sessions(db).findOne({ discordId, status: "active" });
}

/** Settle abandoned hands in the player's favour. Bounded so one sweep never runs long. */
export async function sweepHighLow(db: Db, now = new Date()): Promise<number> {
  const stale = await sessions(db)
    .find({ status: "active", expiresAt: { $lte: now } })
    .limit(50)
    .toArray();
  for (const s of stale) {
    if (s.steps === 0) await voidSession(db, s);
    else await cashOut(db, s);
  }
  return stale.length;
}
