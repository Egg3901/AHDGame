import type { Db } from "mongodb";
import type { StatePartyOrg } from "@/lib/db/types";
import type { Migration, MigrationResult } from "../types";

/**
 * Re-key `statePartyOrg` rows whose compound `_id` drifted from their
 * `{stateId, partyId}` fields, and add the unique index that keeps them
 * aligned. Ticket #1256.
 *
 * The collection has two row identities: the `_id` string
 * `{stateId}_{partyId}` and the `{countryId, stateId, partyId}` field triple.
 * Live code reads both ways. A party renumber (country merge rewrites
 * `statePartyOrg.partyId` but not its `_id`), a region fuse (re-points
 * `stateId` in place), or a one-off writer can leave the `_id` naming a
 * different party or region than the fields — after a German reunification,
 * SED's org sat on `_id NW_7` while `_id NW_1` held SPD's numbers, so the
 * state page and the party page disagreed and Build Org poached from the wrong
 * row.
 *
 * THE FIELDS ARE AUTHORITATIVE: the country-scoped queries, the Build Org
 * poach pass and the state org breakdown all join on `{countryId, stateId,
 * partyId}`. The `_id` is re-derived from them, never the reverse — a row
 * whose fields are missing (no `stateId`) is left alone rather than guessed.
 *
 * Re-keying is delete-then-insert (`_id` is immutable in MongoDB). When two
 * drifted rows compete for one canonical key, the earliest-created wins; the
 * other is DELETED, because two rows for one (state, party) pair is the
 * corruption this migration exists to end — the duplicate would otherwise
 * resurface on the next poach. Their org values are NOT summed: the loser of a
 * re-key is by construction a misattributed remnant (e.g. an old seq-id
 * shadow), and adding its number to the survivor would inflate the state's org
 * pool out of nothing.
 *
 * One collision is NOT a takeover: when the canonical key is held by a
 * WELL-KEYED row of ANOTHER party (SPD's own `_id NW_1`, which the drifted
 * SED row wants because SED's pre-renumber seq id was also 1), that row is
 * live data the migration has no mandate to touch. The drifted row keeps its
 * stale key rather than stealing someone else's; the ensure-heal on the write
 * paths handles the pair one row at a time, where the live row is known.
 */
async function rekeyDriftedStatePartyOrgIds(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];
  const col = db.collection<StatePartyOrg>("statePartyOrg");

  const all = await col.find({}).toArray();

  // Rows violating `_id === ${stateId}_${partyId}`. A missing stateId/partyId
  // cannot be re-derived, so those rows are counted and skipped.
  const drifted = all.filter((row) => {
    if (typeof row.stateId !== "string" || typeof row.partyId !== "string") return false;
    return row._id !== `${row.stateId}_${row.partyId}`;
  });
  const skipped = all.filter(
    (row) => typeof row.stateId !== "string" || typeof row.partyId !== "string"
  );
  if (skipped.length > 0) notes.push(`${skipped.length} row(s) missing stateId/partyId — skipped`);
  notes.push(`${drifted.length} drifted row(s) found`);

  // Canonical key -> drifted rows claiming it.
  const byCanonicalKey = new Map<string, StatePartyOrg[]>();
  for (const row of drifted) {
    const key = `${row.stateId}_${row.partyId}`;
    const list = byCanonicalKey.get(key);
    if (list) list.push(row);
    else byCanonicalKey.set(key, [row]);
  }
  const byId = new Map(all.map((row) => [row._id, row]));
  const staleIdsToDelete: string[] = [];
  const insertDocs: Array<{ doc: StatePartyOrg; staleId: string; blocked: boolean }> = [];
  for (const [key, claimants] of byCanonicalKey) {
    // Among several drifted claimants, the earliest created wins
    // deterministically.
    const winner = [...claimants].sort(
      (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0)
    )[0];
    for (const claimant of claimants) {
      if (claimant === winner) {
        const { _id: _stale, ...rest } = claimant;
        void _stale;
        // A WELL-KEYED row holding this key is another party's own row (its
        // fields match its key). It is not a squatter to remove — the drifted
        // row keeps its stale key instead of stealing theirs, and the
        // ensure-heal on the write paths resolves the pair later.
        const holder = byId.get(key);
        const blocked =
          holder != null && !drifted.includes(holder) && holder.partyId !== claimant.partyId;
        insertDocs.push({
          doc: { ...(rest as StatePartyOrg), _id: key },
          staleId: claimant._id,
          blocked,
        });
      }
      staleIdsToDelete.push(claimant._id);
    }
  }

  if (dryRun) {
    notes.push(`dry run: would re-key ${insertDocs.filter((d) => !d.blocked).length} row(s)`);
    return { documentsScanned: all.length, notes };
  }

  // Delete ALL drifted rows first (including the winner's stale key), then
  // insert the healed winners. Two passes so a re-key never collides with a
  // stale key that is itself being removed.
  if (staleIdsToDelete.length > 0) {
    await col.deleteMany({ _id: { $in: staleIdsToDelete } });
  }
  let inserted = 0;
  let blockedCount = 0;
  for (const { doc, staleId, blocked } of insertDocs) {
    if (blocked) {
      // The drifted row's stale key was just deleted above; re-insert it
      // UNCHANGED (its own stale _id) so the party's org stays readable while
      // it waits for the ensure-heal, which will re-key it once the blocker is
      // gone. Re-inserting under the canonical key here would overwrite the
      // other party's correctly-keyed row.
      blockedCount++;
      await col.insertOne({ ...doc, _id: staleId });
      continue;
    }
    // $setOnInsert-style guarded insert: a concurrent Build Org could have
    // created the canonical row between the scans above and this write. That
    // row carries live player state; ours is the stale copy, so skip.
    const res = await col.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
    if (res.upsertedCount > 0) inserted++;
  }
  if (blockedCount > 0) {
    notes.push(
      `${blockedCount} row(s) kept their stale key — a correctly-keyed row of another party already holds their canonical key; ensure-heal will re-key them later`
    );
  }
  if (insertDocs.length !== inserted + blockedCount) {
    notes.push(
      `${insertDocs.length - inserted - blockedCount} row(s) appeared at the canonical key; left untouched`
    );
  }

  notes.push(`re-keyed ${inserted} row(s), removed ${staleIdsToDelete.length} stale key(s)`);

  // The unique index is the recurrence guard: two rows for one
  // (country, state, party) can never exist again. Any future drift writer
  // throws instead of silently misattributing org.
  await db.collection("statePartyOrg").createIndex(
    { countryId: 1, stateId: 1, partyId: 1 },
    {
      unique: true,
      name: "statePartyOrg_country_state_party_unique",
    }
  );
  notes.push("unique index statePartyOrg_country_state_party_unique ensured");

  return {
    documentsScanned: all.length,
    documentsInserted: inserted,
    documentsDeleted: staleIdsToDelete.length,
    notes,
  };
}

export const migration: Migration = {
  id: "2026-09-02-state-party-org-rekey",
  description:
    "Re-key statePartyOrg rows whose compound _id drifted from {stateId}_{partyId} (party renumber / region fuse fallout, ticket #1256) and add the unique {countryId, stateId, partyId} index",
  idempotent: true,
  execute: (db, ctx) => rekeyDriftedStatePartyOrgIds(db, ctx.dryRun),
};
