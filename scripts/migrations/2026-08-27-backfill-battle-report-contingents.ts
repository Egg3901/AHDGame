/**
 * Backfill per-nation casualty attribution onto coalition battle reports.
 *
 * THE BUG (fix/war-log-casualty-fix). `PvpBattleResult.attacker`/`.defender` carried
 * ONE country -- the principal -- beside a `loss` summed across every contingent on
 * that side. A coalition offensive therefore filed its allies' dead under the
 * coalition leader's flag: the war log, the front's per-country record and each war
 * room all read the same wrong number.
 *
 * The engine now records `contingents` on every side of every new report. This script
 * reconstructs them for reports written BEFORE that, by joining each `unitResult.id`
 * back to `militaryUnits` to recover the country that owned the formation.
 *
 * Verified against live on 2026-08-27 (turn 420): exactly one affected report,
 *   6a8fb6a1715ff52ed01059ce  T420  war_us_dd_415  attackers [DD, RU] -> [US]
 *   attacker.country=DD  attacker.loss=16299   ->   DD 5,360 + RU 10,939
 *   defender.country=US  defender.loss=2313    ->   US 2,313
 *
 * Only reports with two or more countries on a side are touched. A bilateral report
 * needs nothing: its single country genuinely owns the side's whole loss, and
 * `contingentsOf` derives that from the scalar at read time.
 *
 * `power` is NOT recoverable per contingent -- it was never recorded, and the combat
 * mass the engine apportions it from is not reconstructible from a written report. Each
 * contingent is therefore given the side's power in proportion to its share of the
 * side's casualties, and flagged `powerEstimated: true` so no reader mistakes it for a
 * measurement. Casualties, which is what every reader actually quotes, are exact.
 *
 * A unit that has since been disbanded leaves its result unattributable. Rather than
 * guess, such a report is SKIPPED entirely and reported -- a partial split would put a
 * wrong number on the record with no way to tell it apart from a right one.
 *
 * Usage
 * -----
 *   npx tsx scripts/migrations/2026-08-27-backfill-battle-report-contingents.ts          # dry-run
 *   npx tsx scripts/migrations/2026-08-27-backfill-battle-report-contingents.ts --apply  # commit
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

let uri = process.env.MONGODB_URI_LIVE;
if (!uri) throw new Error("MONGODB_URI_LIVE must be set in .env.local");
// The live deployment is a single-node replica set whose advertised host is not
// resolvable from outside; without this the driver rediscovers `localhost` and hangs.
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const APPLY = process.argv.includes("--apply");

interface UnitResultDoc {
  id: string;
  casualties: number;
  country?: string;
}
interface SideDoc {
  country: string;
  power: number;
  loss: number;
  unitResults: UnitResultDoc[];
  contingents?: { country: string; power: number; loss: number }[];
}
interface Contingent {
  country: string;
  power: number;
  loss: number;
  powerEstimated: true;
}

/** Per-country split of one side, or null when the side cannot be attributed exactly. */
function splitSide(
  side: SideDoc,
  ownerOf: Map<string, string>,
  roster: string[]
): Contingent[] | null {
  const loss = new Map<string, number>();
  for (const u of side.unitResults ?? []) {
    // `country` is present on reports written after the engine fix; the join is only
    // needed for the ones written before it.
    const owner = u.country ?? ownerOf.get(String(u.id));
    if (!owner) return null;
    loss.set(owner, (loss.get(owner) ?? 0) + (u.casualties ?? 0));
  }
  const total = [...loss.values()].reduce((a, n) => a + n, 0);
  // Order by the report's own roster so the principal leads, exactly as the engine
  // writes it; any country not on the roster follows in a stable order.
  const seen = [...loss.keys()];
  const ordered = [
    ...roster.filter((c) => loss.has(c)),
    ...seen.filter((c) => !roster.includes(c)).sort(),
  ];
  const out: Contingent[] = ordered.map((country) => ({
    country,
    power: total > 0 ? Math.round((side.power * (loss.get(country) ?? 0)) / total) : 0,
    loss: loss.get(country) ?? 0,
    powerEstimated: true,
  }));
  // The parts must be the whole, or this is not a split.
  const sum = out.reduce((a, c) => a + c.loss, 0);
  if (sum !== side.loss) {
    console.log(`    ! casualties do not reconcile: parts ${sum} vs side loss ${side.loss}`);
    return null;
  }
  return out;
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  try {
    const db = client.db();
    const reports = db.collection("battleReports");
    const units = db.collection("militaryUnits");

    const gs = await db.collection("gameState").findOne({ _id: "current" as never });
    console.log(`turn ${gs?.currentTurn ?? "?"} -- ${APPLY ? "APPLY" : "DRY RUN"}\n`);

    const candidates = await reports
      .find({
        result: { $ne: null },
        $or: [{ "attackers.1": { $exists: true } }, { "defenders.1": { $exists: true } }],
      })
      .sort({ turn: 1 })
      .toArray();

    console.log(`${candidates.length} coalition report(s) on file\n`);

    let written = 0;
    let skipped = 0;
    let alreadyDone = 0;

    for (const r of candidates) {
      const res = r.result as { attacker: SideDoc; defender: SideDoc };
      const label = `T${r.turn} ${String(r._id)} ${r.theaterId}`;

      if (res.attacker?.contingents?.length && res.defender?.contingents?.length) {
        alreadyDone++;
        console.log(`${label}: already attributed -- skipping`);
        continue;
      }

      const ids = [...(res.attacker?.unitResults ?? []), ...(res.defender?.unitResults ?? [])]
        .map((u) => u.id)
        .filter(Boolean);
      const objIds = ids
        .map((i) => {
          try {
            return new ObjectId(i);
          } catch {
            return null;
          }
        })
        .filter((x): x is ObjectId => x !== null);
      const owners = await units
        .find({ _id: { $in: objIds } }, { projection: { countryId: 1 } })
        .toArray();
      const ownerOf = new Map(owners.map((u) => [String(u._id), String(u.countryId)]));

      const attackers = (r.attackers as string[]) ?? [r.declarerCountry as string];
      const defenders = (r.defenders as string[]) ?? [r.targetCountry as string];
      const att = splitSide(res.attacker, ownerOf, attackers);
      const def = splitSide(res.defender, ownerOf, defenders);

      if (!att || !def) {
        skipped++;
        const missing = ids.filter((i) => !ownerOf.has(i)).length;
        console.log(`${label}: SKIPPED -- ${missing} formation(s) no longer on file`);
        continue;
      }

      const fmt = (cs: Contingent[]) =>
        cs.map((c) => `${c.country} ${c.loss.toLocaleString("en-US")}`).join(" + ");
      console.log(`${label}`);
      console.log(`    attacker  ${res.attacker.country} ${res.attacker.loss} -> ${fmt(att)}`);
      console.log(`    defender  ${res.defender.country} ${res.defender.loss} -> ${fmt(def)}`);

      if (APPLY) {
        await reports.updateOne(
          { _id: r._id },
          { $set: { "result.attacker.contingents": att, "result.defender.contingents": def } }
        );
        written++;
      }
    }

    const pending = candidates.length - skipped - alreadyDone;
    console.log(
      `\n${APPLY ? "written" : "would write"}: ${APPLY ? written : pending}` +
        ` · skipped: ${skipped} · already attributed: ${alreadyDone}`
    );
    if (!APPLY) console.log("\nDry run -- re-run with --apply to commit.");
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
