#!/usr/bin/env tsx
/**
 * Explicitly promote the current MONGODB_URI_LIVE world to Demographics v2.
 *
 * This is deliberately not part of the automatic migration chain. It verifies
 * the live population vectors before a single atomic gameState write installs
 * the receipt and gate. Dry-run is the default.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-10-07-activate-live-demographics-v2.ts
 *   npx tsx scripts/migrations/2026-10-07-activate-live-demographics-v2.ts \
 *     --apply --expected-world-id=<resetWorldId printed by the dry-run>
 */
import dotenv from "dotenv";
import path from "node:path";
import type { GameState } from "@/lib/db/types/gameState";
import { resolveMongoDbName } from "@/lib/mongodb";
import {
  LIVE_DEMOGRAPHICS_V2_MIGRATION_ID,
  migration,
} from "@/lib/migrations/entries/2026-10-07-activate-live-demographics-v2";
import { runMigrations } from "@/lib/migrations/runner";
import { closeDb, connectDb } from "../utils/db";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

interface Args {
  apply: boolean;
  expectedWorldId?: string;
}

function parseArgs(argv: string[]): Args {
  const result: Args = { apply: false };
  for (const arg of argv) {
    if (arg === "--apply") result.apply = true;
    else if (arg.startsWith("--expected-world-id=")) {
      result.expectedWorldId = arg.slice("--expected-world-id=".length).trim();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (result.apply && !result.expectedWorldId) {
    throw new Error("--apply requires --expected-world-id from a fresh dry-run");
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const liveUri = process.env.MONGODB_URI_LIVE;
  if (!liveUri) throw new Error("MONGODB_URI_LIVE must be set in .env.local");
  const liveHost = new URL(liveUri).hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(liveHost)) {
    throw new Error("MONGODB_URI_LIVE resolves directly to a loopback host; refusing to run");
  }
  const dbName =
    process.env.MONGODB_DB_LIVE?.trim() || resolveMongoDbName({ MONGODB_URI: liveUri });
  const directUri = /[?&]directConnection=/i.test(liveUri)
    ? liveUri.replace(/([?&])directConnection=[^&]*/i, "$1directConnection=true")
    : `${liveUri}${liveUri.includes("?") ? "&" : "?"}directConnection=true`;
  const db = await connectDb(dbName, directUri);

  try {
    const state = await db
      .collection<GameState>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { resetWorldId: 1, currentTurn: 1, isActive: 1 } }
      );
    if (!state) throw new Error("Current gameState was not found");
    if (typeof state.resetWorldId !== "string" || state.resetWorldId.length === 0) {
      throw new Error("Current world has no resetWorldId and cannot be safely promoted");
    }
    if (args.apply && args.expectedWorldId !== state.resetWorldId) {
      throw new Error("--expected-world-id does not match the current live world");
    }

    console.log(
      JSON.stringify(
        {
          migration: LIVE_DEMOGRAPHICS_V2_MIGRATION_ID,
          mode: args.apply ? "apply" : "dry-run",
          connection: "MONGODB_URI_LIVE",
          worldId: state.resetWorldId,
          currentTurn: state.currentTurn,
          active: state.isActive === true,
        },
        null,
        2
      )
    );

    const summary = await runMigrations(db, {
      migrations: [migration],
      dryRun: !args.apply,
      only: [migration.id],
    });
    const result = summary.results[migration.id];
    console.log(
      JSON.stringify(
        {
          ran: summary.ranIds,
          skipped: summary.skippedIds,
          result: result ?? null,
        },
        null,
        2
      )
    );
    if (!args.apply) {
      console.log(`Dry-run only. Apply with --apply --expected-world-id=${state.resetWorldId}`);
    }
  } finally {
    await closeDb();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
