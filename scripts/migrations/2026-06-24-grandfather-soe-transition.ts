/**
 * Idempotent migration: grandfather every EXISTING state-owned sector to the
 * BASE nationalization transition schedule by stamping
 * `nationalizationTransitionMultiplier: 1`.
 *
 * The rebalance fixes each sector's transition shock to the SOCI escalation
 * multiplier captured AT TAKING TIME (a per-sector snapshot). Sectors taken
 * before this feature existed have no snapshot; the turn code defaults absent ⇒ 1,
 * but this migration makes the grandfather explicit + durable so a high-SOCI
 * country's already-settled SOEs are never retroactively yanked back into a
 * deepened/lengthened digestion on deploy. Each sector's age (`nationalizedAtTurn`)
 * still decides how far along its base 120-turn digestion it is — long-settled
 * sectors stay settled, recently-taken ones finish their original tail.
 *
 * Scope: sectors owned by a state-owned corp (`countryOwnerId` set) that have a
 * `nationalizedAtTurn` and lack `nationalizationTransitionMultiplier`. New takings
 * stamp the live multiplier themselves, so they are skipped.
 *
 * Idempotent: re-runs are no-ops (the `{ $exists: false }` filter).
 *
 * Usage:
 *   # Dry run against the LIVE DB (default, no writes):
 *   npx tsx scripts/migrations/2026-06-24-grandfather-soe-transition.ts
 *   # Apply for real (live):
 *   npx tsx scripts/migrations/2026-06-24-grandfather-soe-transition.ts --apply
 *   # Local DB:
 *   npx tsx scripts/migrations/2026-06-24-grandfather-soe-transition.ts --db=local --apply
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

function loadEnvLocal(): string | null {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "..", ".env.local"),
    path.resolve(process.cwd(), "..", "..", ".env.local"),
    // one more level so it resolves when run from a nested worktree dir
    path.resolve(process.cwd(), "..", "..", "..", ".env.local"),
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

    // State-owned corps → their _ids (+ country, for the report).
    const soeCorps = await db
      .collection("corporations")
      .find(
        { countryOwnerId: { $exists: true, $ne: null } },
        { projection: { _id: 1, countryOwnerId: 1 } }
      )
      .toArray();
    const countryByCorp = new Map(
      soeCorps.map((c) => [c._id.toString(), String(c.countryOwnerId)])
    );
    const soeCorpIds = soeCorps.map((c) => c._id);

    const filter = {
      corporationId: { $in: soeCorpIds },
      nationalizedAtTurn: { $exists: true },
      nationalizationTransitionMultiplier: { $exists: false },
    };

    const targets = await db
      .collection("corporateSectors")
      .find(filter, { projection: { _id: 1, corporationId: 1, sectorType: 1 } })
      .toArray();

    const byCountry: Record<string, number> = {};
    for (const s of targets) {
      const c = countryByCorp.get(s.corporationId.toString()) ?? "(unknown)";
      byCountry[c] = (byCountry[c] ?? 0) + 1;
    }
    console.log(
      `\nState-owned sectors to grandfather (set transitionMultiplier=1): ${targets.length}`
    );
    for (const [c, n] of Object.entries(byCountry).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${c}: ${n}`);
    }

    if (apply && targets.length > 0) {
      const res = await db.collection("corporateSectors").updateMany(filter, {
        $set: { nationalizationTransitionMultiplier: 1, updatedAt: new Date() },
      });
      console.log(`\nGrandfathered ${res.modifiedCount} sector(s).`);
    } else {
      console.log(
        `\nDone. ${targets.length} sector(s) ${apply ? "grandfathered" : "would be grandfathered"}.`
      );
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
