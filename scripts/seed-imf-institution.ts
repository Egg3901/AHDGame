/**
 * CLI: create or repair the IMF institution via the same rules as POST /api/admin/imf/seed.
 * Pass three 24-char hex character IDs: CEO (must equal one of the next two), shareholder1, shareholder2.
 *
 * Usage:
 *   npx tsx scripts/seed-imf-institution.ts <ceoCharacterId> <shareholder1Id> <shareholder2Id>
 *
 * Or use Admin → Server Setup or Corporations → IMF form in the UI.
 */
import { ObjectId } from "mongodb";
import { connectDb, closeDb } from "./utils/db";
import { seedImfInstitution, SeedImfInstitutionError } from "../src/lib/imf/seedImfInstitution";

async function main() {
  const a = process.argv[2];
  const b = process.argv[3];
  const c = process.argv[4];
  if (!a || !b || !c) {
    console.error(
      "Usage: npx tsx scripts/seed-imf-institution.ts <ceoCharacterId> <shareholder1Id> <shareholder2Id>\n" +
        "CEO must match one of the two shareholder IDs. Or use the admin IMF seed form in the UI."
    );
    process.exit(1);
  }

  const ceoId = new ObjectId(a);
  const sh1 = new ObjectId(b);
  const sh2 = new ObjectId(c);

  const db = await connectDb();
  try {
    const result = await seedImfInstitution(db, {
      ceoCharacterId: ceoId,
      shareholderCharacterIds: [sh1, sh2],
    });
    console.log(
      result.created
        ? "Created IMF institution corporation."
        : result.updated
          ? "IMF institution already existed — ownership updated."
          : "IMF institution already present — no changes needed."
    );
    console.log("corporationId:", result.corporationId);
    if (result.sequentialId != null) console.log("sequentialId:", result.sequentialId);
  } catch (e) {
    if (e instanceof SeedImfInstitutionError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  void main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
