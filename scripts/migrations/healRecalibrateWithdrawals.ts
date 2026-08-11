/**
 * Heal: restore candidates withdrawn by the recalibrate-timers Step 0 bug.
 *
 * Background: `POST /api/admin/elections/recalibrate-timers` Step 0
 * (added in commit 88017cd3) reactivates `completed`/`resolved` elections
 * whose canonical endTurn is still in the future. It does this by setting
 * `status: "active"` on the election doc — but it does NOT undo the
 * resolution side-effects:
 *   - candidates were marked `withdrawn` by generalResolution.ts:858
 *   - the winner was seated in `electedOfficials` and their `currentOffice`
 *   - the winner got a `careerHistory: { type: "elected" }` entry
 *   - the runners-up got `careerHistory: { type: "lost_election" }` entries
 *
 * After Step 0 reactivates, the election appears active again with all
 * candidates removed and a stale officeholder seated. Players see their
 * candidacy as "withdrawn" in an "active" primary they should still be in.
 *
 * Heal scope (per design discussion 2026-04-19):
 *   - Restore only candidates whose withdrawal cannot be explained by a
 *     legit trigger (party switch, relocation, voluntary withdraw, primary
 *     loss). That covers the bug_recalibrate + "other" buckets.
 *   - SKIP candidates who already have another active candidacy in the same
 *     election (DOUBLE-ACTIVE) — restoring would violate the one-active-
 *     per-election invariant. DOUBLE-ACTIVE cases still get their stale
 *     careerHistory entry pulled if the event's date matches the original
 *     withdrawal instant (same bug signature) — the candidacy itself is left
 *     alone because the re-entry supersedes it.
 *   - For each restoration, also vacate the prematurely-elected officeholder
 *     for the same seat (clear `electedOfficials`, `character.currentOffice`,
 *     and the matching `careerHistory` "elected"/"lost_election" entries).
 *   - Re-add the candidate to the vote tally (totalVotes/candidateNames/
 *     candidateParties) so vote accumulation includes them on the next turn.
 *
 * Defaults to DRY RUN. Pass `--apply` to write changes.
 *
 * Targets MONGODB_URI_LIVE by default. Pass `--db=test` to use MONGODB_URI_TEST
 * or `--db=local` for MONGODB_URI.
 */

import { MongoClient, ObjectId, type Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

// Load env from worktree first, then repo root, so this script works in either layout.
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), "../../.env.local") });

interface Candidate {
  _id: ObjectId;
  electionId: ObjectId;
  characterId?: ObjectId;
  characterName: string;
  party: string;
  status: string;
  isNPP?: boolean;
  enteredAt?: Date;
  withdrawnAt?: Date;
}
interface Election {
  _id: ObjectId;
  countryId: string;
  electionType: string;
  state?: string;
  status: string;
  cycle?: number;
  senateClass?: number;
  chamberClass?: number;
  primaryEndTime?: Date;
  endTime?: Date;
  startTime?: Date;
}
interface Character {
  _id: ObjectId;
  name: string;
  party: string;
  countryId?: string;
  currentOffice?: { type: string; state?: string; senateClass?: number } | null;
  careerHistory?: {
    type: string;
    date: Date;
    party?: string;
    electionId?: string;
    officeLabel?: string;
  }[];
}
interface Official {
  _id: string;
  officeType: string;
  state?: string;
  senateClass?: number;
  // JP Sangiin uses `chamberClass` for stagger, not `senateClass` — both must
  // be in the seat key or two staggered classes in the same state collide.
  chamberClass?: number;
  characterId?: ObjectId | null;
  characterName?: string | null;
  party?: string | null;
  electedAt?: Date | null;
}

function pickUri(): string {
  const dbArg = process.argv.find((a) => a.startsWith("--db="))?.slice(5) ?? "live";
  const key =
    dbArg === "live" ? "MONGODB_URI_LIVE" : dbArg === "test" ? "MONGODB_URI_TEST" : "MONGODB_URI";
  const uri = process.env[key];
  if (!uri) throw new Error(`${key} not set`);
  return uri;
}

function seatKey(
  officeType: string,
  state: string | undefined,
  senateClass?: number,
  chamberClass?: number
) {
  return `${officeType}|${state ?? ""}|${senateClass ?? ""}|${chamberClass ?? ""}`;
}

function withinSeconds(a: Date, b: Date, sec: number): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= sec * 1000;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const uri = pickUri();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided") as Db;

  console.log(`Mode: ${apply ? "APPLY (writing changes)" : "DRY RUN (no changes)"}`);
  console.log(`Connected.`);

  // ── Load all unresolved elections + their withdrawn player candidates ──
  const unresolved = await db
    .collection<Election>("elections")
    .find({ status: { $in: ["upcoming", "active", "completed"] } })
    .toArray();
  const electionMap = new Map(unresolved.map((e) => [e._id.toString(), e]));
  const electionIds = unresolved.map((e) => e._id);

  const withdrawn = await db
    .collection<Candidate>("electionCandidates")
    .find({
      electionId: { $in: electionIds },
      status: "withdrawn",
      $or: [{ isNPP: { $ne: true } }, { isNPP: { $exists: false } }],
      characterId: { $exists: true },
    })
    .toArray();

  // ── Pre-load characters, sitting officials, double-active sets ──
  const charIds = [...new Set(withdrawn.map((c) => c.characterId!.toString()))].map(
    (s) => new ObjectId(s)
  );
  const chars = await db
    .collection<Character>("characters")
    .find({ _id: { $in: charIds } })
    .toArray();
  const charMap = new Map(chars.map((c) => [c._id.toString(), c]));

  const activePerChar = await db
    .collection<Candidate>("electionCandidates")
    .find({ characterId: { $in: charIds }, status: "active" })
    .toArray();
  const alreadyActiveInElection = new Set<string>();
  for (const c of activePerChar) {
    if (c.characterId) {
      alreadyActiveInElection.add(`${c.characterId.toString()}:${c.electionId.toString()}`);
    }
  }

  const officials = await db
    .collection<Official>("electedOfficials")
    .find({ characterId: { $ne: null } })
    .toArray();
  const officialBySeat = new Map<string, Official>();
  for (const o of officials) {
    officialBySeat.set(seatKey(o.officeType, o.state, o.senateClass, o.chamberClass), o);
  }

  // Cohort sizes (used to identify voluntary off-cron withdrawals)
  const cohortByTs = new Map<string, number>();
  for (const c of withdrawn) {
    const k = c.withdrawnAt!.toISOString();
    cohortByTs.set(k, (cohortByTs.get(k) ?? 0) + 1);
  }

  // ── Classify ──
  type Decision =
    | {
        restore: true;
        reason: "bug_recalibrate" | "other";
        cand: Candidate;
        election: Election;
        char: Character;
      }
    | { restore: false; reason: string; cand: Candidate; election: Election; char: Character };
  const decisions: Decision[] = [];

  // Stale careerHistory entries to pull for DOUBLE-ACTIVE characters (they
  // re-entered, so candidacy restore is skipped — but the event from the
  // premature resolution still needs to be cleaned up).
  type StaleCareerPull = {
    char: Character;
    election: Election;
    eventType: "elected" | "lost_election";
    eventDate: Date;
    officeLabel?: string;
  };
  const staleCareerPullsForDoubleActive: StaleCareerPull[] = [];

  for (const cand of withdrawn) {
    const election = electionMap.get(cand.electionId.toString())!;
    const char = charMap.get(cand.characterId!.toString());
    if (!char) {
      decisions.push({
        restore: false,
        reason: "skip_no_character",
        cand,
        election: election!,
        char: { _id: cand.characterId!, name: cand.characterName, party: "" },
      });
      continue;
    }
    const ts = cand.withdrawnAt!;
    const career = char.careerHistory ?? [];

    // Skip — DOUBLE-ACTIVE: restoring would create two active rows for same character/election.
    // But still collect stale careerHistory events whose date matches the
    // withdrawal instant (±2s) — those are the bug's resolution side-effect
    // and should be pulled even though the candidacy isn't restored.
    if (
      alreadyActiveInElection.has(`${cand.characterId!.toString()}:${cand.electionId.toString()}`)
    ) {
      for (const ev of career) {
        if (ev.type !== "elected" && ev.type !== "lost_election") continue;
        if (ev.electionId !== cand.electionId.toString()) continue;
        if (!withinSeconds(new Date(ev.date), ts, 2)) continue;
        staleCareerPullsForDoubleActive.push({
          char,
          election,
          eventType: ev.type,
          eventDate: ev.date instanceof Date ? ev.date : new Date(ev.date),
          officeLabel: ev.officeLabel,
        });
      }
      decisions.push({ restore: false, reason: "skip_double_active", cand, election, char });
      continue;
    }

    // Skip — relocation event within ±2s.
    if (career.some((e) => e.type === "relocated" && withinSeconds(new Date(e.date), ts, 2))) {
      decisions.push({ restore: false, reason: "skip_relocation", cand, election, char });
      continue;
    }

    // Skip — primary_loss: withdrawn within the primary-end resolution window.
    if (
      election.primaryEndTime &&
      ts.getTime() >= new Date(election.primaryEndTime).getTime() - 60_000 &&
      ts.getTime() <= new Date(election.primaryEndTime).getTime() + 3600_000
    ) {
      decisions.push({ restore: false, reason: "skip_primary_loss", cand, election, char });
      continue;
    }

    // Skip — party_switch: candidacy's party doesn't match character's current party.
    if (cand.party !== (char.party ?? "independent")) {
      decisions.push({ restore: false, reason: "skip_party_switch", cand, election, char });
      continue;
    }

    // Skip — voluntary: off-cron timestamp + small cohort = user clicked withdraw.
    const minute = ts.getUTCMinutes();
    const cohort = cohortByTs.get(ts.toISOString()) ?? 1;
    if (minute !== 0 && cohort < 5) {
      decisions.push({ restore: false, reason: "skip_voluntary", cand, election, char });
      continue;
    }

    // Restore. Sub-classify into bug_recalibrate vs "other" for reporting only.
    const officeholder = officialBySeat.get(
      seatKey(election.electionType, election.state, election.senateClass, election.chamberClass)
    );
    const isBugRecalibrate =
      officeholder?.electedAt && withinSeconds(new Date(officeholder.electedAt), ts, 2);
    decisions.push({
      restore: true,
      reason: isBugRecalibrate ? "bug_recalibrate" : "other",
      cand,
      election,
      char,
    });
  }

  // Summary
  const counts = new Map<string, number>();
  for (const d of decisions) counts.set(d.reason, (counts.get(d.reason) ?? 0) + 1);
  console.log(`\n=== Decision summary ===`);
  for (const [k, v] of [...counts.entries()].sort()) console.log(`  ${k}: ${v}`);

  const toRestore = decisions.filter((d): d is Extract<Decision, { restore: true }> => d.restore);
  console.log(`\nWill restore ${toRestore.length} candidacies.`);

  // ── Vacate prematurely-elected officeholders ──
  // Group by (seat, electedAt) — when a seat was prematurely resolved, every
  // candidate's withdrawnAt matches the same officeholder.electedAt instant.
  // We need to vacate that seat exactly once, even if we restore many of its
  // candidates.
  const seatsToVacate = new Map<string, { official: Official; election: Election; ts: Date }>();
  for (const d of toRestore) {
    if (d.reason !== "bug_recalibrate") continue;
    const key = seatKey(
      d.election.electionType,
      d.election.state,
      d.election.senateClass,
      d.election.chamberClass
    );
    const official = officialBySeat.get(key);
    if (!official?.electedAt || !official.characterId) continue;
    if (!withinSeconds(new Date(official.electedAt), d.cand.withdrawnAt!, 2)) continue;
    if (!seatsToVacate.has(key)) {
      seatsToVacate.set(key, { official, election: d.election, ts: new Date(official.electedAt) });
    }
  }
  console.log(`Will vacate ${seatsToVacate.size} prematurely-elected seats.`);
  for (const [k, v] of seatsToVacate) {
    console.log(
      `  ${k}: ${v.official.characterName} (electedAt=${v.ts.toISOString()}) — election ${v.election.electionType}/${v.election.state} cycle=${v.election.cycle}`
    );
  }

  console.log(
    `Will pull ${staleCareerPullsForDoubleActive.length} stale careerHistory event(s) for DOUBLE-ACTIVE characters.`
  );
  for (const p of staleCareerPullsForDoubleActive) {
    console.log(
      `  ${p.char.name} | ${p.eventType} | "${p.officeLabel ?? "?"}" | date=${p.eventDate.toISOString()} | electionId=${p.election._id.toString()}`
    );
  }

  // ── Per-restore detail (first 30) ──
  console.log(`\nRestore detail (first 30):`);
  for (const d of toRestore.slice(0, 30)) {
    console.log(
      `  ${d.char.name} | ${d.election.electionType}/${d.election.state} cycle=${d.election.cycle} | party="${d.cand.party}" | reason=${d.reason}`
    );
  }

  if (!apply) {
    console.log(`\nDRY RUN — no changes made. Re-run with --apply to write.`);
    await client.close();
    return;
  }

  // ── APPLY ──
  console.log(`\nApplying changes...`);
  const now = new Date();

  // 1. Vacate prematurely-elected officeholders
  for (const { official, election, ts } of seatsToVacate.values()) {
    if (!official.characterId) continue;

    // Clear electedOfficials row for this seat — preserves the seat doc.
    const filter: Record<string, unknown> = {
      officeType: official.officeType,
    };
    if (official.state !== undefined) filter.state = official.state;
    if (official.senateClass !== undefined) filter.senateClass = official.senateClass;
    if (official.chamberClass !== undefined) filter.chamberClass = official.chamberClass;
    await db.collection("electedOfficials").updateMany(filter, {
      $set: {
        characterId: null,
        characterName: null,
        party: null,
        electedAt: null,
        updatedAt: now,
      },
    });

    // Clear character.currentOffice if it matches this seat
    const officeFilter: Record<string, unknown> = {
      _id: official.characterId,
      "currentOffice.type": official.officeType,
    };
    if (official.state !== undefined) officeFilter["currentOffice.state"] = official.state;
    if (official.senateClass !== undefined)
      officeFilter["currentOffice.senateClass"] = official.senateClass;
    if (official.chamberClass !== undefined)
      officeFilter["currentOffice.chamberClass"] = official.chamberClass;
    await db
      .collection("characters")
      .updateOne(officeFilter, { $set: { currentOffice: null, updatedAt: now } });

    // Remove the matching "elected" / "lost_election" careerHistory entries for this election
    // ($pull with electionId AND date-window match — tolerate ±2s drift)
    await db.collection("characters").updateMany(
      { "careerHistory.electionId": election._id.toString() },
      {
        $pull: {
          careerHistory: {
            electionId: election._id.toString(),
            type: { $in: ["elected", "lost_election"] },
            date: {
              $gte: new Date(ts.getTime() - 2_000),
              $lte: new Date(ts.getTime() + 2_000),
            },
          },
        } as never,
      }
    );

    console.log(
      `  vacated ${official.officeType}/${official.state ?? ""} (was ${official.characterName})`
    );
  }

  // 2. Restore candidates: status="active", unset withdrawnAt
  const restoreIds = toRestore.map((d) => d.cand._id);
  if (restoreIds.length > 0) {
    await db
      .collection("electionCandidates")
      .updateMany(
        { _id: { $in: restoreIds } },
        { $set: { status: "active" }, $unset: { withdrawnAt: "" } }
      );
    console.log(`  restored ${restoreIds.length} candidacies to active`);
  }

  // 3. Re-add candidates to their vote tally so accumulation includes them
  // We $set names/parties and only $set totalVotes if missing (to avoid
  // overwriting any already-accumulated count).
  const toRestoreByElection = new Map<string, typeof toRestore>();
  for (const d of toRestore) {
    const k = d.election._id.toString();
    if (!toRestoreByElection.has(k)) toRestoreByElection.set(k, []);
    toRestoreByElection.get(k)!.push(d);
  }
  let tallyUpdates = 0;
  for (const [eidStr, cands] of toRestoreByElection) {
    const tally = await db
      .collection<{ totalVotes?: Record<string, number> }>("electionVoteTallies")
      .findOne({ electionId: new ObjectId(eidStr) });
    if (!tally) continue; // no tally yet — nothing to fix
    const sets: Record<string, unknown> = { updatedAt: now };
    for (const d of cands) {
      const id = d.cand._id.toString();
      sets[`candidateNames.${id}`] = d.cand.characterName;
      sets[`candidateParties.${id}`] = d.cand.party;
      // Only initialize totalVotes if not already present (don't clobber accumulated count)
      if (!(id in (tally.totalVotes ?? {}))) {
        sets[`totalVotes.${id}`] = 0;
      }
    }
    await db
      .collection("electionVoteTallies")
      .updateOne({ electionId: new ObjectId(eidStr) }, { $set: sets });
    tallyUpdates++;
  }
  console.log(`  patched ${tallyUpdates} vote tally doc(s) to re-include restored candidates`);

  // 4. Pull stale careerHistory entries for DOUBLE-ACTIVE characters.
  // Exact-match $pull on (type, electionId, date) — safer than a date window
  // because DOUBLE-ACTIVE characters have a re-entry whose seating could
  // eventually add a *new* "elected" event at a different date we must not
  // touch.
  let doubleActivePulled = 0;
  for (const p of staleCareerPullsForDoubleActive) {
    const res = await db.collection("characters").updateOne(
      { _id: p.char._id },
      {
        $pull: {
          careerHistory: {
            type: p.eventType,
            electionId: p.election._id.toString(),
            date: p.eventDate,
          },
        } as never,
      }
    );
    if (res.modifiedCount > 0) doubleActivePulled++;
  }
  console.log(
    `  pulled ${doubleActivePulled} stale careerHistory event(s) for DOUBLE-ACTIVE characters`
  );

  console.log(`\nApply complete.`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
