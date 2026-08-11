/**
 * Targeted DB repairs for one corporation (support / operator use).
 *
 * Resolves the corp by URL-style id: `--sequential-id=104` or `--mongo-id=<24-char hex>`.
 * Without `--apply`, prints the plan only (no writes).
 *
 * Flags (combine as needed):
 *   --set-type=<CorporationType>     e.g. healthcare, agriculture, financial
 *   --clear-type-switch-timers       $unset typeSwitchTurn + typeSwitchCooldownUntilTurn
 *   --clear-secondary-type           $unset secondaryType
 *   --clear-bond-cooldown            Backdates issuedAtTurn on latest bond (by issuedAtTurn)
 *                                    so issuance cooldown is expired (does not change maturityTurn).
 *
 * Examples (omit --apply to print plan only):
 *   npx tsx scripts/support-repair-corporation.ts --sequential-id=104 --set-type=healthcare --clear-type-switch-timers
 *   npx tsx scripts/support-repair-corporation.ts --sequential-id=104 --apply \
 *     --set-type=healthcare --clear-type-switch-timers --clear-bond-cooldown
 *
 * Requires MONGODB_URI in .env.local (use production URI only when intentionally targeting live).
 */

import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";

import type { Corporation } from "@/lib/db/types/corporation";
import type { Bond } from "@/lib/db/types/bond";
import { CORPORATION_TYPES, type CorporationType } from "@/lib/constants/corporations";
import { BOND_ISSUANCE_COOLDOWN_TURNS } from "@/lib/constants/bonds";

dotenv.config({ path: ".env.local" });

const VALID_TYPES = new Set<string>(CORPORATION_TYPES);

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function usage(): void {
  console.error(
    `
Usage:
  npx tsx scripts/support-repair-corporation.ts --sequential-id=<n> [options]
  npx tsx scripts/support-repair-corporation.ts --mongo-id=<24hex> [options]

Options:
  --apply     Perform updates (omit to print plan only; no DB writes)

  --set-type=<type>
  --clear-type-switch-timers
  --clear-secondary-type
  --clear-bond-cooldown

At least one mutating flag is required with --apply.
`.trim()
  );
}

async function main(): Promise<void> {
  const seqRaw = argValue("sequential-id");
  const mongoId = argValue("mongo-id");
  const apply = hasFlag("apply");

  if ((!seqRaw && !mongoId) || (seqRaw && mongoId)) {
    usage();
    process.exit(1);
  }

  const setTypeRaw = argValue("set-type");
  const clearTimers = hasFlag("clear-type-switch-timers");
  const clearSecondary = hasFlag("clear-secondary-type");
  const clearBondCooldown = hasFlag("clear-bond-cooldown");

  if (setTypeRaw && !VALID_TYPES.has(setTypeRaw)) {
    console.error(
      `Invalid --set-type="${setTypeRaw}". Must be one of: ${CORPORATION_TYPES.join(", ")}`
    );
    process.exit(1);
  }

  const hasMutation = Boolean(setTypeRaw) || clearTimers || clearSecondary || clearBondCooldown;

  if (apply && !hasMutation) {
    console.error(
      "With --apply, pass at least one of: --set-type, --clear-type-switch-timers, --clear-secondary-type, --clear-bond-cooldown"
    );
    process.exit(1);
  }

  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI not found in .env.local");
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  try {
    let query: Record<string, unknown>;
    if (mongoId) {
      if (!ObjectId.isValid(mongoId) || mongoId.length !== 24) {
        console.error("--mongo-id must be a 24-character hex ObjectId");
        process.exit(1);
      }
      query = { _id: new ObjectId(mongoId) };
    } else {
      const n = parseInt(seqRaw!, 10);
      if (!Number.isFinite(n) || n < 0) {
        console.error("--sequential-id must be a non-negative integer");
        process.exit(1);
      }
      query = { sequentialId: n };
    }

    const corp = await db.collection<Corporation>("corporations").findOne(query);
    if (!corp) {
      console.error("Corporation not found for query:", query);
      process.exit(1);
    }

    const gameState = await db
      .collection<{ _id: string; currentTurn?: number }>("gameState")
      .findOne({ _id: "current" });
    const currentTurn = gameState?.currentTurn ?? 1;

    console.log("--- Corporation ---");
    console.log(`  _id:            ${corp._id.toHexString()}`);
    console.log(`  sequentialId:   ${corp.sequentialId ?? "(none)"}`);
    console.log(`  name:           ${corp.name}`);
    console.log(`  type:           ${corp.type}`);
    console.log(`  secondaryType:  ${corp.secondaryType ?? "(none)"}`);
    console.log(`  typeSwitchTurn: ${corp.typeSwitchTurn ?? "(none)"}`);
    console.log(`  typeSwitchCD:   ${corp.typeSwitchCooldownUntilTurn ?? "(none)"}`);
    console.log(`  currentTurn:    ${currentTurn}`);

    const $set: Record<string, unknown> = { updatedAt: new Date() };
    const $unset: Record<string, string> = {};

    if (setTypeRaw) {
      const next = setTypeRaw as CorporationType;
      if (corp.secondaryType && next === corp.secondaryType) {
        console.error(
          "Refused: new primary type matches secondaryType; clear secondary first (--clear-secondary-type)."
        );
        process.exit(1);
      }
      if (corp.type !== next) {
        console.log(`\n[set-type] ${corp.type} -> ${next}`);
        $set.type = next;
      } else {
        console.log(`\n[set-type] already ${next} — skip`);
      }
    }

    if (clearTimers) {
      if (corp.typeSwitchTurn != null || corp.typeSwitchCooldownUntilTurn != null) {
        console.log(
          "\n[clear-type-switch-timers] unset typeSwitchTurn, typeSwitchCooldownUntilTurn"
        );
        $unset.typeSwitchTurn = "";
        $unset.typeSwitchCooldownUntilTurn = "";
      } else {
        console.log("\n[clear-type-switch-timers] nothing set — skip");
      }
    }

    if (clearSecondary) {
      if (corp.secondaryType != null) {
        console.log("\n[clear-secondary-type] unset secondaryType");
        $unset.secondaryType = "";
      } else {
        console.log("\n[clear-secondary-type] already empty — skip");
      }
    }

    if (clearBondCooldown) {
      const latestBond = await db
        .collection<Bond>("bonds")
        .findOne({ corporationId: corp._id }, { sort: { issuedAtTurn: -1 } });
      if (!latestBond) {
        console.log("\n[clear-bond-cooldown] no bonds for this corp — skip");
      } else {
        const newIssued = currentTurn - BOND_ISSUANCE_COOLDOWN_TURNS - 1;
        console.log(
          `\n[clear-bond-cooldown] bond ${latestBond._id.toHexString()}: issuedAtTurn ${latestBond.issuedAtTurn} -> ${newIssued} (maturityTurn unchanged: ${latestBond.maturityTurn})`
        );
        if (apply) {
          await db
            .collection<Bond>("bonds")
            .updateOne(
              { _id: latestBond._id },
              { $set: { issuedAtTurn: newIssued, updatedAt: new Date() } }
            );
        }
      }
    }

    const corpNeedsUpdate = Object.keys($set).length > 1 || Object.keys($unset).length > 0;

    if (!apply) {
      console.log("\nDry run (no writes). Re-run with --apply to execute corporation $set/$unset.");
      if (clearBondCooldown) {
        console.log(
          "Note: --clear-bond-cooldown still shown above; with --apply it updates bonds in a separate write."
        );
      }
      return;
    }

    if (corpNeedsUpdate) {
      const update: Record<string, unknown> = {};
      if (Object.keys($set).length > 0) update.$set = $set;
      if (Object.keys($unset).length > 0) update.$unset = $unset;
      const res = await db
        .collection<Corporation>("corporations")
        .updateOne({ _id: corp._id }, update);
      console.log(
        `\nCorporation update: matched=${res.matchedCount} modified=${res.modifiedCount}`
      );
    } else {
      console.log("\nCorporation document: no $set/$unset needed.");
    }

    console.log("\nDone.");
  } finally {
    await client.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
