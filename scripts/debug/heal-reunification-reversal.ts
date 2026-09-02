/**
 * Move the unified German state back onto the GDR's shell.
 *
 * WHY THIS EXISTS. The live world ran `mergeCountry(DD -> DE)` at turn 545, so
 * the Federal Republic is the surviving shell and the GDR is dissolved and empty.
 * That is the wrong way round: the GDR won the German Question. Everything under
 * DE moves back onto DD and DE is retired.
 *
 * WHY IT IS NOT A MERGE. Running the merge the other way would treat this as a
 * fresh absorption: `reserveSequentialIds` would renumber all eleven parties (the
 * SED would stop being #7 while `countryState.rulingPartyId` still said 7), and
 * `mergeNationalFisc` would ADD the Federal Republic's treasury onto a DD book
 * that is not zero. This is a RE-POINT: the same rows, under the other id.
 *
 * WHAT MUST NOT BE TOUCHED — the political settlement, which landed correctly.
 * `governmentType` is `onePartyState`, the Federal Republic's six native parties
 * are `banned`, the GDR's four bloc parties are `approved`, nineteen real players
 * are seated.
 *
 * PARTY NUMBERS GO HOME. The merge renumbered the GDR's five parties out of
 * 1..5 into 7..11; they are restored to the numbers they were founded with,
 * read back off each party's own `mergedFrom.sequentialId` rather than a table
 * typed out here. The Federal Republic's six take the slots after them.
 *
 * ⚠️ THAT IS A PERMUTATION WITH OVERLAPPING RANGES — the SED goes 7 -> 1 while
 * the SPD goes 1 -> 6 — so it CANNOT be applied as a series of updates. Renumber
 * the SED to 1 first and the SPD's own rule then catches it and sends it to 6.
 * Every reference is therefore moved through a disjoint temporary range and back
 * down, so no row is ever eligible for two rules at once.
 *
 * THE COLLECTION LIST IS DISCOVERED, NOT WRITTEN DOWN. A hand-kept list is what
 * stranded rows the first time: an earlier draft of this script named eighteen
 * collections and would have moved 773 of the ~141,000 rows that actually name
 * DE. Every collection is scanned at run time; anything not explicitly classified
 * below is moved. Two lower-cased traps are handled explicitly because a scan for
 * "DE" does not see them: `legislationTypes.countryScope` is `"de"`, and several
 * collections key rows `DE_<something>` rather than carrying a `countryId`.
 *
 * NO MONEY IS REDENOMINATED. DEM and DDM both sit at 4.2, so the scale is 1. The
 * script ASSERTS that rather than assuming it.
 *
 * DRY RUN BY DEFAULT. `--apply` writes. Run `backup-german-shells.ts` first.
 */
import { MongoClient, type Db } from "mongodb";
import { config } from "dotenv";
import { remapOffice } from "@/lib/country/dissolvingOfficeRemap";
import {
  PARTY_REF_COLLECTIONS,
  NON_PARTY_SENTINELS,
} from "@/lib/country/partyMigrationCollections";
import { nationalDebtFromBalance } from "@/lib/budget/treasuryBalance";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const FROM = "DE";
const TO = "DD";

/**
 * Collections this script handles by hand, and must therefore NOT sweep.
 *
 * `countryGameStates` and `countryState` are not moves at all — one shell retires
 * while the other revives. `federalBudget` replaces rather than moves, because DD
 * still holds a zeroed-then-drifted remnant. `exchangeRates` already carries a DD
 * row at the same rate, and moving DE's over it would overwrite a live rate with
 * a dissolving country's copy of the same number. `electedOfficials` moves, but
 * its office keys have to be remapped on the way.
 */
const HANDLED = new Set([
  "countryGameStates",
  "countryState",
  "federalBudget",
  "exchangeRates",
  "electedOfficials",
]);

/**
 * Left where it is, deliberately.
 *
 * `siteTrafficPageviews` is analytics keyed `country`, not gameplay state: those
 * page views genuinely happened against the Federal Republic's pages and
 * rewriting them would falsify a traffic record to no benefit.
 */
const SKIP = new Set(["siteTrafficPageviews"]);

function say(line: string) {
  console.log(line);
}

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(uri, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  const currentTurn = Number(gs?.currentTurn ?? 0);
  say(`${APPLY ? "APPLY" : "DRY RUN"} — ${FROM} -> ${TO} at turn ${currentTurn}\n`);

  const sed = await assertPreconditions(db);
  let total = 0;

  // ── 1. The GDR comes back, the Federal Republic stands down ──────────────
  say("1. shells");
  say(`   ${TO}: enabledForPlayers=true, status=active, dissolvedTurn dropped`);
  say(`   ${FROM}: enabledForPlayers=false, dissolvedTurn=${currentTurn}`);
  if (APPLY) {
    await db.collection("countryGameStates").updateOne({ _id: TO as never }, {
      $set: { enabledForPlayers: true, status: "active", updatedAt: new Date() },
      $unset: { dissolvedTurn: "" },
    } as never);
    await db.collection("countryGameStates").updateOne({ _id: FROM as never }, {
      $set: { enabledForPlayers: false, dissolvedTurn: currentTurn, updatedAt: new Date() },
    } as never);
  }

  // ── 2. Runtime identity ──────────────────────────────────────────────────
  say(`\n2. runtime identity on ${TO}`);
  say(`   onePartyState, rulingPartyId=${sed.sequentialId} (${sed.name}), name "Germany"`);
  if (APPLY) {
    await db.collection("countryState").updateOne({ _id: TO as never }, {
      $set: {
        governmentType: "onePartyState",
        rulingPartyId: sed.sequentialId,
        displayNameOverride: "Germany",
        updatedAt: new Date(),
      },
    } as never);
  }

  // ── 3. Elected offices, remapped on the way across ───────────────────────
  say(`\n3. elected offices through the ${FROM}>${TO} remap`);
  const officeCounts = new Map<string, number>();
  for (const o of await db
    .collection("electedOfficials")
    .find({ countryId: FROM })
    .project({ officeType: 1 })
    .toArray()) {
    const k = String(o.officeType);
    officeCounts.set(k, (officeCounts.get(k) ?? 0) + 1);
  }
  for (const [from, n] of officeCounts) {
    const to = remapOffice(FROM, TO, from);
    say(`   ${from.padEnd(22)} -> ${to ?? "RETIRED"} (${n})`);
    total += n;
    if (APPLY) {
      if (to === null) {
        await db.collection("electedOfficials").deleteMany({ countryId: FROM, officeType: from });
      } else {
        await db
          .collection("electedOfficials")
          .updateMany(
            { countryId: FROM, officeType: from },
            { $set: { countryId: TO, officeType: to, updatedAt: new Date() } }
          );
      }
    }
  }

  // ── 4. Every other country-scoped row, DISCOVERED ────────────────────────
  say(`\n4. countryId ${FROM} -> ${TO} (discovered)`);
  const names = (await db.listCollections().toArray()).map((c) => c.name).sort();
  for (const name of names) {
    if (HANDLED.has(name) || SKIP.has(name)) continue;
    const n = await db
      .collection(name)
      .countDocuments({ countryId: FROM } as never)
      .catch(() => 0);
    if (n === 0) continue;
    const dropped = APPLY ? await dropCollidingRows(db, name) : 0;
    say(`   ${name.padEnd(32)} ${n}${dropped ? `  (${dropped} duplicate(s) dropped)` : ""}`);
    total += n;
    if (APPLY) {
      await db
        .collection(name)
        .updateMany({ countryId: FROM } as never, { $set: { countryId: TO } } as never);
    }
  }

  // ── 5. Rows keyed `DE_<something>` ───────────────────────────────────────
  //     No countryId to flip: the id itself names the country. The LIVE row wins
  //     a key collision, which is the same rule as everywhere else here.
  say(`\n5. re-key \`${FROM}_*\` -> \`${TO}_*\``);
  for (const name of names) {
    if (SKIP.has(name)) continue;
    const rows = await db
      .collection(name)
      .find({ _id: { $regex: `^${FROM}_` } } as never)
      .toArray()
      .catch(() => []);
    if (rows.length === 0) continue;
    say(`   ${name.padEnd(32)} ${rows.length}`);
    total += rows.length;
    if (APPLY) {
      for (const doc of rows) {
        const newId = String(doc._id).replace(`${FROM}_`, `${TO}_`);
        const next: Record<string, unknown> = { ...doc, _id: newId };
        if (next.countryId === FROM) next.countryId = TO;
        // New key first, old key after: a crash between the two leaves a row the
        // re-run absorbs rather than a row that is simply gone.
        await db.collection(name).replaceOne({ _id: newId as never }, next, { upsert: true });
        await db.collection(name).deleteOne({ _id: doc._id });
      }
    }
  }

  // ── 6. Singleton per-country docs keyed `_id: "DE"` ──────────────────────
  say(`\n6. singleton docs \`_id: "${FROM}"\``);
  for (const name of names) {
    if (HANDLED.has(name) || SKIP.has(name)) continue;
    const doc = await db
      .collection(name)
      .findOne({ _id: FROM as never })
      .catch(() => null);
    if (!doc) continue;
    const collides = await db.collection(name).countDocuments({ _id: TO } as never);
    say(`   ${name.padEnd(32)} ${collides ? "replaces DD's stale row" : "moves"}`);
    total += 1;
    if (APPLY) {
      const { _id: _drop, ...rest } = doc as Record<string, unknown>;
      if (rest.countryId === FROM) rest.countryId = TO;
      await db
        .collection(name)
        .replaceOne({ _id: TO as never }, { ...rest, _id: TO }, { upsert: true });
      await db.collection(name).deleteOne({ _id: FROM as never });
    }
  }

  // ── 6b. Stored office pointers, and the General Secretary ────────────────
  //
  //  `electedOfficials.officeType` is remapped in step 3, but `currentOffice` on
  //  a character or an NPP is a STORED denormalisation of the same fact and does
  //  not follow it. Left alone the unified state's deputies go on reading as
  //  Bundestag members and its leader as Chancellor -- an office the GDR does not
  //  have -- in `deriveHighestOffice`, on every profile, and everywhere that
  //  ranks an office off that field.
  //
  //  CHANCELLOR BECOMES GENERAL SECRETARY, which the merge's own table does not
  //  say. That table is for a merge, where the losing head of government stands
  //  down and the office simply ends; this is a re-point of the SAME government
  //  onto the shell it should always have been on, so the executive keeps its
  //  holder and changes its name.
  const OFFICE_POINTERS: Array<[string, string]> = [
    ["bundestag", "volkskammerDeputy"],
    ["landtag", "landAssembly"],
    ["ministerPresident", "governor"],
    ["chancellor", "generalSecretary"],
  ];
  say("\n6b. stored office pointers");
  for (const [from, to] of OFFICE_POINTERS) {
    let n = 0;
    for (const coll of ["characters", "npps"]) {
      n += await db
        .collection(coll)
        .countDocuments({ countryId: TO, "currentOffice.type": from } as never)
        .catch(() => 0);
    }
    const leaders = await db
      .collection("countryLeaderStates")
      .countDocuments({ leaderOfficeType: from } as never)
      .catch(() => 0);
    if (n === 0 && leaders === 0) continue;
    say(
      `   ${from.padEnd(20)} -> ${to.padEnd(20)} ${n} holder(s)${leaders ? `, ${leaders} leader row(s)` : ""}`
    );
    total += n;
    if (APPLY) {
      for (const coll of ["characters", "npps"]) {
        // Filtered on the dotted path EXISTING: a `$set` through a null parent
        // throws, and a character between offices carries a null `currentOffice`.
        await db.collection(coll).updateMany(
          { countryId: TO, "currentOffice.type": from } as never,
          {
            $set: { "currentOffice.type": to },
          } as never
        );
      }
      await db.collection("countryLeaderStates").updateMany(
        { countryId: TO, leaderOfficeType: from } as never,
        {
          $set: { leaderOfficeType: to },
        } as never
      );
    }
  }

  // ── 7. Party numbers go home ─────────────────────────────────────────────
  // EITHER shell: by the time this runs for real the parties are under TO, but a
  // dry run reads a world where step 4 has not moved them yet, and a plan that
  // silently reports "0 changes" because it queried the wrong side is worse than
  // no plan at all.
  const parties = await db
    .collection("politicalParties")
    .find({ countryId: { $in: [FROM, TO] } })
    .project({ sequentialId: 1, name: 1, mergedFrom: 1 })
    .sort({ sequentialId: 1 })
    .toArray();

  // The GDR's own parties know where they came from; the rest are the absorbed
  // Federal Republic's and take the slots after them, in their present order.
  const home = parties
    .filter((p) => (p.mergedFrom as { countryId?: string } | undefined)?.countryId === TO)
    .map((p) => ({
      _id: p._id,
      name: String(p.name),
      from: Number(p.sequentialId),
      to: Number((p.mergedFrom as { sequentialId?: number }).sequentialId),
      native: true,
    }));
  let next = home.length === 0 ? 1 : Math.max(...home.map((h) => h.to)) + 1;
  const absorbed = parties
    .filter((p) => (p.mergedFrom as { countryId?: string } | undefined)?.countryId !== TO)
    .map((p) => ({
      _id: p._id,
      name: String(p.name),
      from: Number(p.sequentialId),
      to: next++,
      native: false,
    }));
  const remap = [...home, ...absorbed].filter((r) => r.from !== r.to);

  say("\n7. party numbers");
  for (const r of [...home, ...absorbed]) {
    say(
      `   #${String(r.from).padEnd(3)} -> #${String(r.to).padEnd(3)} ${r.name}` +
        (r.from === r.to ? "  (unchanged)" : "")
    );
  }
  if (new Set([...home, ...absorbed].map((r) => r.to)).size !== parties.length) {
    throw new Error("party renumber is not a bijection — refusing to write");
  }

  // A range no live sequentialId can occupy, so phase one cannot collide with a
  // number phase two has still to read.
  const TEMP = 1000;
  const refs = [...PARTY_REF_COLLECTIONS];
  if (APPLY && remap.length > 0) {
    for (const phase of [1, 2] as const) {
      for (const r of remap) {
        const oldId = phase === 1 ? String(r.from) : String(r.from + TEMP);
        const newId = phase === 1 ? String(r.from + TEMP) : String(r.to);
        if (NON_PARTY_SENTINELS.has(oldId)) continue;
        for (const ref of refs) {
          await db.collection(ref.collection).updateMany(
            { countryId: { $in: [FROM, TO] }, [ref.field]: oldId } as never,
            {
              $set: { [ref.field]: newId },
            } as never
          );
        }
      }
    }
    // The party documents themselves, plus an honest `mergedFrom`: the GDR's are
    // home and carry no merge stamp, the Federal Republic's are the absorbed side
    // now and carry theirs.
    for (const r of [...home, ...absorbed]) {
      await db.collection("politicalParties").updateOne({ _id: r._id }, {
        $set: {
          sequentialId: r.to,
          updatedAt: new Date(),
          ...(r.native
            ? {}
            : { mergedFrom: { countryId: FROM, sequentialId: r.from, turn: currentTurn } }),
        },
        ...(r.native ? { $unset: { mergedFrom: "" } } : {}),
      } as never);
    }
    // The ruling party's number moved with it.
    const sedNew = [...home, ...absorbed].find((r) => r.from === sed.sequentialId);
    if (sedNew) {
      await db
        .collection("countryState")
        .updateOne({ _id: TO as never }, { $set: { rulingPartyId: sedNew.to } } as never);
    }
  }
  say(
    `   ${remap.length} party number(s) change; ${refs.length} reference collections swept twice`
  );

  // ── 8. The law catalogue, which is lower-cased ───────────────────────────
  //     `rescopeLegislationCatalogue` flipped the GDR's own `dd.*` types to "de"
  //     on the way in. Flipped back, or the unified state legislates in a
  //     catalogue scoped to a country that no longer exists and every region
  //     reads as having no current law.
  const lawScope = await db
    .collection("legislationTypes")
    .countDocuments({ countryScope: FROM.toLowerCase() } as never);
  say(
    `\n8. legislationTypes.countryScope "${FROM.toLowerCase()}" -> "${TO.toLowerCase()}": ${lawScope}`
  );
  total += lawScope;
  if (APPLY) {
    await db.collection("legislationTypes").updateMany(
      { countryScope: FROM.toLowerCase() } as never,
      {
        $set: { countryScope: TO.toLowerCase() },
      } as never
    );
  }

  // ── 9. The books ─────────────────────────────────────────────────────────
  const fromBudget = await db.collection("federalBudget").findOne({ _id: FROM as never });
  const toBudget = await db.collection("federalBudget").findOne({ _id: TO as never });
  say("\n9. federalBudget");
  // The GDR's remnant is ADDED, not dropped. It accrued on a dissolved shell
  // after the merge zeroed it, but it is still the unified state's money -- the
  // same state, under the other id -- and writing it off would quietly destroy
  // it. `debt.principal` is re-derived from the summed balance through the
  // canonical helper rather than carried across from the old book.
  const summed = (fromBudget?.treasuryBalance ?? 0) + (toBudget?.treasuryBalance ?? 0);
  say(`   ${FROM} treasury=${fromBudget?.treasuryBalance}`);
  say(`   ${TO} remnant =${toBudget?.treasuryBalance}  MERGED IN`);
  say(`   unified     =${summed}`);
  if (APPLY && fromBudget) {
    const { _id: _b, mergedInto: _mi, ...carried } = fromBudget as Record<string, unknown>;
    await db.collection("federalBudget").replaceOne(
      { _id: TO as never },
      {
        ...carried,
        _id: TO,
        countryId: TO,
        treasuryBalance: summed,
        debt: {
          ...((carried.debt as Record<string, unknown>) ?? {}),
          principal: nationalDebtFromBalance(summed),
        },
      },
      { upsert: true }
    );
    await db.collection("federalBudget").updateOne({ _id: FROM as never }, {
      $set: {
        treasuryBalance: 0,
        mergedInto: { countryId: TO, turn: currentTurn },
        updatedAt: new Date(),
      },
    } as never);
  }

  // ── 10. The war names its victor ──────────────────────────────────────────
  const war = await db.collection("conflicts").findOne({ _id: "war_us_dd_415" as never });
  say(`\n10. war_us_dd_415 victor ${war?.victor ?? "(unset)"} -> ${TO}`);
  if (APPLY) {
    await db
      .collection("conflicts")
      .updateOne(
        { _id: "war_us_dd_415" as never },
        { $set: { victor: TO, updatedAt: new Date() } }
      );
  }

  say(`\n~${total} rows`);
  say(APPLY ? "APPLIED" : "DRY RUN — nothing written. Re-run with --apply.");
  await client.close();
}

/**
 * Delete the source rows a UNIQUE index would refuse to let across.
 *
 * A country-scoped re-point is a fuse, not a transfer: two states become one, so
 * any unique index containing `countryId` has two rows competing for a single
 * key the moment the second one arrives. `unions` is unique on
 * `{countryId, sectorType}` and both Germanies ran a full set of seventeen sector
 * unions, so the very first blind `updateMany` died on E11000 half way through
 * the sweep — the same collision the region fuse already handles and that this
 * script was written without.
 *
 * WHERE TWO ROWS COLLIDE THE SURVIVOR'S STANDS, which is the rule used everywhere
 * else in this heal and in `mergeRegion`: the GDR is the state that continues, so
 * its own row keeps the key and the Federal Republic's duplicate is dropped. Rows
 * that do NOT collide still cross untouched.
 *
 * PARTIAL indexes are honoured: a row the index does not bind cannot collide, and
 * deleting it would be data loss for a conflict that does not exist.
 */
async function dropCollidingRows(db: Db, collection: string): Promise<number> {
  const coll = db.collection<Record<string, unknown>>(collection);
  let indexes: Array<Record<string, unknown>>;
  try {
    indexes = (await coll.indexes()) as unknown as Array<Record<string, unknown>>;
  } catch {
    return 0;
  }
  const relevant = indexes.filter(
    (ix) => ix.unique === true && (ix.key as Record<string, unknown>)?.countryId
  );
  if (relevant.length === 0) return 0;

  let dropped = 0;
  for (const ix of relevant) {
    const keys = Object.keys(ix.key as Record<string, unknown>);
    const partial = (ix.partialFilterExpression as Record<string, unknown> | undefined) ?? {};
    const others = keys.filter((k) => k !== "countryId");
    // Filter first, scope second: a partial expression often constrains
    // `countryId` itself, and spreading it last would widen this past the shell.
    const rows = await coll.find({ ...partial, countryId: FROM }).toArray();
    for (const row of rows) {
      const wouldBecome: Record<string, unknown> = { ...partial, countryId: TO };
      for (const k of others) wouldBecome[k] = row[k] ?? null;
      if (await coll.findOne(wouldBecome)) {
        await coll.deleteOne({ _id: row._id } as Record<string, unknown>);
        dropped++;
      }
    }
  }
  return dropped;
}

async function assertPreconditions(db: Db): Promise<{ sequentialId: number; name: string }> {
  // RESUMABLE. The first run of this died part way through step 4 on a duplicate
  // key, so "every region still under FROM" is no longer a valid entry condition:
  // a resume legitimately arrives with the regions already moved and the shells
  // already flipped. What must hold is that the regions are all on ONE side.
  const fromRegions = await db.collection("states").countDocuments({ countryId: FROM } as never);
  const toRegions = await db.collection("states").countDocuments({ countryId: TO } as never);
  if (fromRegions > 0 && toRegions > 0) {
    throw new Error(`regions straddle both shells (${FROM}=${fromRegions}, ${TO}=${toRegions})`);
  }
  if (fromRegions === 0 && toRegions === 0) {
    throw new Error("neither shell holds any region");
  }
  say(fromRegions > 0 ? "  fresh run" : "  RESUMING — regions already moved");
  const rates = await db
    .collection("exchangeRates")
    .find({ _id: { $in: [FROM, TO] } as never })
    .toArray();
  const rateOf = (id: string) => rates.find((r) => String(r._id) === id)?.rate;
  if (rateOf(FROM) !== rateOf(TO)) {
    throw new Error(`${FROM}=${rateOf(FROM)} vs ${TO}=${rateOf(TO)}: money would need converting`);
  }
  const sed = await db
    .collection("politicalParties")
    .findOne(
      { countryId: { $in: [FROM, TO] }, regimeStatus: "ruling" },
      { projection: { sequentialId: 1, name: 1 } }
    );
  if (!sed) throw new Error("no ruling party under the surviving shell");
  say(`preconditions OK — ${fromRegions} regions, FX 1:1 at ${rateOf(FROM)}\n`);
  return { sequentialId: Number(sed.sequentialId), name: String(sed.name) };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
