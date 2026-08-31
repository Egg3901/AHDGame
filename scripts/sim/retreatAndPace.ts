/**
 * Retreat frequency and war pace, measured together.
 *
 * Retreat currently fires in ~93% of battles, so `retreatYield` (0.7 ground) and
 * `retreatCasualtyMult` (0.6 casualties) are flat taxes the code calls conditional.
 * Lowering the trigger threshold makes breaking off exceptional again -- but that alone
 * RAISES both ground per battle and casualties, because fewer battles get the dampers.
 * So this sweeps the threshold and then re-lands the pace with maxShift.
 *
 * Runs with the approved front-capacity model applied.
 *
 *   npx tsx scripts/sim/retreatAndPace.ts
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
import { ATTRITION, OCCUPATION } from "@/lib/military/config";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const THEATER = "war_us_dd_415";
const SEEDS = 500;
const CAPACITY = 900;
const num = (x: number) => Math.round(x).toLocaleString("en-US");
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

// `as const` is a type-level assertion, not a runtime freeze, so these are writable.
const A = ATTRITION as unknown as { retreatTrack: number; retreatCasualtyMult: number };
const O = OCCUPATION as unknown as { maxShift: number; retreatYield: number };
const BASE_TRACK = A.retreatTrack;
const BASE_SHIFT = O.maxShift;

const cvOf = (u: MilitaryUnit) => computeEffectivePower(u) * (0.55 + 0.45 * (u.readiness / 100));
const PRIORITY: Record<string, number> = {
  frontline: 0,
  flank: 1,
  support: 2,
  deepstrike: 3,
  reserve: 4,
  rear: 5,
};

function capacityPositions(units: MilitaryUnit[], capacity: number) {
  const ordered = [...units].sort((a, b) => {
    const pa = PRIORITY[recommendRole(a)] ?? 9,
      pb = PRIORITY[recommendRole(b)] ?? 9;
    if (pa !== pb) return pa - pb;
    if (cvOf(b) !== cvOf(a)) return cvOf(b) - cvOf(a);
    return String(a._id) < String(b._id) ? -1 : 1;
  });
  const positions: Record<string, string> = {};
  let used = 0,
    n = 0;
  for (const u of ordered) {
    const cv = cvOf(u);
    if (used + cv <= capacity || n === 0) {
      used += cv;
      n++;
    } else positions[String(u._id)] = "rear";
  }
  return positions;
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

    const capped = async (c: string, s: "A" | "B", sup: number, budget: number) => {
      const base = await buildBattleSide(db, c, by(c), fronts, sup, s);
      return { ...base, positions: { ...base.positions, ...capacityPositions(by(c), budget) } };
    };

    const totalB = cvOf as unknown as never;
    void totalB;
    const ddCv = by("DD").reduce((a, u) => a + cvOf(u), 0);
    const ruCv = by("RU").reduce((a, u) => a + cvOf(u), 0);
    const DD = await capped("DD", "B", conflict.supplyB, CAPACITY);
    const US = await capped("US", "A", conflict.supplyA, CAPACITY);
    const DDc = await capped("DD", "B", conflict.supplyB, (CAPACITY * ddCv) / (ddCv + ruCv));
    const RUc = await capped("RU", "B", conflict.supplyB, (CAPACITY * ruCv) / (ddCv + ruCv));

    function measure(att: BattleSide[], def: BattleSide[]) {
      let retreats = 0,
        w = 0,
        aL = 0,
        dL = 0,
        gain = 0;
      for (let i = 0; i < SEEDS; i++) {
        const r = resolvePvpBattle(att, def, THEATER, i * 7919 + 13);
        if (r.retreat) retreats++;
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
      return {
        retreat: retreats / SEEDS,
        win: w / SEEDS,
        att: aL / SEEDS,
        def: dL / SEEDS,
        net: gain / SEEDS,
      };
    }

    const row = (label: string, m: ReturnType<typeof measure>) => {
      const battles = m.net > 0.001 ? 50 / m.net : Infinity;
      console.log(
        `${label.padEnd(30)} retreat ${pct(m.retreat).padStart(4)}  win ${pct(m.win).padStart(4)}  ` +
          `net ${m.net >= 0 ? "+" : ""}${m.net.toFixed(2).padStart(5)}  ` +
          `att dead ${num(m.att).padStart(6)}  def dead ${num(m.def).padStart(5)}  ` +
          `${Number.isFinite(battles) ? `${battles.toFixed(0)} offensives ~${(battles / 0.4 / 24).toFixed(1)}d` : "no progress"}`
      );
    };

    console.log(
      `capacity ${CAPACITY} cv applied throughout. cadence assumed 0.4 offensives/turn, hourly turns.\n`
    );

    console.log("======== DIAL 1: how rare should breaking off be? ========");
    console.log(`(maxShift held at its current ${BASE_SHIFT})\n`);
    for (const track of [BASE_TRACK, 20, 16, 12, 9, 6]) {
      A.retreatTrack = track;
      console.log(`-- retreatTrack ${track}${track === BASE_TRACK ? "  (today)" : ""} --`);
      row("  DD alone", measure([DD], [US]));
      row("  DD + RU", measure([DDc, RUc], [US]));
    }
    A.retreatTrack = BASE_TRACK;

    console.log("\n\n======== DIAL 2: re-landing the pace at retreatTrack 12 ========");
    console.log("rarer retreat means fewer 0.7 dampers, so ground climbs. Pull maxShift back.\n");
    A.retreatTrack = 12;
    for (const shift of [BASE_SHIFT, 4.5, 4.0, 3.5, 3.0]) {
      O.maxShift = shift;
      console.log(`-- maxShift ${shift}${shift === BASE_SHIFT ? "  (today)" : ""} --`);
      row("  DD alone", measure([DD], [US]));
      row("  DD + RU", measure([DDc, RUc], [US]));
    }
    O.maxShift = BASE_SHIFT;
    A.retreatTrack = BASE_TRACK;

    console.log("\n\n======== REFERENCE: where things stand today ========\n");
    row(
      "  DD alone, no capacity",
      await (async () => {
        const d = await buildBattleSide(db, "DD", by("DD"), fronts, conflict.supplyB, "B");
        const u = await buildBattleSide(db, "US", by("US"), fronts, conflict.supplyA, "A");
        return measure([d], [u]);
      })()
    );
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
