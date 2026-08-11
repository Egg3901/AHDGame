import { MongoClient } from "mongodb";
import * as fs from "fs";
import * as path from "path";

type StringIdDocument = { _id: string; [key: string]: unknown };
type OrganizationMembershipDocument = {
  organizationId: string;
  countryId: string;
  status: "founding" | "active";
  joinedAt: Date;
  joinedTurn: number;
};

function readMongoUri(): string {
  const envPath = path.join(process.cwd(), ".env.local");
  const envContent = fs.readFileSync(envPath, "utf-8");
  const match = envContent.match(/MONGODB_URI(?:_LIVE)?=("?)([^"\r\n]+)\1/);
  if (!match?.[2]) throw new Error("MONGODB_URI not found in .env.local");
  return match[2].trim();
}

async function main() {
  const client = new MongoClient(readMongoUri());
  await client.connect();
  const db = client.db("a-house-divided");
  const centralBanks = db.collection<StringIdDocument>("centralBanks");

  const existing = await centralBanks.findOne({ _id: "ECB" });
  if (existing) {
    await centralBanks.updateOne(
      { _id: "ECB" },
      { $set: { intorgId: "EU", updatedAt: new Date() } }
    );
    console.log("ECB bank document already exists; ensured intorgId=EU");
  } else {
    const deBank = await centralBanks.findOne({ _id: "DE" });
    if (deBank) {
      const { _id: _unused, ...rest } = deBank;
      await centralBanks.insertOne({
        _id: "ECB",
        ...rest,
        countryId: "DE",
        intorgId: "EU",
        updatedAt: new Date(),
      });
      await centralBanks.deleteOne({ _id: "DE" });
      console.log("Migrated DE central bank document to ECB");
    } else {
      console.log("No DE central bank document found; ECB will be created on first access");
    }
  }

  const ieBank = await centralBanks.findOne({ _id: "IE" });
  if (ieBank) {
    await centralBanks.deleteOne({ _id: "IE" });
    console.log("Removed stale IE central bank document");
  }

  const memberships = db.collection<OrganizationMembershipDocument>("organizationMemberships");
  const ieInEu = await memberships.findOne({ organizationId: "EU", countryId: "IE" });
  if (!ieInEu) {
    await memberships.insertOne({
      organizationId: "EU",
      countryId: "IE",
      status: "founding",
      joinedAt: new Date(),
      joinedTurn: 0,
    });
    console.log("Added IE as EU founding member");
  }

  await client.close();
  console.log("ECB migration complete");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
