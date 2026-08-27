/**
 * Operational tempo: does a fatigue penalty restore a real cadence tradeoff?
 *
 * Today readiness is ASSIGNED a level scaled by `armorMit` and the role's casualty
 * weight, which inverts both (armour and safe roles end up more exhausted). Those two
 * terms are correct for a SUBTRACTION, so this models readiness as a drop:
 *
 *   drop = BASE x armorMit x roleCas x intensity x (1 + K x depletion)
 *   next = max(3, current - drop)
 *
 * where depletion = 1 - current/baseline. A rested formation pays BASE; one that has
 * been fighting without rest pays up to BASE x (1 + K). That is the "continuous pace
 * leaves little room for rest" curve.
 *
 * The bar is high: attacking every turn currently yields ~19x the ground per unit of
 * time that attacking every twenty does, so a tempo penalty has to be sharp to produce
 * an interior optimum rather than merely shaving the top.
 *
 *   npx tsx scripts/sim/readinessTempo.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Db } from "mongodb";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { resolvePvpBattle, battleForecast } from "@/lib/military/battle";
import { buildBattleSide } from "@/lib/military/battleSides";
import { conflictToFront } from "@/lib/military/createConflict";
import { occupationShift } from "@/lib/military/occupation";
import { recommendRole, roleDef, statObj, computeCard } from "@/lib/military/combat";
import { READINESS_DRIFT_STEP, readinessBaselineOf } from "@/lib/military/readinessDrift";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const THEATER = "war_us_dd_415";
const BATTLES = 14;
const one = (x: number) => x.toFixed(1);
void computeCard;

/** The proposed drop. Same terms as today, applied as a subtraction instead of a level. */
function readinessDrop(u: MilitaryUnit, ratio: number, BASE: number, K: number): number {
  const st = statObj(u);
  const armorMit = 1 - (st.ar / 100) * 0.45; // armour now REDUCES the drop
  const rc = roleDef(recommendRole(u)).cas; // exposure now INCREASES the drop
  const baseline = readinessBaselineOf(u.posture, 0, null);
  const depletion = Math.max(0, Math.min(1, 1 - u.readiness / Math.max(1, baseline)));
  const intensity = 0.6 + 0.8 * (1 - ratio); // harder fights cost more
  return BASE * armorMit * rc * intensity * (1 + K * depletion);
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db() as unknown as Db;
    const conflict = (await db
      .collection("conflicts")
      .findOne({ _id: THEATER as never })) as unknown as ConflictDoc;
    const fronts = { [THEATER]: conflictToFront(conflict) };
    const all = (await db
      .collection("militaryUnits")
      .find({ theaterId: THEATER })
      .toArray()) as unknown as MilitaryUnit[];
    const by = (c: string) => all.filter((u) => String(u.countryId) === c);
    const rested = (us: MilitaryUnit[]) =>
      us.map((u) => ({ ...u, readiness: readinessBaselineOf(u.posture, 0, null) }));

    async function cycle(gap: number, BASE: number, K: number) {
      let att = rested(by("DD"));
      let def = rested(by("US"));
      let wins = 0,
        ground = 0;
      const rd: number[] = [];
      for (let b = 0; b < BATTLES; b++) {
        const aSide = await buildBattleSide(db, "DD", att, fronts, conflict.supplyB, "B");
        const dSide = await buildBattleSide(db, "US", def, fronts, conflict.supplyA, "A");
        rd.push(att.reduce((a, u) => a + u.readiness, 0) / att.length);
        const fc = battleForecast([aSide], [dSide], THEATER);
        const r = resolvePvpBattle([aSide], [dSide], THEATER, (b + 1) * 7919 + 13);
        if (r.win) wins++;
        const next = occupationShift({
          control: 50,
          winner: r.win ? "B" : "A",
          margin: r.margin,
          loserRetreated: !!r.retreat,
        });
        ground += r.win ? next - 50 : -(50 - next);

        const fought = new Set(
          [...r.attacker.unitResults, ...r.defender.unitResults].map((x) => x.id)
        );
        const step = (us: MilitaryUnit[], ratio: number) =>
          us.map((u) => {
            const baseline = readinessBaselineOf(u.posture, 0, null);
            let next2 = u.readiness;
            if (fought.has(String(u._id))) {
              next2 = Math.max(3, u.readiness - readinessDrop(u, ratio, BASE, K));
            }
            for (let t = 0; t < gap; t++) next2 = Math.min(baseline, next2 + READINESS_DRIFT_STEP);
            return { ...u, readiness: next2 };
          });
        att = step(att, fc.ratio);
        def = step(def, 1 - fc.ratio);
      }
      const turns = BATTLES * gap;
      return {
        readiness: rd.reduce((a, b) => a + b, 0) / rd.length,
        win: wins / BATTLES,
        ground,
        rate: (ground / turns) * 100,
      };
    }

    const CADENCES = [1, 2, 3, 5, 8, 13, 20];

    console.log(
      "Ground per 100 turns by attack cadence. An interior maximum means tempo matters.\n"
    );
    for (const [BASE, K] of [
      [0, 0],
      [8, 0],
      [8, 2],
      [8, 4],
      [12, 3],
      [12, 6],
      [16, 6],
    ] as [number, number][]) {
      const label = BASE === 0 ? "today (level assignment, no tempo)" : `drop BASE ${BASE}  K ${K}`;
      const out: string[] = [];
      let best = -Infinity,
        bestGap = 0;
      for (const gap of CADENCES) {
        const c = await cycle(gap, BASE, K);
        out.push(
          `${String(gap).padStart(2)}t: ${one(c.rate).padStart(6)} (rd ${one(c.readiness).padStart(4)}, win ${Math.round(c.win * 100)}%)`
        );
        if (c.rate > best) {
          best = c.rate;
          bestGap = gap;
        }
      }
      console.log(`-- ${label} --`);
      console.log(`   ${out.join("  |  ")}`);
      console.log(
        `   best cadence: every ${bestGap} turns${bestGap === 1 ? "  <- no tradeoff, attack constantly" : "  <- interior optimum"}\n`
      );
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
