/**
 * One-shot: reseed the cabinet wiki pages (new cabinet-projects page +
 * updated cabinet page) into the wikiPages collection. Equivalent to
 * POST /api/admin/wiki/reseed { slugs: ["cabinet-projects", "cabinet"] }.
 *
 * Usage: npx tsx scripts/reseed-wiki-cabinet.ts
 * Requires MONGODB_URI in env (with directConnection=true for prod).
 */
import fs from "node:fs";
import { MongoClient, ObjectId } from "mongodb";
import { seedWikiPages } from "../src/lib/seeds/wiki";

async function main() {
  let uri = process.env.MONGODB_URI;
  if (!uri) {
    uri = fs
      .readFileSync(".env.local", "utf8")
      .split("\n")
      .find((l) => l.startsWith("MONGODB_URI="))
      ?.slice("MONGODB_URI=".length)
      .trim();
  }
  if (!uri) throw new Error("MONGODB_URI not set");
  if (!uri.includes("directConnection")) {
    uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
  }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  const admin = await db
    .collection("users")
    .findOne(
      { $or: [{ isAdmin: true }, { role: "admin" }] },
      { projection: { _id: 1, username: 1 } }
    );
  if (!admin) throw new Error("no admin user found");
  console.log("seeding as admin user:", admin.username ?? admin._id.toString());

  const result = await seedWikiPages(db, admin._id as ObjectId, {
    slugs: [
      "cabinet-projects",
      "cabinet",
      "cabinet-guide",
      "us-overview",
      "uk-overview",
      "de-overview",
      "jp-overview",
      "cn-overview",
      "ie-overview",
      "ng-overview",
    ],
  });
  console.log(JSON.stringify(result, null, 2));
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
