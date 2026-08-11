/**
 * Heal migration: correct CorporateSector rows whose `revenue` was written in ₳
 * instead of the owning corp's local currency.
 *
 * ROOT CAUSE (fixed separately in the API routes):
 *   - `POST /api/country/[code]/region/[id]/economy/attack` (split route)
 *   - `POST /api/corporations/[id]/sectors` (expand route)
 *   - `POST /api/country/[code]/region/[id]/economy/attack-sector` (takeover)
 *   All three wrote raw ₳ values into `sector.revenue` after the v0.2.6 forex
 *   migration flipped that field to the owning corp's `liquidCurrencyCode`.
 *   For JP corps (fx ≈ 133), the GET economy route then divided again when
 *   reading back, displaying sectors at ~1/133 of actual capture — e.g. the
 *   user's "0.14% instead of 18%" complaint.
 *
 * HEAL STRATEGY:
 *   A corrupt row's stored value is the ₳-value expressed as-if-local. To
 *   convert it to proper local denomination: `newStored = stored × fx`. The
 *   turn processor's read/write cycle is self-consistent regardless of
 *   denomination (it reads via /fx then writes via ×fx), so the growth arc
 *   since the bug occurred is preserved by this single multiplication.
 *
 * IDENTIFICATION:
 *   For each sector whose owning corp has a liquidCurrencyCode with fx > 10
 *   (effectively JPY on live today), compute anchor rev (stored/fx) and
 *   compare to the peer-median anchor rev for (stateId, sectorType). Rows
 *   whose anchor is < 10% of peer median with ≥2 peers are flagged.
 *
 *   Rows with fewer than 2 peers are reported but NOT auto-healed — they
 *   have no reliable peer-median baseline and need manual review.
 *
 * USAGE:
 *   # Dry-run (default — prints report, writes nothing)
 *   npx tsx scripts/migrations/heal-sector-revenue-anchor-bug.ts
 *
 *   # Apply (after reviewing dry-run output)
 *   npx tsx scripts/migrations/heal-sector-revenue-anchor-bug.ts --apply
 *
 *   Requires MONGODB_URI in .env.local.
 *
 * IDEMPOTENCY:
 *   Marker `migrationsRun._id = "heal-sector-revenue-anchor-bug"`. Re-running
 *   with --apply after the marker is set is a no-op. A clean dry-run never
 *   writes the marker.
 */
import { connectDb, closeDb } from "../utils/db";
import { resolveCorpLiquidCurrencyCode } from "../../src/lib/currency/corporationCapital";
import type { Corporation, CorporateSector } from "../../src/lib/db/types";
import type { ExchangeRate } from "../../src/lib/db/types";

const MARKER_ID = "heal-sector-revenue-anchor-bug";
// Only corps whose fx rate is this high show visible corruption. (JPY ~133.)
// GBP/EUR would also be affected but by a small factor (~1.1–1.2×) that's
// indistinguishable from natural variance.
const FX_THRESHOLD = 10;
// Rows whose anchor rev is below this fraction of peer-median are flagged.
const PEER_RATIO_CUTOFF = 0.1;
// Need at least this many peers for a reliable median.
const MIN_PEERS = 2;

function fmt(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return String(n);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await connectDb();

  const marker = await db
    .collection<{ _id: string; ranAt: Date; [key: string]: unknown }>("migrationsRun")
    .findOne({ _id: MARKER_ID });
  if (marker && apply) {
    console.log(`Marker "${MARKER_ID}" already set. Skipping.`);
    await closeDb();
    return;
  }

  const fxDocs = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();
  const fxByCurrency = new Map<string, number>();
  for (const d of fxDocs) {
    if (d.rate && d.rate > 0) fxByCurrency.set(d.currencyCode, d.rate);
  }

  const corps = await db
    .collection<Corporation>("corporations")
    .find(
      {},
      {
        projection: { _id: 1, sequentialId: 1, name: 1, countryId: 1, liquidCurrencyCode: 1 },
      }
    )
    .toArray();
  const corpById = new Map(corps.map((c) => [c._id.toString(), c]));

  const sectors = await db.collection<CorporateSector>("corporateSectors").find({}).toArray();
  console.log(
    `Scanning ${sectors.length} sectors across ${corps.length} corps` +
      ` (${apply ? "APPLY MODE" : "DRY-RUN"})…`
  );

  type Row = {
    sector: CorporateSector;
    corpSeq: number | undefined;
    corpName: string;
    currency: string | undefined;
    fx: number;
    anchor: number;
  };
  const rows: Row[] = [];
  for (const s of sectors) {
    const corp = corpById.get(s.corporationId.toString());
    if (!corp) continue;
    const currency = resolveCorpLiquidCurrencyCode(corp);
    const fx = currency ? (fxByCurrency.get(currency) ?? 1) : 1;
    const anchor = currency ? s.revenue / fx : s.revenue;
    rows.push({ sector: s, corpSeq: corp.sequentialId, corpName: corp.name, currency, fx, anchor });
  }

  // Peer median (anchor) per (stateId, sectorType)
  const peerAnchors = new Map<string, number[]>();
  for (const r of rows) {
    const k = `${r.sector.stateId}:${r.sector.sectorType}`;
    const arr = peerAnchors.get(k) ?? [];
    arr.push(r.anchor);
    peerAnchors.set(k, arr);
  }
  const peerMedian = new Map<string, { median: number; count: number }>();
  for (const [k, arr] of peerAnchors) {
    arr.sort((a, b) => a - b);
    peerMedian.set(k, { median: arr[Math.floor(arr.length / 2)], count: arr.length });
  }

  // Identify candidates. Split into auto-heal-eligible and skipped-for-review.
  type HealPlan = Row & { peerMedian: number; peerCount: number; newStored: number };
  const healPlans: HealPlan[] = [];
  const lowPeerCount: Array<Row & { peerMedian: number; peerCount: number }> = [];

  for (const r of rows) {
    if (r.fx < FX_THRESHOLD) continue; // only high-fx currencies show visible corruption
    const k = `${r.sector.stateId}:${r.sector.sectorType}`;
    const peer = peerMedian.get(k);
    if (!peer || peer.median <= 0) continue;
    const ratio = r.anchor / peer.median;
    if (ratio >= PEER_RATIO_CUTOFF) continue;

    if (peer.count < MIN_PEERS) {
      lowPeerCount.push({ ...r, peerMedian: peer.median, peerCount: peer.count });
      continue;
    }

    const newStored = Math.round(r.sector.revenue * r.fx);
    healPlans.push({ ...r, peerMedian: peer.median, peerCount: peer.count, newStored });
  }

  healPlans.sort((a, b) => a.anchor - b.anchor);

  console.log(`\n=== ${healPlans.length} row(s) to heal ===`);
  console.log(
    "corp                          | state | type                 | fx    | stored         | newStored         | anchor (before→after)"
  );
  console.log(
    "------------------------------+-------+----------------------+-------+----------------+-------------------+-----------------------"
  );
  for (const h of healPlans) {
    const newAnchor = h.newStored / h.fx;
    // The single-multiplication heal: newStored = stored × fx. After the heal,
    // the GET route converts via /fx, giving `stored` back as the ₳ anchor.
    // So "anchor after" = the old stored value (the bug value written as ₳).
    console.log(
      [
        `#${String(h.corpSeq ?? "").padStart(3)} ${String(h.corpName).slice(0, 26).padEnd(26)}`,
        h.sector.stateId.padEnd(5),
        h.sector.sectorType.padEnd(20),
        fmt(h.fx).padStart(5),
        fmt(h.sector.revenue).padStart(14),
        fmt(h.newStored).padStart(17),
        `${fmt(h.anchor)} → ${fmt(newAnchor)}`,
      ].join(" | ")
    );
  }

  if (lowPeerCount.length > 0) {
    console.log(
      `\n=== ${lowPeerCount.length} row(s) flagged but SKIPPED (fewer than ${MIN_PEERS} peers) — manual review needed ===`
    );
    for (const r of lowPeerCount) {
      console.log(
        `  #${r.corpSeq} ${r.corpName} — ${r.sector.stateId}/${r.sector.sectorType} stored=${fmt(r.sector.revenue)} anchor=${fmt(r.anchor)} (${r.peerCount} peer)`
      );
    }
  }

  if (!apply) {
    console.log(
      `\nDry-run complete. Re-run with --apply to write these ${healPlans.length} update(s).`
    );
    await closeDb();
    return;
  }

  if (healPlans.length === 0) {
    console.log("\nNothing to heal.");
    await db
      .collection<{ _id: string; ranAt: Date; [key: string]: unknown }>("migrationsRun")
      .updateOne(
        { _id: MARKER_ID },
        { $set: { _id: MARKER_ID, ranAt: new Date(), healedCount: 0 } },
        { upsert: true }
      );
    await closeDb();
    return;
  }

  console.log(`\nApplying ${healPlans.length} update(s)…`);
  const now = new Date();
  const ops = healPlans.map((h) => ({
    updateOne: {
      filter: { _id: h.sector._id },
      update: { $set: { revenue: h.newStored, updatedAt: now } },
    },
  }));
  const res = await db.collection<CorporateSector>("corporateSectors").bulkWrite(ops);
  console.log(`Modified ${res.modifiedCount} row(s).`);

  await db
    .collection<{ _id: string; ranAt: Date; [key: string]: unknown }>("migrationsRun")
    .updateOne(
      { _id: MARKER_ID },
      {
        $set: {
          _id: MARKER_ID,
          ranAt: new Date(),
          healedCount: res.modifiedCount,
          skippedLowPeerCount: lowPeerCount.length,
        },
      },
      { upsert: true }
    );
  console.log(`Marker "${MARKER_ID}" set.`);

  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
