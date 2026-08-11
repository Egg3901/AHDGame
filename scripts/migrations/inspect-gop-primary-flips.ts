/**
 * Phase 2 of the investigation: dump *exact* recordedAt timestamps and audit
 * whether enrichment-failure could explain the early-state tie pattern.
 *
 * Pure read.
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const uri = process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error("MONGODB_URI_LIVE not set");
  process.exit(1);
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db("a-house-divided");

  const election = await db.collection("elections").findOne({
    countryId: "US",
    electionType: "president",
    status: "active",
  });
  if (!election) throw new Error("no active US pres election");

  const tally = await db.collection("electionVoteTallies").findOne({ electionId: election._id });
  if (!tally) throw new Error("no tally");

  console.log("=== Wave history (exact timestamps) ===");
  for (const w of tally.primaryWaveHistory ?? []) {
    console.log(
      `  wave=${w.wave} turnsRemaining=${w.turnsRemaining} states=[${(w.statesVoted ?? []).join(",")}] recordedAt=${w.recordedAt instanceof Date ? w.recordedAt.toISOString() : w.recordedAt}`
    );
  }

  // Active GOP candidates
  const candidates = await db
    .collection("electionCandidates")
    .find({ electionId: election._id, party: "2", status: "active" })
    .toArray();
  console.log(`\n=== Active GOP candidates ===`);
  for (const c of candidates) {
    const ch = c.characterId
      ? await db.collection("characters").findOne({ _id: c.characterId })
      : null;
    console.log(
      `  candId=${c._id.toString()} candId-time=${(c._id as any).getTimestamp().toISOString()}\n     characterId=${c.characterId} (type=${typeof c.characterId}, isObjectId=${(c.characterId as any)?._bsontype === "ObjectId" || (c.characterId as any)?.constructor?.name === "ObjectId"})\n     character-found=${ch ? "YES" : "NO"} ${ch ? `(name="${[ch.firstName, ch.lastName].filter(Boolean).join(" ")}", fav=${ch.favorability}, npi=${ch.nationalInfluence}, EP=${ch.policies?.economic}, SP=${ch.policies?.social})` : ""}\n     primaryCampaignState=${c.primaryCampaignState ?? "-"} ticks=${c.primaryCampaignTicks ?? 0}`
    );
  }

  // Also check the third candidate's characterId type on disk via a raw findOne
  const cand3 = candidates.find((c: any) => c._id.toString() === "69ea1ce6ec8544a6a0fb8767");
  if (cand3) {
    console.log(`\n=== Probe: third candidate characterId variants ===`);
    const variants = [cand3.characterId, cand3.characterId?.toString?.()];
    for (const v of variants) {
      const found = await db.collection("characters").findOne({ _id: v as any });
      console.log(
        `  findOne({_id: ${typeof v === "string" ? `"${v}"` : v}}) → ${found ? "FOUND" : "not found"}`
      );
    }
  }

  // Check if any characters have an _id matching the third candidate's characterId STRING
  const stringMatchProbe = await db
    .collection("characters")
    .find({}, { projection: { _id: 1, firstName: 1, lastName: 1 } })
    .limit(1)
    .toArray();
  console.log(`\nSample character _id type: ${stringMatchProbe[0]?._id?.constructor?.name ?? "?"}`);

  // Republican primary delegates and votes summary
  console.log("\n=== Republican primary delegates (cumulative) ===");
  const delegates = tally.primaryDelegates?.["2"] ?? {};
  for (const [cid, d] of Object.entries(delegates).sort(
    (a: any, b: any) => (b[1] as number) - (a[1] as number)
  )) {
    const c = candidates.find((cc: any) => cc._id.toString() === cid);
    const charId = c?.characterId?.toString?.() ?? "?";
    const ch = c?.characterId
      ? await db.collection("characters").findOne({ _id: c.characterId })
      : null;
    const name = ch ? [ch.firstName, ch.lastName].filter(Boolean).join(" ") : "?";
    console.log(`  candId=${cid} (${name}) charId=${charId} delegates=${d}`);
  }

  // For each Super Tuesday state, show actual votes split between top 3 keys with names resolved
  const ST = ["AL", "AR", "CA", "CO", "ME", "MA", "MN", "NC", "OK", "TN", "TX", "UT", "VT", "VA"];
  const EARLY = ["IA", "NH", "NV", "SC"];
  const stateVotes = tally.primaryStateVotes?.["2"] ?? {};

  // Build candId-> name map, also include any character ids the votes map keys to
  const candNameById = new Map<string, string>();
  for (const c of candidates) {
    const ch = c.characterId
      ? await db.collection("characters").findOne({ _id: c.characterId })
      : null;
    const name = ch
      ? [ch.firstName, ch.lastName].filter(Boolean).join(" ")
      : `(no char ${c.characterId})`;
    candNameById.set(c._id.toString(), name);
  }

  function fmtRow(stateId: string) {
    const sv = stateVotes[stateId] ?? {};
    const parts = Object.entries(sv)
      .sort(([, a]: any, [, b]: any) => (b as number) - (a as number))
      .map(([id, v]) => `${candNameById.get(id) ?? `unknown:${id}`}=${v}`);
    console.log(`  ${stateId}: ${parts.join("  |  ")}`);
  }

  console.log("\n=== Early state votes (with resolved names) ===");
  for (const s of EARLY) fmtRow(s);
  console.log("\n=== Super Tuesday votes (with resolved names) ===");
  for (const s of ST) fmtRow(s);

  // Election timeline
  console.log(`\n=== Election timing ===`);
  console.log(`  createdAt: ${election.createdAt?.toISOString?.()}`);
  console.log(`  primaryEndTime: ${election.primaryEndTime?.toISOString?.()}`);
  console.log(`  endTime: ${election.endTime?.toISOString?.() ?? "(unset)"}`);

  // Look at primaryStatePollingHistory — these are the projection snapshots that
  // would have been shown to users between waves.
  console.log(`\n=== primaryStatePollingHistory entries (projection snapshots) ===`);
  const history = tally.primaryStatePollingHistory ?? [];
  console.log(`  ${history.length} snapshots stored`);
  for (let i = 0; i < history.length; i++) {
    const snap = history[i];
    const partyByState = snap.byParty?.["2"] ?? {};
    // For one snapshot, count winners across all stagger states
    const winners: Record<string, number> = {};
    for (const [_st, votes] of Object.entries(partyByState)) {
      const sorted = Object.entries(votes as Record<string, number>).sort(([, a], [, b]) => b - a);
      const w = sorted[0]?.[0];
      if (w) winners[w] = (winners[w] ?? 0) + 1;
    }
    const parts = Object.entries(winners)
      .sort(([, a], [, b]) => b - a)
      .map(([id, c]) => `${candNameById.get(id) ?? `unknown:${id}`}=${c}st`);
    console.log(
      `  [${i}] turn=${snap.turn} recordedAt=${snap.recordedAt instanceof Date ? snap.recordedAt.toISOString() : snap.recordedAt}: ${parts.join(", ")}`
    );
  }

  // Compare snapshot just before ST and the actual ST result
  if (history.length > 0) {
    const lastSnap = history[history.length - 1];
    const prevPart = lastSnap.byParty?.["2"] ?? {};
    console.log(
      `\n=== Last snapshot per-state winners (Republican) — what the UI showed pre-ST ===`
    );
    for (const s of [...EARLY, ...ST]) {
      const votes = (prevPart[s] ?? {}) as Record<string, number>;
      const sorted = Object.entries(votes).sort(([, a], [, b]) => b - a);
      const winnerId = sorted[0]?.[0];
      const winner = winnerId ? (candNameById.get(winnerId) ?? `unknown:${winnerId}`) : "—";
      const margin =
        sorted[0]?.[1] && sorted[1]?.[1] ? sorted[0][1] - sorted[1][1] : (sorted[0]?.[1] ?? 0);
      const recordedSv = (stateVotes[s] ?? {}) as Record<string, number>;
      const recSorted = Object.entries(recordedSv).sort(([, a], [, b]) => b - a);
      const recWinnerId = recSorted[0]?.[0];
      const recWinner = recWinnerId
        ? (candNameById.get(recWinnerId) ?? `unknown:${recWinnerId}`)
        : "—";
      const flag = recWinnerId && winnerId && recWinnerId !== winnerId ? "  ← FLIP" : "";
      console.log(
        `  ${s}: snap=${winner} (${sorted[0]?.[1] ?? 0}, Δ${margin})  vs  recorded=${recWinner} (${recSorted[0]?.[1] ?? 0})${flag}`
      );
    }
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
