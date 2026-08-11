/**
 * One-time backfill for the Live Treasury Balance feature
 * (the design doc §7).
 *
 * For every `federalBudget` document, seed the signed national cash position to
 * the country's current fiscal debt:
 *
 *     treasuryBalance = −debt.principal
 *
 * The central bank's `reserveBalance` is LEFT UNCHANGED — it keeps its current
 * value and continues to serve FX intervention (mechanically updated by FX flows
 * going forward). Nationalization money flows now move `treasuryBalance`, not the
 * reserve. A country with no debt simply starts at 0.
 *
 * The per-turn `processTreasuryTurn` engine SKIPS any federalBudget whose
 * `treasuryBalance` is still absent, so this migration must run before the
 * engine accrues — it seeds the field exactly once.
 *
 * Idempotent: skips any federalBudget that already has `treasuryBalance` set.
 *
 * Usage:
 *   # Dry run against the LIVE DB (default, no writes):
 *   npx tsx scripts/migrations/2026-06-03-seed-treasury-balance.ts
 *
 *   # Apply for real (live):
 *   npx tsx scripts/migrations/2026-06-03-seed-treasury-balance.ts --apply
 *
 *   # Run against the local DB instead:
 *   npx tsx scripts/migrations/2026-06-03-seed-treasury-balance.ts --db=local --apply
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

function loadEnvLocal(): string | null {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "..", ".env.local"),
    path.resolve(process.cwd(), "..", "..", ".env.local"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return candidate;
    }
  }
  dotenv.config();
  return null;
}

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const envPath = loadEnvLocal();
  const dbMode = getArg("db") === "local" ? "local" : "live";
  const uriKey = dbMode === "local" ? "MONGODB_URI" : "MONGODB_URI_LIVE";
  const uri = process.env[uriKey];
  if (!uri) {
    throw new Error(
      `Missing ${uriKey}. Loaded env from ${envPath ?? "default dotenv resolution"}.`
    );
  }
  const apply = hasFlag("apply");

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db("a-house-divided");
    console.log(`Mode: ${dbMode.toUpperCase()}${apply ? " (APPLY)" : " (dry-run)"}`);

    const budgets = await db
      .collection("federalBudget")
      .find({}, { projection: { _id: 1, countryId: 1, "debt.principal": 1, treasuryBalance: 1 } })
      .toArray();

    let seeded = 0;
    let skipped = 0;
    for (const b of budgets) {
      const countryId = b.countryId as CountryId;
      const principal = (b.debt?.principal as number | undefined) ?? 0;

      if (b.treasuryBalance != null) {
        console.log(`[${countryId}] skip — treasuryBalance already set (${b.treasuryBalance})`);
        skipped += 1;
        continue;
      }

      // Fiscal position only — the FX reserveBalance is left untouched.
      const newBalance = -Math.round(principal);

      console.log(
        `[${countryId}] principal=${principal} => treasuryBalance=${newBalance}` +
          `${apply ? "" : " (dry-run)"}`
      );

      if (apply) {
        await db
          .collection("federalBudget")
          .updateOne({ _id: b._id }, { $set: { treasuryBalance: newBalance } });
      }
      seeded += 1;
    }

    console.log(
      `\nDone. ${seeded} budget(s) ${apply ? "seeded" : "would be seeded"}, ${skipped} skipped.`
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
