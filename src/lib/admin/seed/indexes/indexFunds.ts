import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

// Indexes for the index-fund system (funds, positions, transactions,
// redemption queue, NAV snapshots). Query shapes live in
// src/lib/indexFunds/fundQueries.ts.
export async function seedIndexFundIndexes(db: Db, log: (msg: string) => void) {
  log("Index fund indexes:");

  // Fund detail pages and API routes look funds up by slug
  await ensureIndex(
    db,
    "indexFunds",
    { slug: 1 },
    { unique: true, background: true, name: "indexFunds_slug" },
    log
  );

  // Position lookups: { fundId, holderKind, <holder id> } on every
  // subscribe/redeem and the holders route; per-holder portfolio listings.
  await ensureIndex(
    db,
    "indexFundPositions",
    { fundId: 1, holderKind: 1, characterId: 1 },
    { background: true, name: "indexFundPositions_fund_holder_character" },
    log
  );
  await ensureIndex(
    db,
    "indexFundPositions",
    { holderKind: 1, characterId: 1 },
    { background: true, name: "indexFundPositions_holder_character" },
    log
  );
  await ensureIndex(
    db,
    "indexFundPositions",
    { holderKind: 1, imperialCharacterId: 1 },
    { sparse: true, background: true, name: "indexFundPositions_holder_imperial" },
    log
  );
  await ensureIndex(
    db,
    "indexFundPositions",
    { holderKind: 1, nppId: 1 },
    { sparse: true, background: true, name: "indexFundPositions_holder_npp" },
    log
  );

  // Transaction history per fund, newest first (grows unboundedly)
  await ensureIndex(
    db,
    "indexFundTransactions",
    { fundId: 1, createdAt: -1 },
    { background: true, name: "indexFundTransactions_fund_createdAt" },
    log
  );
  await ensureIndex(
    db,
    "indexFundTransactions",
    { characterId: 1, createdAt: -1 },
    { sparse: true, background: true, name: "indexFundTransactions_character_createdAt" },
    log
  );

  // Redemption queue drain — cron scans queued/partial entries per fund, FIFO
  await ensureIndex(
    db,
    "indexFundRedemptionQueue",
    { fundId: 1, status: 1, createdAt: 1 },
    { background: true, name: "indexFundRedemptionQueue_fund_status_createdAt" },
    log
  );

  // NAV snapshots per fund, latest turn first
  await ensureIndex(
    db,
    "indexFundSnapshots",
    { fundId: 1, turn: -1 },
    { background: true, name: "indexFundSnapshots_fund_turn" },
    log
  );

  log("Index fund indexes ensured");
}
