/**
 * Heal: pull stale "elected" / "lost_election" careerHistory entries left
 * behind by the recalibrate-timers Step 0 bug (commit 88017cd3, fixed in
 * 45c51090).
 *
 * Background: when Step 0 reactivated a prematurely-completed election back
 * to status="active", it did not undo resolution side-effects. The companion
 * heal `healRecalibrateWithdrawals.ts` restores withdrawn candidacies and
 * vacates prematurely-elected seats for *bug_recalibrate* cases. It has
 * two gaps this heal closes:
 *
 *   1. DOUBLE-ACTIVE players (re-entered the same election post-bug) were
 *      skipped entirely — so their stale career event was never pulled.
 *   2. Cases where the officeholder row was re-seated by a later turn
 *      (officeholder.electedAt no longer matches withdrawnAt ±2s) fell into
 *      the "other" bucket, which only restores the candidacy but never
 *      vacates the prematurely-elected seat or pulls the career event.
 *
 * This heal is surgical: it looks for characters who CURRENTLY have no seat
 * (currentOffice=null AND no electedOfficials row for that office) but still
 * carry a careerHistory "elected" event whose electionId points to an
 * election that is NOT resolved (i.e. still active/upcoming/completed). If
 * the event is genuine, the character would still be seated — so the event
 * is demonstrably stale.
 *
 * Defaults to DRY RUN. Pass `--apply` to write.
 *
 * Targets MONGODB_URI_LIVE by default. Pass `--db=test` or `--db=local` to
 * target a different URI.
 */

import { MongoClient, ObjectId, type Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), "../../.env.local") });

interface CareerEvent {
  type: string;
  office?: {
    type: string;
    state?: string;
    senateClass?: number;
    chamberClass?: number;
  };
  officeLabel?: string;
  date: Date | string;
  electionId?: string;
  party?: string;
}

interface Character {
  _id: ObjectId;
  name: string;
  party?: string;
  countryId?: string;
  currentOffice?: {
    type: string;
    state?: string;
    senateClass?: number;
    chamberClass?: number;
  } | null;
  careerHistory?: CareerEvent[];
}

interface Election {
  _id: ObjectId;
  countryId?: string;
  electionType: string;
  state?: string;
  status: string;
  senateClass?: number;
  chamberClass?: number;
  cycle?: number;
}

interface Official {
  _id: ObjectId;
  officeType: string;
  state?: string;
  senateClass?: number;
  chamberClass?: number;
  characterId?: ObjectId | null;
}

function pickUri(): string {
  const dbArg = process.argv.find((a) => a.startsWith("--db="))?.slice(5) ?? "live";
  const key =
    dbArg === "live" ? "MONGODB_URI_LIVE" : dbArg === "test" ? "MONGODB_URI_TEST" : "MONGODB_URI";
  const uri = process.env[key];
  if (!uri) throw new Error(`${key} not set`);
  return uri;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const uri = pickUri();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided") as Db;

  console.log(`Mode: ${apply ? "APPLY (writing changes)" : "DRY RUN (no changes)"}`);
  console.log(`Connected.\n`);

  // ── 1. Find all characters with at least one "elected" career event but no current seat ──
  const candidates = await db
    .collection<Character>("characters")
    .find({
      "careerHistory.type": "elected",
      currentOffice: null,
    })
    .project<Character>({
      _id: 1,
      name: 1,
      party: 1,
      countryId: 1,
      currentOffice: 1,
      careerHistory: 1,
    })
    .toArray();

  if (candidates.length === 0) {
    console.log("No characters with elected-career + null currentOffice. Nothing to do.");
    await client.close();
    return;
  }

  // ── 2. Filter out characters who are still seated somewhere via electedOfficials ──
  const allCharIds = candidates.map((c) => c._id);
  const officialsForChars = await db
    .collection<Official>("electedOfficials")
    .find({ characterId: { $in: allCharIds } })
    .toArray();
  const seatedCharIds = new Set(
    officialsForChars
      .filter((o) => o.characterId)
      .map((o) => (o.characterId as ObjectId).toString())
  );

  const ghostChars = candidates.filter((c) => !seatedCharIds.has(c._id.toString()));
  console.log(`Ghost characters (elected career event but no seat): ${ghostChars.length}`);

  if (ghostChars.length === 0) {
    await client.close();
    return;
  }

  // ── 3. Collect the electionIds referenced by their "elected" / "lost_election" events ──
  const electionIdStrings = new Set<string>();
  for (const c of ghostChars) {
    for (const ev of c.careerHistory ?? []) {
      if (ev.type !== "elected" && ev.type !== "lost_election") continue;
      if (ev.electionId) electionIdStrings.add(ev.electionId);
    }
  }

  const electionObjectIds: ObjectId[] = [];
  for (const s of electionIdStrings) {
    try {
      electionObjectIds.push(new ObjectId(s));
    } catch {
      /* ignore malformed */
    }
  }

  const elections = await db
    .collection<Election>("elections")
    .find({ _id: { $in: electionObjectIds } })
    .toArray();
  const electionById = new Map(elections.map((e) => [e._id.toString(), e]));

  // ── 4. Decide which career events are genuinely stale ──
  //    Stale = electionId resolves to an election that is NOT in a terminal state
  //            (active/upcoming means resolution hasn't actually occurred), OR
  //            the election no longer exists, AND the character has no seat for
  //            the office/state the event claims.
  const STALE_STATUSES = new Set(["active", "upcoming", "completed"]);

  type Pull = {
    char: Character;
    event: CareerEvent;
    reason: string;
    election: Election | undefined;
  };
  const pulls: Pull[] = [];

  for (const c of ghostChars) {
    const events = c.careerHistory ?? [];
    for (const ev of events) {
      if (ev.type !== "elected" && ev.type !== "lost_election") continue;
      if (!ev.electionId) continue;
      const election = electionById.get(ev.electionId);
      if (!election) {
        pulls.push({ char: c, event: ev, reason: "election_missing", election });
        continue;
      }
      if (STALE_STATUSES.has(election.status)) {
        // Double-check the character truly holds no matching seat — if the
        // event is for sangiin KNS class-2, confirm no electedOfficials row
        // for that specific office/state/class references this character.
        const office = ev.office;
        if (office) {
          const match = officialsForChars.find(
            (o) =>
              o.characterId &&
              (o.characterId as ObjectId).equals(c._id) &&
              o.officeType === office.type &&
              (office.state == null || o.state === office.state) &&
              (office.senateClass == null || o.senateClass === office.senateClass) &&
              (office.chamberClass == null || o.chamberClass === office.chamberClass)
          );
          if (match) continue; // actually still seated for this event — not stale
        }
        pulls.push({ char: c, event: ev, reason: `election_${election.status}`, election });
      }
    }
  }

  console.log(`\nStale events to pull: ${pulls.length}`);
  if (pulls.length === 0) {
    await client.close();
    return;
  }

  const reasonCounts = new Map<string, number>();
  for (const p of pulls) reasonCounts.set(p.reason, (reasonCounts.get(p.reason) ?? 0) + 1);
  console.log("By reason:");
  for (const [k, v] of [...reasonCounts.entries()].sort()) console.log(`  ${k}: ${v}`);

  console.log("\nDetail:");
  for (const p of pulls) {
    const eDate =
      typeof p.event.date === "string" ? p.event.date : new Date(p.event.date).toISOString();
    console.log(
      `  ${p.char.name} (${p.char.countryId ?? "?"}) | ${p.event.type} | "${p.event.officeLabel ?? "?"}" | date=${eDate} | electionId=${p.event.electionId} | reason=${p.reason}`
    );
  }

  if (!apply) {
    console.log("\nDRY RUN — no changes made. Re-run with --apply to write.");
    await client.close();
    return;
  }

  // ── 5. Apply — $pull each matched event by exact (electionId, type, date) ──
  console.log("\nApplying changes…");
  let pulled = 0;
  for (const p of pulls) {
    const ts = p.event.date instanceof Date ? p.event.date : new Date(p.event.date);
    const res = await db.collection("characters").updateOne(
      { _id: p.char._id },
      {
        $pull: {
          careerHistory: {
            type: p.event.type,
            electionId: p.event.electionId,
            date: ts,
          },
        } as never,
      }
    );
    if (res.modifiedCount > 0) {
      pulled++;
      console.log(`  pulled: ${p.char.name} / ${p.event.officeLabel}`);
    } else {
      console.log(
        `  NOT pulled (no exact match): ${p.char.name} / ${p.event.officeLabel} — check date format`
      );
    }
  }

  console.log(`\nDone. Pulled ${pulled} stale career events.`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
