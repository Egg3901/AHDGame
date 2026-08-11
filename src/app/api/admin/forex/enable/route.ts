// POST /api/admin/forex/enable — One-time migration to enable the forex system.
// Auth: requireAdmin
// Errors: 400 (already enabled), 404, 409 (turn processing), 500
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types";
import { getProcessingLockState } from "@/lib/turn/processingLock";
import {
  migrateCharacterBalances,
  seedExchangeRates,
  migrateCorporationLiquidCapital,
  updateCentralBanks,
  createForexIndexes,
} from "@/lib/currency/migration";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";

const FOREX_MIGRATION_HEARTBEAT_MS = 30_000;

export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gameStateCol = db.collection<GameState>("gameState");
    const gameState = await gameStateCol.findOne({ _id: "current" });

    if (!gameState) {
      return NextResponse.json({ error: "Game state not initialized" }, { status: 404 });
    }

    if (gameState.forexEnabled) {
      return NextResponse.json({ error: "Forex already enabled" }, { status: 400 });
    }

    if (gameState.isProcessing) {
      // The forex migration takes its own lock, so it cannot proceed while
      // any turn-lock exists. But if the lock is stale (prior process crashed
      // mid-turn), the generic "wait for it to finish" message dead-ends the
      // admin — surface the staleness + the reset path explicitly so they
      // know to clear the lock via /api/admin/turn/reset-lock before retrying.
      const lockState = getProcessingLockState(gameState);
      if (lockState.isStale) {
        return NextResponse.json(
          {
            error:
              "Turn processing lock appears stale (prior turn likely crashed). Reset the lock via Admin → Turn → Reset Lock, then retry forex enable.",
            lockStale: true,
            lockLastTouch: lockState.lastTouch?.toISOString() ?? null,
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Turn is currently processing. Wait for it to finish." },
        { status: 409 }
      );
    }

    // Lock — prevent turns during migration
    const lockStartedAt = new Date();
    await gameStateCol.updateOne(
      { _id: "current" },
      {
        $set: {
          isProcessing: true,
          processingKind: "forexMigration",
          processingPhase: "forexMigration",
          processingStartedAt: lockStartedAt,
          processingHeartbeatAt: lockStartedAt,
          updatedAt: lockStartedAt,
        },
      }
    );

    const heartbeatTimer = setInterval(() => {
      void gameStateCol
        .updateOne(
          { _id: "current", isProcessing: true, processingKind: "forexMigration" },
          {
            $set: {
              processingHeartbeatAt: new Date(),
              processingPhase: "forexMigration",
            },
          }
        )
        .catch(() => {
          // Best-effort heartbeat only. The route still clears the lock in the main flow.
        });
    }, FOREX_MIGRATION_HEARTBEAT_MS);

    try {
      const migrationResult = await migrateCharacterBalances(db);
      await seedExchangeRates(db, await getGameStatePresetOrDefault(db));
      const corpMigrationResult = await migrateCorporationLiquidCapital(db);
      await updateCentralBanks(db);
      await createForexIndexes(db);

      // Flip the flag and release lock
      await gameStateCol.updateOne(
        { _id: "current" },
        {
          $set: {
            forexEnabled: true,
            isProcessing: false,
            processingKind: null,
            processingPhase: null,
            processingStartedAt: null,
            processingHeartbeatAt: null,
            updatedAt: new Date(),
          },
        }
      );

      return NextResponse.json({
        success: true,
        message: "Forex system enabled",
        migration: {
          charactersProcessed: migrationResult.processed,
          charactersSkipped: migrationResult.skipped,
          corporationsProcessed: corpMigrationResult.processed,
          corporationsSkipped: corpMigrationResult.skipped,
        },
      });
    } catch (migrationError) {
      // Release lock but do NOT set forexEnabled — allows retry after fix
      await gameStateCol.updateOne(
        { _id: "current" },
        {
          $set: {
            isProcessing: false,
            processingKind: null,
            processingPhase: null,
            processingStartedAt: null,
            processingHeartbeatAt: null,
            updatedAt: new Date(),
          },
        }
      );
      throw migrationError;
    } finally {
      clearInterval(heartbeatTimer);
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
