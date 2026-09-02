/**
 * Ticket #1256 — "Party org has 2 value".
 *
 * `statePartyOrg._id` is the composite `${stateId}_${partySequentialId}`
 * (`getStatePartyOrgDocumentId`). A Mongo `_id` is IMMUTABLE, so when the
 * reunification renumbered the absorbed country's parties and fused East Berlin
 * into Berlin, both remaps updated the `stateId`/`partyId` FIELDS and left every
 * `_id` frozen with the old values.
 *
 * The two halves of the app then disagreed, because they key differently:
 *   - the region's party list reads by FIELD (`partyId`), and was right;
 *   - the state-party page reads by `_id` (`findOne({_id: state_party}))`, and
 *     so returned a DIFFERENT party's document.
 *
 * On Nordrhein-Westfalen the SED's row is `_id: NW_7` while `_id: NW_1` holds
 * the SPD's. Opening the SED page looked up NW_1 and rendered the SPD's Org, and
 * building Org for one party moved the number displayed for the other — which is
 * exactly what the reporter described.
 *
 * RE-KEYED IN TWO PHASES, because the mismatches are a PERMUTATION: NW_1 must
 * become NW_6 while NW_7 must become NW_1, so a direct pass collides on an id
 * the same run is about to vacate. Everything moves to a temporary id first,
 * then to its final one. (Same shape as the party renumber that caused this.)
 *
 * A re-key is delete + insert, since `_id` cannot be updated. Every other field
 * is carried across verbatim.
 *
 * DRY RUN BY DEFAULT. `--apply` writes. `--all` includes countries other than DD.
 */
import { MongoClient } from "mongodb";
import { config } from "dotenv";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");
const ONLY_COUNTRY = "DD";

interface Row {
  _id: string;
  stateId?: string;
  partyId?: string | number;
  countryId?: string;
  organization?: number;
  [k: string]: unknown;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI_LIVE!, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  if (APPLY && gs?.processingStartedAt) {
    throw new Error(`turn ${gs.currentTurn} is PROCESSING — refusing to write mid-turn`);
  }
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — turn ${gs?.currentTurn}\n`);

  const coll = db.collection<Row>("statePartyOrg");
  const all = (await coll.find({}).toArray()) as Row[];
  const present = new Set(all.map((r) => String(r._id)));

  const expectedId = (r: Row) => `${r.stateId}_${r.partyId}`;
  const mismatched = all.filter((r) => String(r._id) !== expectedId(r));

  const byCountry = new Map<string, number>();
  for (const r of mismatched) {
    const k = String(r.countryId ?? "?");
    byCountry.set(k, (byCountry.get(k) ?? 0) + 1);
  }
  console.log(`rows: ${all.length}   mis-keyed: ${mismatched.length}`);
  console.log("  by country: " + [...byCountry.entries()].map(([k, v]) => `${k}:${v}`).join("  "));

  const targets = ALL ? mismatched : mismatched.filter((r) => r.countryId === ONLY_COUNTRY);
  console.log(
    `\nre-keying ${targets.length} row(s)${ALL ? " (ALL countries)" : ` (${ONLY_COUNTRY} only; pass --all for the rest)`}\n`
  );

  // A target id is safe when it is free, or occupied by a row this run is also
  // moving away. Anything else is a real collision and must not be overwritten.
  const movingFrom = new Set(targets.map((r) => String(r._id)));
  const blocked: string[] = [];
  const wanted = new Map<string, string>();
  for (const r of targets) {
    const want = expectedId(r);
    if (wanted.has(want)) {
      blocked.push(`${want} claimed by both ${wanted.get(want)} and ${String(r._id)}`);
      continue;
    }
    wanted.set(want, String(r._id));
    if (present.has(want) && !movingFrom.has(want)) {
      blocked.push(`${want} is held by a row that is NOT moving`);
    }
  }
  if (blocked.length > 0) {
    console.log("REFUSING — unresolvable collisions:");
    for (const b of blocked) console.log(`  ${b}`);
    await client.close();
    return;
  }

  for (const r of targets) {
    console.log(
      `  ${String(r._id).padEnd(12)} -> ${expectedId(r).padEnd(12)} org=${Number(r.organization ?? 0).toFixed(1)} (${r.countryId})`
    );
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written.");
    await client.close();
    return;
  }

  // Phase 1: park every row under a temporary id.
  const parked: Array<{ tempId: string; finalId: string; doc: Row }> = [];
  for (const r of targets) {
    const tempId = `__rekey__${String(r._id)}`;
    const { _id, ...rest } = r;
    await coll.insertOne({ _id: tempId, ...rest } as Row);
    await coll.deleteOne({ _id: String(_id) } as never);
    parked.push({ tempId, finalId: expectedId(r), doc: r });
  }
  console.log(`\nphase 1: parked ${parked.length}`);

  // Phase 2: land them on their real ids, now that every old id is vacated.
  for (const p of parked) {
    const { _id, ...rest } = p.doc;
    void _id;
    await coll.insertOne({ _id: p.finalId, ...rest } as Row);
    await coll.deleteOne({ _id: p.tempId } as never);
  }
  console.log(`phase 2: landed ${parked.length}`);

  const after = (await coll.find({}).toArray()) as Row[];
  const stillBad = after.filter((r) => String(r._id) !== expectedId(r));
  const strays = after.filter((r) => String(r._id).startsWith("__rekey__"));
  console.log(
    `\nafter: rows=${after.length} mis-keyed=${stillBad.length} temp-strays=${strays.length}`
  );
  console.log("APPLIED");

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
