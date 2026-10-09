import * as Sentry from "@sentry/nextjs";
import type { Db } from "mongodb";
import { sweepHighLow } from "./highlowSessions";
import { sweepRounds } from "./rounds";

const SWEEP_INTERVAL_MS = 60_000;
let lastSweepAt = 0;

/**
 * Settle anything the bot abandoned: idle high-low hands are cashed out for
 * the player, expired races and lotteries are drawn, expired poker tables are
 * refunded. Runs at most once a minute per server, off the request path.
 */
export function maybeSweepCasino(db: Db, now = Date.now()): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  void Promise.all([sweepHighLow(db), sweepRounds(db)]).catch((err) =>
    Sentry.captureException(err, { extra: { phase: "casino.sweep" } })
  );
}
