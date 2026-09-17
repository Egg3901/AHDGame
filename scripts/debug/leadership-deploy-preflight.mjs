import fs from "fs";
import { MongoClient } from "mongodb";
const raw = fs.readFileSync("./.env.local", "utf8");
const line = raw
  .split(/\r?\n/)
  .find((l) => l.startsWith("MONGODB_URI_LIVE=") && l.includes("rlwy.net"));
const base = line.slice("MONGODB_URI_LIVE=".length).trim();
const c = new MongoClient(base + (base.includes("?") ? "&" : "?") + "directConnection=true");
await c.connect();
const db = c.db("a-house-divided");

const CHAMBER = {
  speaker_of_the_house: "house",
  majority_leader_house: "house",
  minority_leader_house: "house",
  majority_whip_house: "house",
  minority_whip_house: "house",
  president_pro_tempore: "senate",
  majority_leader_senate: "senate",
  minority_leader_senate: "senate",
  majority_whip_senate: "senate",
  minority_whip_senate: "senate",
  speaker_of_the_bundestag: "bundestag",
  chair_npcsc: "npcDelegate",
  chair_cppcc: "npcDelegate",
};

console.log("What the first turn after deploy would vacate:");
const leaders = await db.collection("congressLeaders").find({}).toArray();
let willVacate = 0;
for (const l of leaders) {
  const chamber = CHAMBER[l.role];
  if (!chamber || !l.characterId) continue;
  const seat = await db.collection("electedOfficials").findOne({
    officeType: chamber,
    $or: [{ characterId: l.characterId }, { nppId: l.characterId }],
  });
  const chamberSeats = await db
    .collection("electedOfficials")
    .countDocuments({ officeType: chamber });
  const verdict = seat
    ? "seated, untouched"
    : chamberSeats === 0
      ? "no seat BUT chamber empty -> skipped by guard"
      : "NO SEAT -> would vacate + open race";
  if (!seat && chamberSeats > 0) willVacate++;
  console.log(`  ${l.role.padEnd(25)} ${String(l.characterName).padEnd(22)} ${verdict}`);
}
console.log(`\ntotal that the first turn would vacate: ${willVacate}`);

const total = await db.collection("electedOfficials").estimatedDocumentCount();
console.log("\nelectedOfficials total docs:", total);
for (const ch of ["house", "senate", "bundestag", "npcDelegate"]) {
  console.log(
    `  ${ch}:`,
    await db.collection("electedOfficials").countDocuments({ officeType: ch })
  );
}

const idx = await db.collection("electedOfficials").indexes();
console.log("\nelectedOfficials indexes:");
for (const i of idx) console.log("  ", i.name, JSON.stringify(i.key));
const hasNpp = idx.some((i) => i.name === "electedOfficials_nppId_officeType");
console.log(
  "\nnppId index present:",
  hasNpp ? "YES" : "NO — must run the index seed before/with deploy"
);
await c.close();
