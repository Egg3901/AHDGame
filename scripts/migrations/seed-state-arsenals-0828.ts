/**
 * Seed the national arsenals of the planned-defence economies.
 *
 * RU and DD have never been able to use the defence-contract pipeline that fills the
 * arsenal, so `applyDefenceRefit` has early-returned on an empty store for the whole life
 * of the save. RU's last procurement window closed on turn 204; DD has never signed a
 * contract at all. Their formations have been losing equipment to every battle with
 * nothing to replace it from, which is why RU sits at 45% kitted and DD at 19%.
 *
 * `applyStateArmsProduction` fixes that going forward, but only at 3 and 1 lots a turn.
 * Left alone, RU would need 81 turns and DD 60 just to reach the equipped state the
 * mechanic assumes as its baseline. This is the one-off that closes that gap, in the same
 * spirit as the readiness heal: compensation for a mechanic that never ran, not a gift.
 *
 * Deposits exactly each domain's SHORTFALL — the lots needed to bring existing formations
 * to a full load. It deliberately does NOT seed the reserve ceiling on top; banking a war
 * stock is what peacetime production is for.
 *
 * Dry run by default. Deliberately one script rather than the dry-run/apply pair used for
 * the readiness heal: the two would share every line of this calculation, and a pair that
 * drifts is worse than a single path exercised both ways.
 *
 * Usage:
 *   npx tsx scripts/migrations/seed-state-arsenals-0828.ts               # dry run
 *   npx tsx scripts/migrations/seed-state-arsenals-0828.ts --apply       # live
 *   npx tsx scripts/migrations/seed-state-arsenals-0828.ts --apply --db=local
 */
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import type { Db } from "mongodb";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { getNationalArsenal, depositLots } from "@/lib/db/collections/nationalArsenal";
import { getUnitArchetype } from "@/lib/constants/military";
import { lotsRequired, lotsToFillUnit } from "@/lib/military/arsenal";
import { STATE_ARMS_INDUSTRY } from "@/lib/military/stateArmsIndustry";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

/** Standard, the same grade the state-arms turn step issues at and the US store holds. */
const GRADE = 1;

function uriFor(local: boolean): string {
  let u = (local ? process.env.MONGODB_URI : process.env.MONGODB_URI_LIVE) as string;
  if (!u) throw new Error(local ? "MONGODB_URI unset" : "MONGODB_URI_LIVE unset");
  if (!local && !/directConnection=/.test(u))
    u += (u.includes("?") ? "&" : "?") + "directConnection=true";
  return u;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const local = process.argv.includes("--db=local");
  const client = new MongoClient(uriFor(local));
  await client.connect();
  try {
    const db = client.db() as unknown as Db;
    console.log(`target: ${local ? "MONGODB_URI (local/testing)" : "MONGODB_URI_LIVE"}`);
    console.log(apply ? "MODE: APPLY (writes)\n" : "MODE: dry run (no writes)\n");

    for (const countryId of Object.keys(STATE_ARMS_INDUSTRY)) {
      const units = (await db
        .collection("militaryUnits")
        .find({ countryId })
        .toArray()) as unknown as MilitaryUnit[];
      const arsenal = await getNationalArsenal(db, countryId);

      const shortfall: Record<string, number> = {};
      for (const u of units) {
        const archetype = getUnitArchetype(u.domain, u.type);
        if (!archetype) continue;
        shortfall[u.domain] =
          (shortfall[u.domain] ?? 0) + lotsToFillUnit(u, lotsRequired(archetype));
      }

      const held = Object.entries(arsenal.stock)
        .filter(([, v]) => v > 0)
        .map(([d, v]) => `${d} ${v}`)
        .join(", ");
      console.log(
        `${countryId}: ${units.length} formations, store currently holds ${held || "nothing"}`
      );

      for (const [domain, need] of Object.entries(shortfall)) {
        const have = arsenal.stock[domain as keyof typeof arsenal.stock] ?? 0;
        const deposit = Math.max(0, need - have);
        if (deposit <= 0) {
          console.log(
            `   ${domain.padEnd(8)} short ${String(need).padStart(4)}, holds ${have} -> nothing to do`
          );
          continue;
        }
        console.log(
          `   ${domain.padEnd(8)} short ${String(need).padStart(4)}, holds ${have} -> deposit ${deposit}`
        );
        if (apply) {
          await depositLots(
            db,
            countryId,
            domain as Parameters<typeof depositLots>[2],
            deposit,
            GRADE
          );
        }
      }
    }

    if (apply) {
      console.log("\nverification:");
      for (const countryId of Object.keys(STATE_ARMS_INDUSTRY)) {
        const after = await getNationalArsenal(db, countryId);
        const held = Object.entries(after.stock)
          .filter(([, v]) => v > 0)
          .map(([d, v]) => `${d} ${v}`)
          .join(", ");
        console.log(`  ${countryId}: ${held || "EMPTY - unexpected"}`);
      }
    } else {
      console.log("\nNo writes performed. Re-run with --apply.");
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
