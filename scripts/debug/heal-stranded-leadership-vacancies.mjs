// Heal for the "vacated with no race" defect fixed on fix/speaker-vacancy-election.
//
// The code fix fires on the vacancy TRANSITION, so a chair that was already
// emptied before the deploy never self-heals: the sweep skips an already-vacant
// role (deliberately — otherwise a race nobody enters, which resolves by
// vacating and closing, would re-open forever). This finds those stranded
// chairs and opens the race the code would have opened.
//
// Read-only unless --apply.
import fs from "fs";
import { MongoClient } from "mongodb";

const APPLY = process.argv.includes("--apply");
const DURATION_HOURS = 24;

// leaderRole -> where its race lives. The DE/CN chairs are listed so the report
// is complete, but their races are run by their own modules and this script
// does not open them.
const ROLES = [
  {
    leaderRole: "speaker_of_the_house",
    chamber: "house",
    collection: "speakerElections",
    id: "current",
    nominations: "speakerNominations",
    nominationFilter: {},
  },
  {
    leaderRole: "majority_leader_house",
    chamber: "house",
    collection: "houseLeadershipElections",
    id: "majority_leader",
    nominations: "houseLeadershipNominations",
    nominationFilter: { role: "majority_leader" },
  },
  {
    leaderRole: "minority_leader_house",
    chamber: "house",
    collection: "houseLeadershipElections",
    id: "minority_leader",
    nominations: "houseLeadershipNominations",
    nominationFilter: { role: "minority_leader" },
  },
  {
    leaderRole: "majority_whip_house",
    chamber: "house",
    collection: "houseLeadershipElections",
    id: "majority_whip",
    nominations: "houseLeadershipNominations",
    nominationFilter: { role: "majority_whip" },
  },
  {
    leaderRole: "minority_whip_house",
    chamber: "house",
    collection: "houseLeadershipElections",
    id: "minority_whip",
    nominations: "houseLeadershipNominations",
    nominationFilter: { role: "minority_whip" },
  },
  {
    leaderRole: "president_pro_tempore",
    chamber: "senate",
    collection: "senateLeadershipElections",
    id: "pro_tempore",
    nominations: "senateLeadershipNominations",
    nominationFilter: { role: "pro_tempore" },
  },
  {
    leaderRole: "majority_leader_senate",
    chamber: "senate",
    collection: "senateLeadershipElections",
    id: "majority_leader",
    nominations: "senateLeadershipNominations",
    nominationFilter: { role: "majority_leader" },
  },
  {
    leaderRole: "minority_leader_senate",
    chamber: "senate",
    collection: "senateLeadershipElections",
    id: "minority_leader",
    nominations: "senateLeadershipNominations",
    nominationFilter: { role: "minority_leader" },
  },
  {
    leaderRole: "majority_whip_senate",
    chamber: "senate",
    collection: "senateLeadershipElections",
    id: "majority_whip",
    nominations: "senateLeadershipNominations",
    nominationFilter: { role: "majority_whip" },
  },
  {
    leaderRole: "minority_whip_senate",
    chamber: "senate",
    collection: "senateLeadershipElections",
    id: "minority_whip",
    nominations: "senateLeadershipNominations",
    nominationFilter: { role: "minority_whip" },
  },
  { leaderRole: "speaker_of_the_bundestag", chamber: "bundestag", collection: null },
  { leaderRole: "chair_npcsc", chamber: "npcDelegate", collection: null },
  { leaderRole: "chair_cppcc", chamber: "npcDelegate", collection: null },
];

const raw = fs.readFileSync("./.env.local", "utf8");
const line = raw.split(/\r?\n/).find((l) => l.startsWith("MONGODB_URI_LIVE="));
if (!line) throw new Error("MONGODB_URI_LIVE is missing from .env.local");
const base = line.slice("MONGODB_URI_LIVE=".length).trim();
const hostname = new URL(base).hostname.toLowerCase();
if (hostname !== "rlwy.net" && !hostname.endsWith(".rlwy.net")) {
  throw new Error("MONGODB_URI_LIVE must use a Railway database host");
}
const c = new MongoClient(base + (base.includes("?") ? "&" : "?") + "directConnection=true");
await c.connect();
const db = c.db("a-house-divided");

const gs = await db.collection("gameState").findOne({ _id: "current" });
const logFilter = { success: true };
if (gs.iteration) {
  logFilter["iteration.type"] = gs.iteration.type;
  logFilter["iteration.number"] = gs.iteration.number;
} else {
  logFilter.$or = [{ iteration: { $exists: false } }, { iteration: null }];
}
const latestLog = await db
  .collection("turnLogs")
  .find(logFilter)
  .sort({ turn: -1, gameTime: -1 })
  .limit(1)
  .next();
const currentTurn = Math.max(gs.currentTurn, latestLog?.turn ?? 0);
const effectiveNow = gs.pausedAt ? new Date(gs.pausedAt) : new Date(gs.lastTurnProcessed);
console.log("currentTurn:", currentTurn, "| effectiveNow:", effectiveNow.toISOString());

const isClosed = (el) =>
  typeof el?.endsOnTurn === "number"
    ? currentTurn >= el.endsOnTurn
    : !!el?.endsAt && effectiveNow.getTime() >= new Date(el.endsAt).getTime();

const leaders = await db.collection("congressLeaders").find({}).toArray();
const byRole = new Map(leaders.map((l) => [l.role, l]));
const seatCounts = new Map();
const seatCount = async (chamber) => {
  if (!seatCounts.has(chamber))
    seatCounts.set(
      chamber,
      await db.collection("electedOfficials").countDocuments({ officeType: chamber })
    );
  return seatCounts.get(chamber);
};

const stranded = [];
console.log("\nrole                      holder                 chamber seats  election");
console.log("-".repeat(96));
for (const role of ROLES) {
  const leader = byRole.get(role.leaderRole);
  const holder = leader?.characterId ? (leader.characterName ?? "(unnamed)") : "VACANT";
  const seats = await seatCount(role.chamber);
  let electionDesc = "(race lives in another module)";
  let isStranded = false;

  if (role.collection) {
    const el = await db.collection(role.collection).findOne({ _id: role.id });
    const live = el?.status === "voting" && !isClosed(el);
    electionDesc = el
      ? `${el.status} endsOnTurn=${el.endsOnTurn ?? "-"}${live ? " LIVE" : ""}`
      : "(no election doc)";
    isStranded = !leader?.characterId && !live && seats > 0;
    if (isStranded) stranded.push({ ...role, electionDesc });
  }

  console.log(
    `${role.leaderRole.padEnd(25)} ${String(holder).padEnd(22)} ${String(seats).padEnd(6)} ${electionDesc}${isStranded ? "   <-- STRANDED" : ""}`
  );
}

if (stranded.length === 0) {
  console.log("\nNothing stranded. No heal needed.");
  await c.close();
  process.exit(0);
}

console.log(
  `\n${stranded.length} stranded chair(s): ${stranded.map((s) => s.leaderRole).join(", ")}`
);
console.log(
  `Would open each with status=voting, endsOnTurn=${currentTurn + DURATION_HOURS}, endsAt=${new Date(
    effectiveNow.getTime() + DURATION_HOURS * 3_600_000
  ).toISOString()}`
);

if (!APPLY) {
  console.log("\nDRY RUN — no writes. Re-run with --apply.");
  await c.close();
  process.exit(0);
}

const now = new Date();
const endsAt = new Date(effectiveNow.getTime() + DURATION_HOURS * 3_600_000);
const endsOnTurn = currentTurn + DURATION_HOURS;
for (const role of stranded) {
  // Same shape as the shipped openers: fail dangling nominations, then write
  // BOTH close anchors so the race does not read as closed the moment it opens.
  const nomRes = await db
    .collection(role.nominations)
    .updateMany(
      { ...role.nominationFilter, status: { $in: ["open", "voting"] } },
      { $set: { status: "failed", updatedAt: now } }
    );
  const res = await db.collection(role.collection).updateOne(
    { _id: role.id },
    {
      $set: {
        _id: role.id,
        status: "voting",
        startedAt: now,
        endsAt,
        endsOnTurn,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
  const after = await db.collection(role.collection).findOne({ _id: role.id });
  console.log(
    `${role.leaderRole}: nominations failed=${nomRes.modifiedCount}, matched=${res.matchedCount} modified=${res.modifiedCount} upserted=${res.upsertedCount} -> ${after.status} endsOnTurn=${after.endsOnTurn} closed=${isClosed(after)}`
  );
}
await c.close();
