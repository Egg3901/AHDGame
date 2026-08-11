/**
 * Heal: orphan `party:null seatsHeld>0` electedOfficials blocs (ticket #951).
 *
 * When a multi-seat winner (commons/bundestag/seanad) moved from a previous
 * office to a new seat, generalResolution vacated its OLD bloc by nulling the
 * holder identity (nppId/characterId/party) but left `seatsHeld` intact. That
 * produced ownerless `party:null, characterId:null, nppId:null, seatsHeld>0`
 * records. The seat tallies skip null-party rows (parliamentaryGovernment.ts:96,
 * germanyAMS.ts:163), so those seats silently vanish from the party — e.g. the
 * Conservatives' 14 NEE UK-commons seats reported as "vacant".
 *
 * The code fix ($unset seatsHeld on vacate) stops NEW orphans. This heals the
 * existing junk: vacancy is represented by row ABSENCE in this codebase (true
 * vacancies delete rows, they don't leave null placeholders), so these phantom
 * blocs are deleted. The next election re-contests the seats.
 *
 * Dry-run by default. Pass --apply to mutate. Read-only otherwise.
 *
 *   npx tsx scripts/heal-orphan-null-party-seats.ts           # dry run
 *   npx tsx scripts/heal-orphan-null-party-seats.ts --apply   # execute
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";

const APPLY = process.argv.includes("--apply");

async function run() {
  const base = process.env.MONGODB_URI!;
  const uri = base + (base.includes("?") ? "&" : "?") + "directConnection=true";
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");
  const col = db.collection("electedOfficials");

  // Orphan = no holder of any kind, yet still claims seats.
  const orphanShape = {
    party: null,
    characterId: null,
    nppId: null,
    seatsHeld: { $gt: 0 },
  } as const;

  // Heal multi-seat bodies where a null-party bloc can ONLY be the vacate bug
  // (a moved holder's stranded seat count). IE `seanad` is included: code review
  // (ticket #951) confirmed the IE seed always stamps a party on every seanad
  // row (historicalSeats.ts), the Oireachtas panel is derived from the Dáil and
  // never reads seanad officials (seanadComposition.ts), and the tally is
  // lower-chamber-only — so a party:null seanad row is definitionally the same
  // orphan, not a legitimate non-party panel seat.
  const HEALED_OFFICE_TYPES = ["commons", "snap_commons", "bundestag", "snap_bundestag", "seanad"];
  const healFilter = { ...orphanShape, officeType: { $in: HEALED_OFFICE_TYPES } };

  const all = await col.find(orphanShape).toArray();
  const toHeal = all.filter((o) => HEALED_OFFICE_TYPES.includes(o.officeType as string));
  const flagged = all.filter((o) => !HEALED_OFFICE_TYPES.includes(o.officeType as string));

  console.log(`MODE: ${APPLY ? "APPLY (will delete)" : "DRY RUN (read-only)"}`);
  const fmt = (o: (typeof all)[number]) =>
    `  ${o.countryId}/${o.officeType}/${o.state}  seats=${o.seatsHeld}` +
    `  created=${(o.createdAt as Date)?.toISOString?.().slice(0, 10)}` +
    `  updated=${(o.updatedAt as Date)?.toISOString?.().slice(0, 10)}  _id=${o._id}`;

  const sortKey = (o: (typeof all)[number]) => `${o.countryId}${o.officeType}${o.state}`;
  const healSeats = toHeal.reduce((s, o) => s + ((o.seatsHeld as number) ?? 0), 0);
  console.log(
    `\nWILL HEAL — ${toHeal.length} party-list orphan blocs (${healSeats} phantom seats):`
  );
  toHeal.sort((a, b) => sortKey(a).localeCompare(sortKey(b))).forEach((o) => console.log(fmt(o)));

  if (flagged.length) {
    console.log(
      `\nFLAGGED (NOT touched) — ${flagged.length} null-party blocs on other office types.\n` +
        `Review against the seed before deleting (may be legitimate non-party seats):`
    );
    flagged
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
      .forEach((o) => console.log(fmt(o)));
  }

  if (!APPLY) {
    console.log("\nDry run — nothing changed. Re-run with --apply to delete the WILL-HEAL set.");
  } else {
    const res = await col.deleteMany(healFilter);
    console.log(`\nDeleted ${res.deletedCount} party-list orphan blocs.`);
  }

  await client.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
