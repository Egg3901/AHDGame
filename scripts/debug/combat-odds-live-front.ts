/**
 * What the war room shows RIGHT NOW on the live front, both directions, under the
 * fortune-calibrated resolver.
 *
 * Scratch/debug: reads live, writes nothing.
 *   npx tsx scripts/debug/combat-odds-live-front.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Db } from "mongodb";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { battleForecast, resolvePvpBattle, type BattleSide } from "@/lib/military/battle";
import { buildCoalitionSide } from "@/lib/military/battleSides";
import { conflictToFront } from "@/lib/military/createConflict";
import { ATTRITION } from "@/lib/military/config";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const THEATER = process.env.SIM_THEATER ?? "war_us_dd_415";
const TRIALS = Number(process.env.SIM_TRIALS ?? 400);
const pct = (n: number) => (n * 100).toFixed(1) + "%";

function winRate(a: BattleSide[], d: BattleSide[], spread: number) {
  let wins = 0;
  const verdicts: Record<string, number> = {};
  for (let s = 0; s < TRIALS; s++) {
    const r = resolvePvpBattle(a, d, THEATER, s * 7919, undefined, undefined, spread);
    if (r.win) wins++;
    verdicts[r.verdict] = (verdicts[r.verdict] ?? 0) + 1;
  }
  return { rate: wins / TRIALS, verdicts };
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db() as unknown as Db;
    const conflict = (await db
      .collection("conflicts")
      .findOne({ _id: THEATER as never })) as unknown as ConflictDoc;
    if (!conflict) throw new Error(`no conflict ${THEATER}`);
    const fronts = { [THEATER]: conflictToFront(conflict) };

    const atFront = (await db
      .collection("militaryUnits")
      .find({ theaterId: THEATER })
      .toArray()) as unknown as MilitaryUnit[];
    const unitsByCountry = new Map<string, MilitaryUnit[]>();
    for (const u of atFront) {
      const list = unitsByCountry.get(u.countryId) ?? [];
      list.push(u);
      unitsByCountry.set(u.countryId, list);
    }

    console.log(`Front: ${THEATER} — ${conflict.name}`);
    console.log(`  terrain ${conflict.terrain}  control ${conflict.control}`);
    console.log(`  side A (${conflict.sideA.label}): ${conflict.sideA.countries.join(", ")}`);
    console.log(`  side B (${conflict.sideB.label}): ${conflict.sideB.countries.join(", ")}`);
    console.log(`  supply A ${conflict.supplyA ?? "-"}  supply B ${conflict.supplyB ?? "-"}`);
    console.log("\nWho actually has formations at this front:");
    for (const [c, us] of [...unitsByCountry].sort()) {
      const men = us.reduce((a, u) => a + u.personnel, 0);
      const side = conflict.sideA.countries.includes(c as never)
        ? "A"
        : conflict.sideB.countries.includes(c as never)
          ? "B"
          : "?";
      console.log(
        `  ${c} (side ${side}): ${String(us.length).padStart(3)} formations, ` +
          `${men.toLocaleString("en-US")} men`
      );
    }

    // Everyone present on each side. Defence pools all of them; an offensive pools the
    // declarers, which for "what if they all attacked" is the same roster.
    const westAll = conflict.sideA.countries.filter((c) => unitsByCountry.get(c)?.length);
    const eastAll = conflict.sideB.countries.filter((c) => unitsByCountry.get(c)?.length);
    const [west, east] = await Promise.all([
      buildCoalitionSide(db, westAll, unitsByCountry, fronts, conflict.supplyA, "A"),
      buildCoalitionSide(db, eastAll, unitsByCountry, fronts, conflict.supplyB, "B"),
    ]);

    const order = ["Decisive Victory", "Victory", "Pyrrhic Victory", "Costly Defeat", "Rout"];
    const report = (label: string, a: BattleSide[], d: BattleSide[]) => {
      const fc = battleForecast(a, d, THEATER);
      const before = winRate(a, d, 0);
      const after = winRate(a, d, ATTRITION.fortuneSpread);
      console.log(`\n=== ${label} ===`);
      console.log(`  war room shows        ${String(fc.oddsPct).padStart(3)}%`);
      console.log(`  strength att / def    ${Math.round(fc.attStr)} / ${Math.round(fc.defStr)}`);
      console.log(`  really wins (before)  ${pct(before.rate)}`);
      console.log(`  really wins (now)     ${pct(after.rate)}`);
      console.log(
        "  outcome mix (now)     " +
          order.map((v) => `${v} ${pct((after.verdicts[v] ?? 0) / TRIALS)}`).join("  ")
      );
    };

    report(`${westAll.join("+")} attack ${eastAll.join("+")}`, west, east);
    report(`${eastAll.join("+")} attack ${westAll.join("+")}`, east, west);

    // The asymmetry that matters: an OFFENSIVE pools only the nations that declared,
    // but DEFENCE pools everyone with troops on the ground. So a two-nation attack is
    // met by the whole opposing coalition present, not by its two biggest members.
    const sub = async (cs: string[], side: "A" | "B") =>
      buildCoalitionSide(
        db,
        cs.filter((c) => unitsByCountry.get(c)?.length),
        unitsByCountry,
        fronts,
        side === "A" ? conflict.supplyA : conflict.supplyB,
        side
      );
    const usUk = await sub(["US", "UK"], "A");
    const ddRu = await sub(["DD", "RU"], "B");
    console.log("\n\n--- only these two declare; the other side defends in full ---");
    report("US+UK attack (vs the whole eastern side present)", usUk, east);
    report("DD+RU attack (vs the whole western side present)", ddRu, west);
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
