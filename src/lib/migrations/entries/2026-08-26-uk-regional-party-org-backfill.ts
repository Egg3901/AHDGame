import type { Db } from "mongodb";
import type { StatePartyOrg } from "@/lib/db/types";
import type { Migration, MigrationResult } from "../types";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { calculateUKStatePartyOrgs } from "@/lib/seeds/uk/ukStatePartyOrgCalculations";

/**
 * Give the formerly-regional UK parties an organisation row in every region.
 *
 * SNP, Plaid Cymru, the DUP, Sinn Fein and the UUP used to be barred from
 * standing outside their home nation by a hardcoded table in
 * `src/lib/parties/regionalContest.ts`. That gate is gone — they stand
 * UK-wide now — but the seed never wrote them a `statePartyOrg` row outside
 * their home nation, and a party with no row (or `hasPresence: false`) still
 * cannot field NEW candidates there (`canPartyFieldInState`). Without this
 * backfill, lifting the gate would leave them able to file by hand and
 * nothing else.
 *
 * The expected row set comes from `calculateUKStatePartyOrgs` for the world's
 * active preset — the same function the seeder and the reset reconciler use —
 * so the backfill and a fresh world agree by construction, on any preset.
 *
 * Insert-only. An existing row is never touched, which matters on live: Plaid
 * Cymru already carries player-built org in four English regions (EMI 29.2,
 * SWE 33.9, WMI 24.2, EAE 7.4) that was inert under the gate and becomes real
 * the moment it lifts. Overwriting those to the seed floor would confiscate
 * work players had already paid for.
 *
 * New rows land wherever the era polling table puts them, which for a party
 * that polled 0 in a region is the MIN_ORG floor of 5 with a registration
 * share of 0 — present and organisable, not competitive.
 */
async function backfillUKRegionalPartyOrg(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];

  const preset = await getGameStatePresetOrDefault(db);
  const expected = await calculateUKStatePartyOrgs(db, preset);
  notes.push(`preset ${preset}: ${expected.length} expected UK statePartyOrg row(s)`);

  const ids = expected.map((o) => o._id);
  const existing = await db
    .collection<StatePartyOrg>("statePartyOrg")
    // _id is a string composite ("REGION_partyId") — cast for the typed filter.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    .find({ _id: { $in: ids as any } } as any)
    /* eslint-enable @typescript-eslint/no-explicit-any */
    .project<{ _id: string }>({ _id: 1 })
    .toArray();
  const existingIds = new Set(existing.map((r) => String(r._id)));

  const missing = expected.filter((o) => !existingIds.has(o._id));
  notes.push(`${existingIds.size} row(s) already present, ${missing.length} missing`);

  if (missing.length > 0) {
    const byParty = new Map<string, number>();
    for (const org of missing) byParty.set(org.partyId, (byParty.get(org.partyId) ?? 0) + 1);
    notes.push(
      `missing by party: ${[...byParty.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([partyId, count]) => `${partyId}=${count}`)
        .join(", ")}`
    );
  }

  if (dryRun) {
    notes.push("dry run: no writes performed");
    return { documentsScanned: expected.length, notes };
  }

  const now = new Date();
  let documentsInserted = 0;
  for (const org of missing) {
    // Upsert with $setOnInsert rather than a bare insert. The runner executes
    // on deploy, which can overlap a turn: Build Org can create the very row
    // being backfilled between the scan above and this write. An insert would
    // abort the whole run on E11000; $setOnInsert makes the write a no-op on
    // a row that already exists, so the player's org survives either way.
    const { _id, ...fields } = org;
    const result = await db.collection<StatePartyOrg>("statePartyOrg").updateOne(
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      { _id: _id as any },
      { $setOnInsert: { ...fields, createdAt: now, updatedAt: now } },
      { upsert: true }
    );
    if (result.upsertedCount > 0) documentsInserted++;
  }

  if (documentsInserted !== missing.length) {
    notes.push(
      `${missing.length - documentsInserted} row(s) appeared between scan and write; left untouched`
    );
  }

  return { documentsScanned: expected.length, documentsInserted, notes };
}

export const migration: Migration = {
  id: "2026-08-26-uk-regional-party-org-backfill",
  description:
    "Give SNP/Plaid/DUP/SF/UUP a statePartyOrg row in every UK region now that they stand UK-wide (insert-only; never overwrites player-built org)",
  idempotent: true,
  execute: (db, ctx) => backfillUKRegionalPartyOrg(db, ctx.dryRun),
};
