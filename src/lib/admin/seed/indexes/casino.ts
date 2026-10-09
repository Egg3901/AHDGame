import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Indexes for the Discord casino (`src/lib/casino`):
 *
 *   - high-low: one open hand per player (`discordId + status`), and the
 *     sweeper's scan for idle hands past `expiresAt`.
 *   - rounds: the open lottery per tier, the bot's per-channel and due-draw
 *     listings, and the sweeper's scans for expired and stalled settlements.
 */
export async function seedCasinoIndexes(db: Db, log: (msg: string) => void) {
  log("Casino indexes:");

  await ensureIndex(
    db,
    "casinoHighLowSessions",
    { discordId: 1, status: 1 },
    { name: "chl_player_status" },
    log
  );
  await ensureIndex(
    db,
    "casinoHighLowSessions",
    { status: 1, expiresAt: 1 },
    { name: "chl_status_expires" },
    log
  );

  await ensureIndex(
    db,
    "casinoRounds",
    { game: 1, status: 1, tier: 1 },
    { name: "cr_game_status_tier" },
    log
  );
  await ensureIndex(
    db,
    "casinoRounds",
    { status: 1, game: 1, channelId: 1, createdAt: -1 },
    { name: "cr_status_game_channel_created" },
    log
  );
  await ensureIndex(
    db,
    "casinoRounds",
    { status: 1, closesAt: 1 },
    { name: "cr_status_closes" },
    log
  );
  await ensureIndex(
    db,
    "casinoRounds",
    { status: 1, expiresAt: 1 },
    { name: "cr_status_expires" },
    log
  );
  await ensureIndex(
    db,
    "casinoRounds",
    { status: 1, updatedAt: 1 },
    { name: "cr_status_updated" },
    log
  );
}
