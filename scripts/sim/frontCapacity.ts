/**
 * Front capacity prototype: what happens if a front can only hold so much in contact.
 *
 * Prototyped WITHOUT touching the engine. `getRole` reads `positions[unitId]` before
 * falling back to `recommendRole`, so over-capacity formations are pushed to the `rear`
 * role (engage 0.10, casualties 0.15) through the same machinery a player uses. That is
 * a close stand-in for a depth assignment: they neither fight nor bleed much.
 *
 * Capacity is a combat-value budget, filled in role-priority order so a player's own
 * frontline/flank assignments decide who stands in the line.
 *
 *   npx tsx scripts/sim/frontCapacity.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Db } from "mongodb";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { resolvePvpBattle, type BattleSide } from "@/lib/military/battle";
import { buildBattleSide } from "@/lib/military/battleSides";
import { conflictToFront } from "@/lib/military/createConflict";
import { occupationShift } from "@/lib/military/occupation";
import { recommendRole } from "@/lib/military/combat";
import { computeEffectivePower } from "@/lib/constants/military";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const THEATER = "war_us_dd_415";
const SEEDS = 400;
const num = (x: number) => Math.round(x).toLocaleString("en-US");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Same shape as `combatValue` minus doctrine, which is enough to rank formations. */
const cvOf = (u: MilitaryUnit) => computeEffectivePower(u) * (0.55 + 0.45 * (u.readiness / 100));

/** Who stands in the line first. The player's own role choice leads. */
const PRIORITY: Record<string, number> = {
  frontline: 0,
  flank: 1,
  support: 2,
  deepstrike: 3,
  reserve: 4,
  rear: 5,
};

/**
 * Fill the front to `capacity` in combat value; everything past it is held in depth.
 * Returns a `positions` map assigning the overflow to `rear`.
 */
function capacityPositions(units: MilitaryUnit[], capacity: number) {
  const ordered = [...units].sort((a, b) => {
    const pa = PRIORITY[recommendRole(a)] ?? 9;
    const pb = PRIORITY[recommendRole(b)] ?? 9;
    if (pa !== pb) return pa - pb;
    if (cvOf(b) !== cvOf(a)) return cvOf(b) - cvOf(a);
    return String(a._id) < String(b._id) ? -1 : 1;
  });
  const positions: Record<string, string> = {};
  let used = 0;
  let inContact = 0;
  for (const u of ordered) {
    const cv = cvOf(u);
    if (used + cv <= capacity || inContact === 0) {
      used += cv;
      inContact++;
    } else {
      positions[String(u._id)] = "rear";
    }
  }
  return { positions, inContact, used, total: units.length };
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

    const ddCv = by("DD").reduce((a, u) => a + cvOf(u), 0);
    const usCv = by("US").reduce((a, u) => a + cvOf(u), 0);
    const ruCv = by("RU").reduce((a, u) => a + cvOf(u), 0);
    console.log("combat value present at the front:");
    console.log(`  DD ${num(ddCv)} over ${by("DD").length} formations`);
    console.log(`  US ${num(usCv)} over ${by("US").length} formations`);
    console.log(`  RU ${num(ruCv)} over ${by("RU").length} formations`);
    console.log(`  DD+RU together ${num(ddCv + ruCv)} over ${by("DD").length + by("RU").length}`);

    const side = async (
      c: string,
      us: MilitaryUnit[],
      s: "A" | "B",
      sup: number,
      cap: number | null
    ) => {
      const base = await buildBattleSide(db, c, us, fronts, sup, s);
      if (cap == null) return { side: base, inContact: us.length, total: us.length };
      const { positions, inContact, total } = capacityPositions(us, cap);
      return {
        side: { ...base, positions: { ...base.positions, ...positions } },
        inContact,
        total,
      };
    };

    async function run(label: string, attackers: string[], cap: number | null) {
      const attParts = await Promise.all(
        attackers.map((c) => side(c, by(c), "B", conflict.supplyB, cap))
      );
      // The cap is a property of the FRONT, so a coalition shares one budget: split it
      // by each contingent's share of the coalition's combat value.
      let attSides: BattleSide[];
      let held = "";
      if (cap == null) {
        attSides = attParts.map((p) => p.side);
        held = attParts.reduce((a, p) => a + p.total, 0) + " in contact";
      } else {
        const totalCv = attackers.reduce((a, c) => a + by(c).reduce((t, u) => t + cvOf(u), 0), 0);
        const parts = await Promise.all(
          attackers.map((c) => {
            const share = by(c).reduce((t, u) => t + cvOf(u), 0) / totalCv;
            return side(c, by(c), "B", conflict.supplyB, cap * share);
          })
        );
        attSides = parts.map((p) => p.side);
        held = `${parts.reduce((a, p) => a + p.inContact, 0)} of ${parts.reduce((a, p) => a + p.total, 0)} in contact`;
      }
      const def = await side("US", by("US"), "A", conflict.supplyA, cap);

      let w = 0,
        aL = 0,
        dL = 0,
        gain = 0;
      for (let i = 0; i < SEEDS; i++) {
        const r = resolvePvpBattle(attSides, [def.side], THEATER, i * 7919 + 13);
        if (r.win) w++;
        aL += r.attacker.loss;
        dL += r.defender.loss;
        const next = occupationShift({
          control: 50,
          winner: r.win ? "B" : "A",
          margin: r.margin,
          loserRetreated: !!r.retreat,
        });
        gain += r.win ? next - 50 : -(50 - next);
      }
      const att = aL / SEEDS,
        dfd = dL / SEEDS,
        net = gain / SEEDS;
      const exch = dfd > 0 ? att / dfd : Infinity;
      console.log(
        `${label.padEnd(34)} ${held.padEnd(18)} win ${pct(w / SEEDS).padStart(6)}  ` +
          `net ${net >= 0 ? "+" : ""}${net.toFixed(2).padStart(5)}  ` +
          `att dead ${num(att).padStart(6)}  def dead ${num(dfd).padStart(5)}  ` +
          `exchange ${exch.toFixed(1).padStart(5)} : 1`
      );
    }

    console.log("\n\n======== NO CAPACITY (today) ========\n");
    await run("DD attacks", ["DD"], null);
    await run("DD + RU attack", ["DD", "RU"], null);

    console.log("\n\n======== WITH A FRONT CAPACITY ========");
    console.log("capacity is a combat-value budget shared by the whole side.\n");
    for (const cap of [1200, 900, 700, 550, 400]) {
      console.log(`-- capacity ${cap} cv --`);
      await run(`  DD attacks`, ["DD"], cap);
      await run(`  DD + RU attack`, ["DD", "RU"], cap);
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
