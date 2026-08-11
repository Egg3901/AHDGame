/**
 * One-off support: credit corporation liquidCapital for bond proceeds that were never
 * applied (bond row exists; treasury $inc failed — pre-transaction issuance bug).
 *
 *   npx tsx scripts/heal-missing-bond-proceeds.ts --sequential-id=14 --bond-id=<24hex> --apply
 *
 * Omit --apply to print the planned credit only (no writes).
 */
import { ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import { connectDb, closeDb } from "./utils/db";
import type { Bond, Corporation } from "@/lib/db/types";
import { anchorToCorpLiquidCapital, getCorpFxRate } from "@/lib/currency/corporationCapital";

dotenv.config({ path: ".env.local" });

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const seqRaw = argValue("sequential-id");
  const bondIdRaw = argValue("bond-id");
  const apply = hasFlag("apply");

  if (!seqRaw || !bondIdRaw) {
    console.error(
      "Usage: npx tsx scripts/heal-missing-bond-proceeds.ts --sequential-id=<n> --bond-id=<24hex> [--apply]"
    );
    process.exit(1);
  }

  if (!ObjectId.isValid(bondIdRaw) || bondIdRaw.length !== 24) {
    console.error("--bond-id must be a 24-character hex ObjectId");
    process.exit(1);
  }

  const sequentialId = parseInt(seqRaw, 10);
  if (!Number.isFinite(sequentialId) || sequentialId < 0) {
    console.error("--sequential-id must be a non-negative integer");
    process.exit(1);
  }

  const bondOid = new ObjectId(bondIdRaw);
  const db = await connectDb();

  const corp = await db.collection<Corporation>("corporations").findOne({ sequentialId });
  if (!corp) {
    console.error(`No corporation with sequentialId=${sequentialId}`);
    await closeDb();
    process.exit(1);
  }

  const bond = await db
    .collection<Bond>("bonds")
    .findOne({ _id: bondOid, corporationId: corp._id });
  if (!bond) {
    console.error(`No bond ${bondIdRaw} for corporation ${corp.name} (${corp._id})`);
    await closeDb();
    process.exit(1);
  }

  const fx = await getCorpFxRate(db, corp);
  const credit = anchorToCorpLiquidCapital(bond.totalIssued, corp, fx);

  console.log("Corporation:", corp.name, "seq", corp.sequentialId, corp._id.toString());
  console.log(
    "Bond:",
    bond._id.toString(),
    "totalIssued(₳)",
    bond.totalIssued,
    "issuedAtTurn",
    bond.issuedAtTurn
  );
  console.log("FX:", fx, "liquidCurrencyCode:", corp.liquidCurrencyCode ?? "(USD/pre-forex)");
  console.log("Planned $inc liquidCapital:", credit);

  if (!apply) {
    console.log("\n(dry run — pass --apply to write)");
    await closeDb();
    return;
  }

  const now = new Date();
  const result = await db
    .collection<Corporation>("corporations")
    .updateOne({ _id: corp._id }, { $inc: { liquidCapital: credit }, $set: { updatedAt: now } });

  await db.collection("adminLogs").insertOne({
    action: "heal_missing_bond_proceeds",
    admin: "script/heal-missing-bond-proceeds",
    details: {
      corporationId: corp._id.toString(),
      corporationSequentialId: corp.sequentialId,
      bondId: bond._id.toString(),
      anchorFaceValue: bond.totalIssued,
      liquidCapitalCredit: credit,
      fxRateUsed: fx,
    },
    timestamp: now,
  });

  console.log("Updated matchedCount:", result.matchedCount, "modifiedCount:", result.modifiedCount);
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
