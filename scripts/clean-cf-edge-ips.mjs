/**
 * One-shot data-hygiene: neutralize legacy Cloudflare edge IPs stored on user
 * records and login activity rows.
 *
 * Before getClientIp() was fixed to prefer `cf-connecting-ip` (see
 * src/lib/utils/network.ts), the app sometimes recorded Cloudflare's own edge
 * address (from x-forwarded-for) as the player's IP. The real client IP for
 * those historical rows is unrecoverable — this script clears the poisoned
 * values so they are never shown as "the user's IP" or used for display.
 *
 * Alt-detection scoring already guards CF-edge IPs to weight 0
 * (isCloudflareEdgeIp in src/lib/utils/cloudflareIpRanges.ts), so this is
 * display / data-hygiene, not a scoring fix. New logins are correct going
 * forward because getClientIp() trusts cf-connecting-ip first.
 *
 * Targets:
 *   - users.registrationIp / users.lastKnownIp (CF-edge values only)
 *   - users.ipDetails when ipDetails.ip is a CF-edge value (whole object)
 *   - activityLog.ipAddress on login/logout rows (CF-edge values only)
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Run:
 *   node scripts/clean-cf-edge-ips.mjs
 *   railway run --service "Main Site" node scripts/clean-cf-edge-ips.mjs
 *   railway run --service "Main Site" node scripts/clean-cf-edge-ips.mjs --apply
 */

const APPLY = process.argv.includes("--apply");

const MONGO_URL = process.env.MONGODB_URI || process.env.MONGO_URL;
if (!MONGO_URL) {
  throw new Error("Set MONGODB_URI (or MONGO_URL) before running this script.");
}
const DB_NAME = process.env.MONGODB_DB || process.env.MONGO_DB_NAME || "a-house-divided";

const SAMPLE_LIMIT = 8;

// ── Cloudflare edge detection (mirrors src/lib/utils/cloudflareIpRanges.ts) ─

const CLOUDFLARE_IPV4_CIDRS = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];

const CLOUDFLARE_IPV6_PREFIXES = [
  "2400:cb00:",
  "2606:4700:",
  "2803:f800:",
  "2405:b500:",
  "2405:8100:",
  "2a06:98c",
  "2c0f:f248:",
];

function ipv4ToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    result = (result << 8) | octet;
  }
  return result >>> 0;
}

const PARSED_CIDRS = CLOUDFLARE_IPV4_CIDRS.map((cidr) => {
  const [base, bits] = cidr.split("/");
  const prefixLength = Number(bits);
  const baseInt = ipv4ToInt(base);
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return { base: baseInt & mask, mask };
});

/** @param {string} ip */
function isCloudflareEdgeIp(ip) {
  if (!ip || typeof ip !== "string") return false;
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return CLOUDFLARE_IPV6_PREFIXES.some((prefix) => lower.startsWith(prefix));
  }
  const asInt = ipv4ToInt(ip);
  if (asInt === null) return false;
  return PARSED_CIDRS.some(({ base, mask }) => (asInt & mask) === base);
}

function withDirectConnection(uri) {
  if (uri.includes("directConnection=")) return uri;
  return `${uri}${uri.includes("?") ? "&" : "?"}directConnection=true`;
}

function redactUri(uri) {
  return uri.replace(/\/\/[^@]*@/, "//***:***@");
}

// ── Main ─────────────────────────────────────────────────────────────────────

const { MongoClient } = await import("mongodb");

const directUri = withDirectConnection(MONGO_URL);
const client = new MongoClient(directUri, { serverSelectionTimeoutMS: 15000 });

await client.connect();
const db = client.db(DB_NAME);

console.log(`DB: ${db.databaseName} | mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
console.log(`Mongo: ${redactUri(directUri)}\n`);

const userStats = {
  scanned: 0,
  withPoisonedRegistrationIp: 0,
  withPoisonedLastKnownIp: 0,
  withPoisonedIpDetails: 0,
  usersNeedingCleanup: 0,
  fieldsCleared: { registrationIp: 0, lastKnownIp: 0, ipDetails: 0 },
};

const activityStats = {
  scanned: 0,
  withPoisonedIpAddress: 0,
  fieldsCleared: 0,
};

/** @type {Array<{ userId: string, username?: string, fields: string[] }>} */
const userSamples = [];
/** @type {Array<{ logId: string, userId?: string, type?: string, ipAddress: string }>} */
const activitySamples = [];

/** @type {import("mongodb").AnyBulkWriteOperation[]} */
const userBulkOps = [];
/** @type {import("mongodb").AnyBulkWriteOperation[]} */
const activityBulkOps = [];

const userCursor = db.collection("users").find(
  {
    $or: [
      { registrationIp: { $type: "string" } },
      { lastKnownIp: { $type: "string" } },
      { "ipDetails.ip": { $type: "string" } },
    ],
  },
  {
    projection: {
      username: 1,
      registrationIp: 1,
      lastKnownIp: 1,
      ipDetails: 1,
    },
  }
);

for await (const user of userCursor) {
  userStats.scanned++;

  const poisonedFields = [];
  if (isCloudflareEdgeIp(user.registrationIp)) {
    userStats.withPoisonedRegistrationIp++;
    poisonedFields.push("registrationIp");
  }
  if (isCloudflareEdgeIp(user.lastKnownIp)) {
    userStats.withPoisonedLastKnownIp++;
    poisonedFields.push("lastKnownIp");
  }
  if (user.ipDetails?.ip && isCloudflareEdgeIp(user.ipDetails.ip)) {
    userStats.withPoisonedIpDetails++;
    poisonedFields.push("ipDetails");
  }

  if (poisonedFields.length === 0) continue;

  userStats.usersNeedingCleanup++;
  if (userSamples.length < SAMPLE_LIMIT) {
    userSamples.push({
      userId: user._id.toString(),
      username: user.username,
      fields: poisonedFields,
    });
  }

  const $unset = {};
  for (const field of poisonedFields) {
    $unset[field] = "";
    userStats.fieldsCleared[field]++;
  }

  userBulkOps.push({
    updateOne: {
      filter: { _id: user._id },
      update: { $unset },
    },
  });
}

const activityCursor = db.collection("activityLog").find(
  {
    ipAddress: { $type: "string" },
    type: { $in: ["login", "logout"] },
  },
  {
    projection: {
      userId: 1,
      type: 1,
      ipAddress: 1,
      timestamp: 1,
    },
  }
);

for await (const log of activityCursor) {
  activityStats.scanned++;
  if (!isCloudflareEdgeIp(log.ipAddress)) continue;

  activityStats.withPoisonedIpAddress++;
  if (activitySamples.length < SAMPLE_LIMIT) {
    activitySamples.push({
      logId: log._id.toString(),
      userId: log.userId?.toString(),
      type: log.type,
      ipAddress: log.ipAddress,
    });
  }

  activityBulkOps.push({
    updateOne: {
      filter: { _id: log._id },
      update: { $unset: { ipAddress: "" } },
    },
  });
  activityStats.fieldsCleared++;
}

console.log("──────────── USERS ────────────");
console.log(`  scanned (has any IP field):     ${userStats.scanned}`);
console.log(`  poisoned registrationIp:        ${userStats.withPoisonedRegistrationIp}`);
console.log(`  poisoned lastKnownIp:           ${userStats.withPoisonedLastKnownIp}`);
console.log(`  poisoned ipDetails.ip:          ${userStats.withPoisonedIpDetails}`);
console.log(`  users needing cleanup:          ${userStats.usersNeedingCleanup}`);

if (userSamples.length > 0) {
  console.log("\n  sample users (dry-run preview):");
  for (const row of userSamples) {
    console.log(`    ${row.userId} @${row.username ?? "?"} → unset ${row.fields.join(", ")}`);
  }
  if (userStats.usersNeedingCleanup > userSamples.length) {
    console.log(`    … and ${userStats.usersNeedingCleanup - userSamples.length} more`);
  }
}

console.log("\n──────────── ACTIVITY LOG (login/logout) ────────────");
console.log(`  scanned (has ipAddress):        ${activityStats.scanned}`);
console.log(`  poisoned ipAddress rows:        ${activityStats.withPoisonedIpAddress}`);

if (activitySamples.length > 0) {
  console.log("\n  sample activity rows:");
  for (const row of activitySamples) {
    console.log(
      `    ${row.logId} user=${row.userId ?? "?"} type=${row.type ?? "?"} ip=${row.ipAddress}`
    );
  }
  if (activityStats.withPoisonedIpAddress > activitySamples.length) {
    console.log(`    … and ${activityStats.withPoisonedIpAddress - activitySamples.length} more`);
  }
}

if (APPLY) {
  console.log("\n──────────── APPLY ────────────");
  if (userBulkOps.length > 0) {
    const userResult = await db.collection("users").bulkWrite(userBulkOps, { ordered: false });
    console.log(
      `  users: ${userResult.modifiedCount} modified (${userBulkOps.length} updates queued)`
    );
  } else {
    console.log("  users: nothing to modify");
  }

  if (activityBulkOps.length > 0) {
    const activityResult = await db.collection("activityLog").bulkWrite(activityBulkOps, {
      ordered: false,
    });
    console.log(
      `  activityLog: ${activityResult.modifiedCount} modified (${activityBulkOps.length} updates queued)`
    );
  } else {
    console.log("  activityLog: nothing to modify");
  }
} else {
  console.log("\n──────────── DRY-RUN (no writes) ────────────");
  console.log(`  would unset on users:`);
  console.log(`    registrationIp: ${userStats.fieldsCleared.registrationIp}`);
  console.log(`    lastKnownIp:    ${userStats.fieldsCleared.lastKnownIp}`);
  console.log(`    ipDetails:      ${userStats.fieldsCleared.ipDetails}`);
  console.log(`  would unset activityLog.ipAddress: ${activityStats.fieldsCleared}`);
  console.log(
    "\n  Re-run with --apply to write. Idempotent: second run should report 0 poisoned rows."
  );
}

await client.close();
