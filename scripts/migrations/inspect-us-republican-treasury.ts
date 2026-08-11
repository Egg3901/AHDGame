/**
 * Read-only investigation: US Republican Party (sequentialId=2, countryId="US")
 * — surfaces the largest recent treasury swings.
 *
 * Sources, in order of trust:
 *   1. financialTxLog — authoritative per-event ledger (TTL 96h, so only
 *      the last ~4 days of fine-grained events).
 *   2. activityLog (type="fund_event") — persistent record of player-driven
 *      transfers/donations to or from the party.
 *   3. adminLogs — any admin grant / direct edit hitting the party.
 *
 * Pure read; uses MONGODB_URI_LIVE.
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const uri = process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error("MONGODB_URI_LIVE not set");
  process.exit(1);
}

const COUNTRY = "US";
const PARTY_SEQ_ID = 2;
const TOP_N = 25;

function fmt(n: number | undefined | null, digits = 2): string {
  if (n == null) return "(null)";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function iso(d: Date | undefined | null): string {
  return d?.toISOString?.() ?? "(no date)";
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db("a-house-divided");

  // ── Locate the party ─────────────────────────────────────────────────
  const party = await db
    .collection("politicalParties")
    .findOne({ countryId: COUNTRY, sequentialId: PARTY_SEQ_ID });
  if (!party) {
    console.error(`Party ${COUNTRY}/${PARTY_SEQ_ID} not found`);
    await client.close();
    process.exit(1);
  }
  console.log(
    `Party: ${party.name} (${party.abbreviation})  _id=${party._id}  treasury=$${fmt(party.treasury)}`
  );
  console.log(`updatedAt=${iso(party.updatedAt as Date)}\n`);

  const partyId = party._id as ObjectId;

  // ── 1) financialTxLog: largest moves in the last 96h ────────────────
  console.log(`=== financialTxLog (subjectId=party, last 96h, top ${TOP_N} by |amount|) ===`);
  const ftxAll = await db
    .collection("financialTxLog")
    .find({ subjectType: "party", subjectId: partyId })
    .toArray();
  console.log(`  total rows in TTL window: ${ftxAll.length}`);
  const ftxSorted = [...ftxAll].sort(
    (a: any, b: any) => Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0)
  );
  for (const r of ftxSorted.slice(0, TOP_N) as any[]) {
    console.log(
      `  ${iso(r.createdAt)}  T${r.turn}  ${r.type.padEnd(20)}  ${r.amount >= 0 ? "+" : ""}${fmt(r.amount)} ${r.currencyCode}  cpty=${r.counterpartyType ?? ""}:${r.counterpartyName ?? r.counterpartyId?.toString() ?? ""}  bal=${fmt(r.balanceAfter)}  meta=${JSON.stringify(r.meta ?? {})}`
    );
  }

  // Also show the chronological tail of the same window
  console.log(`\n=== financialTxLog (subjectId=party, last 20 chronological) ===`);
  const ftxRecent = [...ftxAll]
    .sort((a: any, b: any) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0))
    .slice(0, 20);
  for (const r of ftxRecent as any[]) {
    console.log(
      `  ${iso(r.createdAt)}  T${r.turn}  ${r.type.padEnd(20)}  ${r.amount >= 0 ? "+" : ""}${fmt(r.amount)} ${r.currencyCode}  cpty=${r.counterpartyType ?? ""}:${r.counterpartyName ?? r.counterpartyId?.toString() ?? ""}`
    );
  }

  // ── 2) financialTxLog where party is the COUNTERPARTY ───────────────
  console.log(`\n=== financialTxLog (counterpartyId=party, top ${TOP_N} by |amount|) ===`);
  const ftxCp = await db
    .collection("financialTxLog")
    .find({ counterpartyType: "party", counterpartyId: partyId })
    .toArray();
  console.log(`  total rows: ${ftxCp.length}`);
  const ftxCpSorted = [...ftxCp].sort(
    (a: any, b: any) => Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0)
  );
  for (const r of ftxCpSorted.slice(0, TOP_N) as any[]) {
    console.log(
      `  ${iso(r.createdAt)}  T${r.turn}  ${r.type.padEnd(20)}  ${r.amount >= 0 ? "+" : ""}${fmt(r.amount)} ${r.currencyCode}  subject=${r.subjectType}:${r.subjectName}  meta=${JSON.stringify(r.meta ?? {})}`
    );
  }

  // ── 3) activityLog fund_events touching this party (persistent) ─────
  console.log(`\n=== activityLog fund_events touching party (top ${TOP_N} by |amount|) ===`);
  const fundEvents = await db
    .collection("activityLog")
    .find({
      type: "fund_event",
      $or: [{ fromId: partyId }, { toId: partyId }],
    })
    .sort({ timestamp: -1 })
    .limit(2000)
    .toArray();
  console.log(`  scanned ${fundEvents.length} most recent fund_events touching the party`);
  const feSorted = [...fundEvents].sort(
    (a: any, b: any) => Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0)
  );
  for (const e of feSorted.slice(0, TOP_N) as any[]) {
    const dir = e.toId?.toString?.() === partyId.toString() ? "IN " : "OUT";
    console.log(
      `  ${iso(e.timestamp)}  ${dir}  ${e.fundEventType.padEnd(18)}  $${fmt(e.amount)}  ${e.fromType}:${e.fromName}  →  ${e.toType}:${e.toName}  by=${e.username}/${e.characterName}`
    );
  }

  // Chronological tail too
  console.log(`\n=== activityLog fund_events (last 20 chronological) ===`);
  for (const e of fundEvents.slice(0, 20) as any[]) {
    const dir = e.toId?.toString?.() === partyId.toString() ? "IN " : "OUT";
    console.log(
      `  ${iso(e.timestamp)}  ${dir}  ${e.fundEventType.padEnd(18)}  $${fmt(e.amount)}  ${e.fromType}:${e.fromName}  →  ${e.toType}:${e.toName}  by=${e.username}/${e.characterName}`
    );
  }

  // ── 4) adminLogs mentioning the party ───────────────────────────────
  console.log(`\n=== adminLogs referencing this party (last 50) ===`);
  const adminLogs = await db
    .collection("adminLogs")
    .find({
      $or: [
        { targetId: partyId },
        { "details.partyId": partyId },
        { "details.partyId": partyId.toString() },
        { details: { $regex: partyId.toString(), $options: "i" } },
      ],
    })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
  console.log(`  count=${adminLogs.length}`);
  for (const l of adminLogs as any[]) {
    console.log(
      `  ${iso(l.createdAt)}  ${l.category}/${l.action}  by=${l.adminUsername ?? l.username ?? "?"}  details=${typeof l.details === "string" ? l.details : JSON.stringify(l.details)}`
    );
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
