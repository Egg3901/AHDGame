/**
 * Verify naval reach as SHIPPED, against the live force as it stands.
 *
 * `navalReachOptions.ts` simulated the rule by scaling `basePower` before the engine
 * had it. Now that the engine applies `navalReach` itself, that harness double-applies
 * and cannot be read as a before/after. This measures the real thing: the same live
 * formations, resolved once with reach active and once with it neutralised to 1.0.
 *
 * `NAVAL_REACH` is `as const`, which is a type-level assertion and not a runtime
 * freeze, so the neutral pass is a genuine A/B on one force rather than a comparison
 * across two different worlds.
 *
 *   npx tsx scripts/sim/navalReachVerify.ts
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
import { deriveSeaAccess } from "@/lib/military/seaAccess";
import { hostEntitiesOf } from "@/lib/military/hostEntities";
import { computeCard } from "@/lib/military/combat";
import { NAVAL_REACH } from "@/lib/military/config";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const THEATER = "war_us_dd_415";
const SEEDS = 400;
const num = (x: number) => Math.round(x).toLocaleString("en-US");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

type Band = { carrier: number; escort: number };
const R = NAVAL_REACH as unknown as { coastal: Band; inland: Band };
const REAL = { coastal: { ...R.coastal }, inland: { ...R.inland } };
const neutralise = () => {
  R.coastal = { carrier: 1, escort: 1 };
  R.inland = { carrier: 1, escort: 1 };
};
const restore = () => {
  R.coastal = { ...REAL.coastal };
  R.inland = { ...REAL.inland };
};

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db() as unknown as Db;
    const conflict = (await db
      .collection("conflicts")
      .findOne({ _id: THEATER as never })) as unknown as ConflictDoc;
    const front = conflictToFront(conflict);
    const all = (await db
      .collection("militaryUnits")
      .find({ theaterId: THEATER })
      .toArray()) as unknown as MilitaryUnit[];
    const by = (c: string) => all.filter((u) => String(u.countryId) === c);

    console.log("======== SEA ACCESS AS THE ENGINE NOW RESOLVES IT ========");
    console.log(`conflict.seaAccess stored: ${conflict.seaAccess ?? "(absent, derived)"}`);
    console.log(
      `hostEntities: ${JSON.stringify(hostEntitiesOf(conflict))}  terrain: "${conflict.terrain}"`
    );
    console.log(`derived: ${deriveSeaAccess(hostEntitiesOf(conflict), conflict.terrain)}`);
    console.log(`front.seaAccess: ${front.seaAccess}`);
    if (front.seaAccess !== true) {
      console.log("\n!! EXPECTED COASTAL. DD and DE both hold naval branches.");
    }

    console.log("\n======== NAVAL FORMATIONS AT THIS FRONT ========");
    for (const c of ["US", "DD", "RU"]) {
      for (const u of by(c).filter((x) => x.domain === "naval")) {
        const carrier = computeCard(u).traitKeys.includes("strategic");
        const reach = front.seaAccess
          ? carrier
            ? REAL.coastal.carrier
            : REAL.coastal.escort
          : carrier
            ? REAL.inland.carrier
            : REAL.inland.escort;
        console.log(
          `  ${c} ${(carrier ? "CARRIER" : "escort ").padEnd(8)} ${u.type.padEnd(26)} ` +
            `${String(u.personnel).padStart(6)} men  reach ${reach.toFixed(2)}`
        );
      }
    }

    const mk = async (c: string, s: "A" | "B", sup: number) =>
      buildBattleSide(db, c, by(c), { [THEATER]: front }, sup, s);

    async function measure(label: string) {
      const US = await mk("US", "A", conflict.supplyA);
      const DD = await mk("DD", "B", conflict.supplyB);
      const fc = battleForecast([DD], [US], THEATER);
      let w = 0;
      let ddDead = 0;
      let usDead = 0;
      for (let i = 0; i < SEEDS; i++) {
        const r = resolvePvpBattle([DD], [US], THEATER, i * 7919 + 13);
        if (r.win) w++;
        ddDead += r.attacker.loss;
        usDead += r.defender.loss;
      }
      console.log(
        `${label.padEnd(26)} US power ${num(fc.defStr).padStart(6)}  DD power ${num(fc.attStr).padStart(6)}  ` +
          `DD odds ${String(fc.oddsPct).padStart(3)}%  DD win ${pct(w / SEEDS).padStart(6)}  ` +
          `DD dead ${num(ddDead / SEEDS).padStart(6)}  US dead ${num(usDead / SEEDS).padStart(6)}`
      );
      return fc.defStr;
    }

    console.log("\n======== A/B ON THE SAME FORCE ========\n");
    neutralise();
    const before = await measure("reach neutralised (old)");
    restore();
    const after = await measure("reach as shipped");
    console.log(
      `\nUS defensive power ${num(before)} -> ${num(after)} ` +
        `(${pct(after / before - 1)}), the fleet's contribution cut by ${num(before - after)}.`
    );
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
