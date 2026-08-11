/**
 * Migration: Decouple central bank chair from `character.currentOffice`.
 *
 * Before this refactor, accepting a chair appointment overwrote the character's
 * `currentOffice` to `{ type: "centralBankChair" }`, which wiped any legislative
 * seat they held and was itself clobbered whenever they won another election.
 * Chair status is now authoritative on `centralBanks.chairCharacterId`, and
 * actionRefresh grants the chair bonus independently.
 *
 * For each character currently carrying `currentOffice.type = "centralBankChair"`:
 *   - If they hold an elected seat (row in `electedOfficials` with
 *     `characterId = this`), rebuild `currentOffice` from that row so their
 *     office bonus resumes immediately.
 *   - Otherwise, set `currentOffice = null`.
 *
 * Chair status on `centralBanks` is left untouched — actionRefresh will read
 * from there going forward.
 *
 * Run: npx tsx scripts/migrations/decouple-chair-from-currentoffice.ts
 */

import type { ObjectId } from "mongodb";
import type { OfficeType } from "@/lib/db/types";
import type { ElectedOfficial } from "@/lib/db/types/officials";
import { connectDb, closeDb } from "../utils/db";

/**
 * Rebuild an `OfficeType` object from an `electedOfficials` row. Only the
 * fields that belong to that office shape are copied in so we don't introduce
 * `undefined` properties the app code doesn't expect.
 */
function reconstructOfficeFromOfficial(official: ElectedOfficial): OfficeType {
  const office: Record<string, unknown> = { type: official.officeType };
  if (official.state) office.state = official.state;
  if (official.senateClass) office.senateClass = official.senateClass;
  if (official.chamberClass) office.chamberClass = official.chamberClass;
  if (typeof official.seatsHeld === "number") office.seatsHeld = official.seatsHeld;
  return office as OfficeType;
}

async function migrate() {
  const db = await connectDb();

  const affected = await db
    .collection("characters")
    .find({ "currentOffice.type": "centralBankChair" })
    .project<{ _id: ObjectId; name: string }>({ _id: 1, name: 1 })
    .toArray();

  console.log(
    `Found ${affected.length} character(s) with stale currentOffice.type=centralBankChair`
  );

  let rebuilt = 0;
  let cleared = 0;
  const now = new Date();

  for (const c of affected) {
    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ characterId: c._id, isNPP: { $ne: true } })
      .toArray();

    if (officials.length === 0) {
      await db
        .collection("characters")
        .updateOne({ _id: c._id }, { $set: { currentOffice: null, updatedAt: now } });
      console.log(`  ${c.name}: no elected seat → currentOffice = null`);
      cleared++;
      continue;
    }

    if (officials.length > 1) {
      console.warn(
        `  ${c.name}: multiple electedOfficials rows (${officials.length}); using the first. Review manually if this looks wrong.`
      );
    }

    const office = reconstructOfficeFromOfficial(officials[0]);
    await db
      .collection("characters")
      .updateOne({ _id: c._id }, { $set: { currentOffice: office, updatedAt: now } });
    console.log(`  ${c.name}: rebuilt currentOffice = ${JSON.stringify(office)}`);
    rebuilt++;
  }

  console.log(
    `\nDone. Rebuilt from electedOfficials: ${rebuilt}. Set to null: ${cleared}. Total: ${affected.length}.`
  );

  await closeDb();
}

migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
