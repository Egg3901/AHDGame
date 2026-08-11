/**
 * Migration: let a world that never chose a gate adopt the reference default.
 *
 * `gameConfig` is a singleton that is deliberately NEVER dropped on reset (see
 * RESET_DROP_COLLECTIONS in src/lib/admin/seed/runCoreSeed.ts) — it carries a
 * hundred pieces of live operational state no seeder would restore. The cost of
 * that decision is that the document outlives every world, so nothing about a
 * seed default reaches a world that already exists. `gameState` has had an
 * answer to this for a while — `missingGameStateFlagDefaults` fills only the
 * flags that are ABSENT, so an explicit admin `false` survives a reset — and
 * `gameConfig` never got the equivalent. This is that equivalent.
 *
 * Two passes, both conservative:
 *
 * 1. GATES. Any key the reference config defines and the live document does not
 *    have at all is filled from the reference, on any world — absent means
 *    nobody ever chose it, so there is no intent to override.
 *
 *    On a world still inside its FIRST GAME DAY, boolean and mode gates that
 *    merely *differ* from the reference are adopted too. A world that young was
 *    seeded minutes ago and is still being set up, so a gate sitting at the
 *    value an older build's reference happened to carry is a fossil of that
 *    build, not a decision — which is exactly how a fresh world ended up with
 *    the shadow ledger dark after the default said otherwise. Past that window
 *    a differing value is treated as intent and left alone. Numeric tuning
 *    (startingFunds, turnLengthMinutes, the action bonuses) is never touched by
 *    either case: those are economy settings, not rollout gates.
 *
 * 2. FOSSIL MARKET TIER. `marketSystemMode` is the one gate a seed cannot
 *    write on a non-reset run (the D14 protection), so a world can carry a tier
 *    that no operator picked and no default can reach. This pass raises it to
 *    the reference tier only when ALL of the following hold:
 *      - there is no operator provenance (`marketSystemModeUpdatedBy` absent),
 *        so nobody chose the current value;
 *      - the reference tier is HIGHER on MARKET_MODE_ORDER, so this can only
 *        ever move a world up the rollout ladder, never down. Lowering a tier
 *        is the silent-rebase hazard the D13 restore script exists for, and
 *        this migration must never perform one;
 *      - the world is still inside its first game day (TURNS_PER_DAY), so
 *        there is no soaked economy to rebase. A mature world is left alone
 *        and stays an operator decision through /api/admin/config/market,
 *        preflight and soak included.
 *
 * Anything it changes is stamped `system:migration` and written to `adminLogs`,
 * so a tier that moved always names something.
 *
 * Idempotent: the second run finds nothing absent and finds its own provenance
 * stamp on the tier, so both passes are no-ops.
 *
 * Usage:
 *   MONGODB_URI=...&directConnection=true npx tsx scripts/migrations/adoptReferenceGameConfigGates.ts
 *   ... --dry-run     # report what would change, no writes
 */

import type { Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";
import { gameConfig as referenceGameConfig } from "../../src/lib/seeds/reference/gameConfig";
import { MARKET_MODE_ORDER, type MarketSystemMode } from "../../src/lib/market/modes";
import { TURNS_PER_DAY } from "../../src/lib/constants/corporations";
import type { MigrationResult } from "../../src/lib/migrations/types";

const MARKER_ID = "2026-08-08-adopt-reference-gameconfig-gates";

/** Written as the operator of record for anything this migration changes. */
const ACTOR = "system:migration";

/**
 * Keys the reference object carries that are NOT gates and must never be
 * force-filled from it. `_id` is the document key. The starting-* and turn
 * economy numbers are already `$set` by every core seed, and back-filling them
 * onto a running world would silently retune a live economy.
 */
const NOT_A_GATE = new Set(["_id"]);

export async function runAdoptReferenceGameConfigGates(
  db: Db,
  opts: { dryRun?: boolean } = {}
): Promise<MigrationResult> {
  const dryRun = opts.dryRun ?? false;
  const notes: string[] = [];

  const live = await db.collection<{ _id: string } & Record<string, unknown>>("gameConfig").findOne({ _id: referenceGameConfig._id });
  if (!live) {
    notes.push("no gameConfig document — nothing to reconcile (a fresh seed will create it)");
    return { documentsScanned: 0, documentsUpdated: 0, notes };
  }

  const gameState = await db
    .collection("gameState")
    .findOne({}, { projection: { currentTurn: 1 } });
  const currentTurn = typeof gameState?.currentTurn === "number" ? gameState.currentTurn : null;
  const isFreshWorld = currentTurn !== null && currentTurn <= TURNS_PER_DAY;

  const set: Record<string, unknown> = {};

  // Pass 1 — gates.
  const filled: string[] = [];
  const readopted: string[] = [];
  for (const [key, value] of Object.entries(referenceGameConfig)) {
    if (NOT_A_GATE.has(key)) continue;
    // `marketSystemMode` is pass 2's business — it has provenance stamps and a
    // ladder, and must never be moved by a blunt value comparison.
    if (key === "marketSystemMode") continue;
    if (live[key] === undefined) {
      set[key] = value;
      filled.push(key);
      continue;
    }
    const isGate = typeof value === "boolean" || typeof value === "string";
    if (isFreshWorld && isGate && live[key] !== value) {
      set[key] = value;
      readopted.push(`${key}: ${JSON.stringify(live[key])} -> ${JSON.stringify(value)}`);
    }
  }
  notes.push(filled.length > 0 ? `absent gates filled: ${filled.join(", ")}` : "no absent gates");
  if (readopted.length > 0) {
    notes.push(`fresh world re-adopted reference gates: ${readopted.join("; ")}`);
  } else if (isFreshWorld) {
    notes.push("no diverging gates on this fresh world");
  }

  // Pass 2 — fossil market tier.
  const referenceTier = referenceGameConfig.marketSystemMode as MarketSystemMode | undefined;
  const liveTier = live.marketSystemMode as MarketSystemMode | undefined;
  const referenceRank = referenceTier ? MARKET_MODE_ORDER.indexOf(referenceTier) : -1;
  const liveRank = liveTier ? MARKET_MODE_ORDER.indexOf(liveTier) : -1;

  let tierRaisedFrom: MarketSystemMode | null = null;
  if (live.marketSystemModeUpdatedBy !== undefined) {
    notes.push(
      `market tier left at "${liveTier}" — an operator chose it (${String(live.marketSystemModeUpdatedBy)})`
    );
  } else if (referenceRank < 0 || liveRank < 0) {
    notes.push(`market tier left at "${liveTier}" — tier not on the known ladder`);
  } else if (referenceRank <= liveRank) {
    notes.push(`market tier left at "${liveTier}" — already at or above the reference tier`);
  } else if (!isFreshWorld) {
    notes.push(
      `market tier left at "${liveTier}" — world is past its first game day (turn ${currentTurn ?? "unknown"}); ` +
        `raising it is an operator decision through /api/admin/config/market`
    );
  } else {
    tierRaisedFrom = liveTier ?? null;
    set.marketSystemMode = referenceTier;
    set.marketSystemModeUpdatedBy = ACTOR;
    set.marketSystemModeUpdatedAt = new Date().toISOString();
    set.marketSystemModeUpdatedTurn = currentTurn;
    notes.push(
      `market tier raised "${liveTier}" -> "${referenceTier}" (unchosen, world at turn ${currentTurn})`
    );
  }

  if (Object.keys(set).length === 0) {
    notes.push("nothing to change");
    return { documentsScanned: 1, documentsUpdated: 0, notes };
  }

  if (dryRun) {
    notes.push(`DRY RUN — would set: ${Object.keys(set).join(", ")}`);
    return { documentsScanned: 1, documentsUpdated: 0, notes };
  }

  await db.collection<{ _id: string } & Record<string, unknown>>("gameConfig").updateOne({ _id: referenceGameConfig._id }, { $set: set });

  // Written directly rather than through `createAdminLog`, which opens its own
  // connection via getDb(); the runner already handed us a Db.
  await db.collection("adminLogs").insertOne({
    action: "config.adopt_reference_gates",
    adminUsername: ACTOR,
    details: {
      migration: MARKER_ID,
      filledGates: filled,
      readoptedGates: readopted,
      marketTierRaisedFrom: tierRaisedFrom,
      marketTierRaisedTo: tierRaisedFrom ? referenceTier : null,
      turn: currentTurn,
    },
    createdAt: new Date(),
  });

  return { documentsScanned: 1, documentsUpdated: 1, notes };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const db = await connectDb();
  try {
    const result = await runAdoptReferenceGameConfigGates(db, { dryRun });
    console.log(`[${MARKER_ID}] ${dryRun ? "DRY RUN " : ""}complete:`);
    for (const note of result.notes ?? []) console.log(`  · ${note}`);

    if (!dryRun) {
      await db
        .collection<{ _id: string; completedAt: Date; result: MigrationResult }>("migrationsRun")
        .updateOne(
          { _id: MARKER_ID },
          { $set: { _id: MARKER_ID, completedAt: new Date(), result } },
          { upsert: true }
        );
    }
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
