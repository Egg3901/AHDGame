/**
 * Heal corporate / imperial shareholders lost to the reverse-split allocator bug.
 *
 * Background
 * ----------
 * Before the `fix/reverse-split-shares-bug` branch landed, every CEO-driven
 * stock split / reverse split in `src/lib/corporations/shareConsolidation.ts`
 * silently dropped every shareholder row whose owner was an `imperialCharacterId`
 * or `corporationId`. Their share weight was absorbed into the remaining
 * `characterId` holders (and `publicFloat`). Market cap was preserved, but the
 * dropped holders lost 100 % of their position. 57 corporations currently
 * have `lastShareStructureTurn` set and therefore ran the buggy path at least
 * once.
 *
 * Strategy
 * --------
 * There is NO per-corp per-holder historical snapshot in the DB, so precise
 * restoration is not possible from data alone. What we do have:
 *   - `corporationHistory`     — per-turn sharePrice + totalShares per corp
 *   - `corporationPortfolioHistory` — per-turn aggregate stockValue per corp-holder (₳)
 *   - `portfolioHistory`       — per-turn aggregate stockValue per character/imperial (₳)
 *
 * The repair therefore operates in three passes:
 *
 *   PASS A  For each split corp Y at turn T, compute the per-holder stockValue
 *           drop between T-1 and T+1. A drop is suspicious when it's close to
 *           the holder's pre-split total portfolio (near-total wipe → very high
 *           confidence) OR when the drop's ₳ magnitude is consistent with a
 *           position in Y valued at Y's pre-split share price.
 *
 *   PASS B  For each suspected victim (H, Y), estimate the post-split shares
 *           that should have been allocated:
 *              lostValueAnchor = drop in H's portfolio at turn T
 *              preSplitPriceLocal = Y.sharePrice at turn T-1
 *              preSplitShares   = round(lostValueAnchor_in_Y_local / preSplitPriceLocal)
 *              targetShares     = round(preSplitShares * (newTotal / oldTotal))
 *
 *   PASS C  If `--apply` is passed, rebalance Y's current shareholders by:
 *              (a) pushing a new entry {H, targetShares, avgCostPerShare ≈ current_price}
 *              (b) deducting `targetShares` proportionally from the current
 *                  character/float holders (because the bug overallocated them
 *                  by exactly that amount).
 *           totalShares and sharePrice are NOT changed (market cap preserved).
 *
 * Caveats / non-goals
 * -------------------
 *   - The drop attribution is fuzzy when H held positions in multiple corps
 *     that split in the same turn (rare in the current data).
 *   - Drops caused by legitimate sales in the same turn will be mis-attributed.
 *     The report prints per-holder confidence flags so the operator can review.
 *   - Currency conversion uses the exchange rate at turn T from `exchangeRates`.
 *     If an FX row is missing we fall back to 1.0 (anchor-denominated) and
 *     mark the row LOW confidence.
 *   - No portfolioHistory / corporationPortfolioHistory rows are rewritten —
 *     only the current corporation documents are adjusted.
 *
 * Usage
 * -----
 *   npx tsx scripts/migrations/heal-reverse-split-shareholders.ts           # dry-run report
 *   npx tsx scripts/migrations/heal-reverse-split-shareholders.ts --apply   # commit changes
 *   npx tsx scripts/migrations/heal-reverse-split-shareholders.ts --seq 217 # restrict to one corp
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const uri = process.env.MONGODB_URI_LIVE;
if (!uri) throw new Error("MONGODB_URI_LIVE must be set in .env.local");

const APPLY = process.argv.includes("--apply");
const seqArgIdx = process.argv.indexOf("--seq");
const ONLY_SEQ = seqArgIdx >= 0 ? Number(process.argv[seqArgIdx + 1]) : null;

// --- Types local to this script (avoid coupling to src/) ---
type OID = ObjectId;
interface Shareholder {
  characterId?: OID;
  imperialCharacterId?: OID;
  corporationId?: OID;
  shares: number;
  avgCostPerShare?: number;
}
interface Corporation {
  _id: OID;
  sequentialId?: number;
  name: string;
  countryId: string;
  totalShares: number;
  sharePrice: number;
  publicFloat?: number;
  shareholders: Shareholder[];
  lastShareStructureTurn?: number | null;
  liquidCurrencyCode?: string;
}
interface CorpHistRow {
  corporationId: OID;
  turn: number;
  sharePrice: number;
  totalShares: number;
  currencyCode?: string;
}
type Confidence = "high" | "medium" | "low";

interface VictimEstimate {
  holderKind: "character" | "imperial" | "corporation";
  holderId: OID;
  holderLabel: string;
  stockValueBefore: number;
  stockValueAfter: number;
  dropAnchor: number;
  preSplitShares: number;
  targetSharesPostSplit: number;
  confidence: Confidence;
  reason: string;
}

interface CorpRepairPlan {
  corpId: OID;
  seq: number | undefined;
  name: string;
  splitTurn: number;
  oldTotalShares: number;
  newTotalShares: number;
  preSplitPriceLocal: number;
  currencyCode: string;
  fxRateAtSplit: number;
  victims: VictimEstimate[];
}

function keyOfHolder(h: Shareholder): string | null {
  if (h.characterId) return `char:${h.characterId.toString()}`;
  if (h.imperialCharacterId) return `imp:${h.imperialCharacterId.toString()}`;
  if (h.corporationId) return `corp:${h.corporationId.toString()}`;
  return null;
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  try {
    const db = client.db("a-house-divided");
    const corporations = db.collection<Corporation>("corporations");

    const filter: Record<string, unknown> = { lastShareStructureTurn: { $ne: null } };
    if (ONLY_SEQ != null) filter.sequentialId = ONLY_SEQ;

    const splitCorps = await corporations.find(filter).toArray();
    console.log(
      `[${APPLY ? "APPLY" : "DRY-RUN"}] Found ${splitCorps.length} split corp(s) to evaluate.${ONLY_SEQ != null ? ` (filtered to seq=${ONLY_SEQ})` : ""}\n`
    );

    // Character → name map for labeling
    const [characters, imperialCharacters, corporationsAll] = await Promise.all([
      db
        .collection<{ _id: OID; name: string }>("characters")
        .find({})
        .project({ name: 1 })
        .toArray(),
      db
        .collection<{ _id: OID; name: string }>("imperialCharacters")
        .find({})
        .project({ name: 1 })
        .toArray(),
      corporations
        .find({})
        .project<{ _id: OID; name: string; sequentialId?: number }>({ name: 1, sequentialId: 1 })
        .toArray(),
    ]);
    const charName = new Map(characters.map((c) => [c._id.toString(), c.name]));
    const imperialName = new Map(imperialCharacters.map((c) => [c._id.toString(), c.name]));
    const corpName = new Map(
      corporationsAll.map((c) => [c._id.toString(), `${c.name} (seq ${c.sequentialId ?? "?"})`])
    );

    const plans: CorpRepairPlan[] = [];

    for (const Y of splitCorps) {
      const T = Y.lastShareStructureTurn!;
      const localCcy = Y.liquidCurrencyCode ?? countryToCurrency(Y.countryId);

      // --- PASS A: gather pre/post portfolio snapshots for every holder ---
      const corpHist = await db
        .collection<{
          corporationId: OID;
          turn: number;
          stockValue: number;
        }>("corporationPortfolioHistory")
        .find({ turn: { $gte: T - 1, $lte: T + 1 } })
        .project<{ corporationId: OID; turn: number; stockValue: number }>({
          corporationId: 1,
          turn: 1,
          stockValue: 1,
        })
        .toArray();
      const charHist = await db
        .collection<{
          characterId: OID;
          turn: number;
          stockValue: number;
        }>("portfolioHistory")
        .find({ turn: { $gte: T - 1, $lte: T + 1 } })
        .project<{ characterId: OID; turn: number; stockValue: number }>({
          characterId: 1,
          turn: 1,
          stockValue: 1,
        })
        .toArray();

      // Pre-split sharePrice (local) + totalShares (absolute) from corporationHistory at T-1
      const preRow = await db
        .collection<CorpHistRow>("corporationHistory")
        .findOne({ corporationId: Y._id, turn: T - 1 });
      const preSplitPriceLocal = preRow?.sharePrice ?? Y.sharePrice;
      const oldTotalShares = preRow?.totalShares ?? Y.totalShares;
      const newTotalShares = Y.totalShares;

      // FX rate for Y's currency at T. If absent, fall back to 1 (degrade confidence).
      const fxDoc = localCcy
        ? await db
            .collection<{ currencyCode: string; rate: number }>("exchangeRates")
            .findOne({ currencyCode: localCcy })
        : null;
      const fxRateAtSplit = fxDoc?.rate ?? 1;

      const byHolder = new Map<
        string,
        { kind: "corporation"; id: OID; series: Map<number, number> }
      >();
      for (const row of corpHist) {
        const key = row.corporationId.toString();
        const existing = byHolder.get(key) ?? {
          kind: "corporation" as const,
          id: row.corporationId,
          series: new Map<number, number>(),
        };
        existing.series.set(row.turn, row.stockValue);
        byHolder.set(key, existing);
      }

      const byCharHolder = new Map<
        string,
        { kind: "character" | "imperial"; id: OID; series: Map<number, number> }
      >();
      for (const row of charHist) {
        const key = row.characterId.toString();
        const isImperial = imperialName.has(key);
        const existing = byCharHolder.get(key) ?? {
          kind: isImperial ? ("imperial" as const) : ("character" as const),
          id: row.characterId,
          series: new Map<number, number>(),
        };
        existing.series.set(row.turn, row.stockValue);
        byCharHolder.set(key, existing);
      }

      // --- PASS B: estimate lost positions ---
      const victims: VictimEstimate[] = [];
      const considerDrop = (
        kind: "character" | "imperial" | "corporation",
        holderId: OID,
        series: Map<number, number>
      ) => {
        // Only rescue imperial and corp holders — character-holders were not
        // subject to the bug (they were the ones that absorbed the dropped shares).
        if (kind === "character") return;

        const before = series.get(T - 1);
        const after = series.get(T) ?? series.get(T + 1);
        if (before == null || after == null) return;
        const drop = before - after;
        if (drop <= 0) return;

        // Position-in-Y inferred from anchor drop / Y local price, scaled by FX.
        // lost_value_local ≈ drop_anchor * fxRate
        const lostValueLocal = drop * fxRateAtSplit;
        const preSplitShares = Math.round(lostValueLocal / Math.max(preSplitPriceLocal, 1e-9));
        if (preSplitShares <= 0) return;

        const targetSharesPostSplit = Math.round(
          (preSplitShares * newTotalShares) / Math.max(oldTotalShares, 1)
        );
        if (targetSharesPostSplit <= 0) return;

        let confidence: Confidence = "low";
        let reason = "drop < 90 % of holder portfolio — could reflect unrelated sales";
        if (drop >= before * 0.95) {
          confidence = "high";
          reason = `drop ≈ full portfolio wipe (${((100 * drop) / before).toFixed(1)}%)`;
        } else if (drop >= before * 0.5) {
          confidence = "medium";
          reason = `drop ${((100 * drop) / before).toFixed(1)}% of portfolio — partial wipe plausible`;
        }

        if (!fxDoc && localCcy && localCcy !== "A") {
          confidence = "low";
          reason += " + missing FX row for " + localCcy;
        }

        const label =
          kind === "corporation"
            ? (corpName.get(holderId.toString()) ?? holderId.toString())
            : kind === "imperial"
              ? (imperialName.get(holderId.toString()) ?? holderId.toString())
              : (charName.get(holderId.toString()) ?? holderId.toString());

        victims.push({
          holderKind: kind,
          holderId,
          holderLabel: label,
          stockValueBefore: before,
          stockValueAfter: after,
          dropAnchor: drop,
          preSplitShares,
          targetSharesPostSplit,
          confidence,
          reason,
        });
      };

      for (const v of byHolder.values()) considerDrop(v.kind, v.id, v.series);
      for (const v of byCharHolder.values()) considerDrop(v.kind, v.id, v.series);

      // Drop victims already present in current shareholders (already restored)
      const currentOwners = new Set(
        (Y.shareholders ?? []).map(keyOfHolder).filter((k): k is string => k != null)
      );
      const filteredVictims = victims.filter((v) => {
        const k =
          v.holderKind === "character"
            ? `char:${v.holderId.toString()}`
            : v.holderKind === "imperial"
              ? `imp:${v.holderId.toString()}`
              : `corp:${v.holderId.toString()}`;
        return !currentOwners.has(k);
      });

      if (filteredVictims.length === 0) continue;

      plans.push({
        corpId: Y._id,
        seq: Y.sequentialId,
        name: Y.name,
        splitTurn: T,
        oldTotalShares,
        newTotalShares,
        preSplitPriceLocal,
        currencyCode: localCcy ?? "?",
        fxRateAtSplit,
        victims: filteredVictims.sort((a, b) => b.targetSharesPostSplit - a.targetSharesPostSplit),
      });
    }

    // --- Emit report ---
    console.log(`\n=== Repair Report (${plans.length} corp(s) need attention) ===\n`);
    for (const p of plans) {
      console.log(
        `Corp ${p.seq ?? "?"} "${p.name}"  splitTurn=${p.splitTurn}  oldTotal=${p.oldTotalShares}  newTotal=${p.newTotalShares}  preSplitPrice=${p.preSplitPriceLocal} ${p.currencyCode}  fx=${p.fxRateAtSplit}`
      );
      for (const v of p.victims) {
        console.log(
          `    [${v.confidence.toUpperCase()}] ${v.holderKind.padEnd(11)} ${v.holderLabel}`
        );
        console.log(
          `       drop=${v.dropAnchor.toFixed(0)} ₳ (before=${v.stockValueBefore.toFixed(0)} after=${v.stockValueAfter.toFixed(0)})`
        );
        console.log(
          `       preSplitShares=${v.preSplitShares}  targetPostSplitShares=${v.targetSharesPostSplit}`
        );
        console.log(`       reason: ${v.reason}`);
      }
      console.log("");
    }

    // --- PASS C: apply if requested ---
    if (!APPLY) {
      console.log("\n(dry-run) rerun with --apply to commit changes.");
      return;
    }

    console.log("\n=== Applying repairs ===\n");
    for (const p of plans) {
      const highConf = p.victims.filter((v) => v.confidence === "high");
      if (highConf.length === 0) {
        console.log(
          `  Corp ${p.seq ?? p.corpId} — no HIGH-confidence victims; skipping (review MEDIUM/LOW manually).`
        );
        continue;
      }
      const totalRestore = highConf.reduce((s, v) => s + v.targetSharesPostSplit, 0);

      const latestCorp = await corporations.findOne({ _id: p.corpId });
      if (!latestCorp) continue;

      const newShareholders = (latestCorp.shareholders ?? []).map((h) => ({ ...h }));
      const currentFloat = latestCorp.publicFloat ?? 0;

      // Deduct proportionally from current character holders + float.
      // Float-first: it's "unclaimed" shares, least disruptive to real players.
      let remaining = totalRestore;
      let newPublicFloat = currentFloat;
      if (newPublicFloat > 0) {
        const fromFloat = Math.min(newPublicFloat, remaining);
        newPublicFloat -= fromFloat;
        remaining -= fromFloat;
      }
      if (remaining > 0) {
        const charHolders = newShareholders.filter((h) => h.characterId && h.shares > 0);
        const charTotal = charHolders.reduce((s, h) => s + h.shares, 0);
        if (charTotal <= 0) {
          console.log(
            `  Corp ${p.seq ?? p.corpId} — insufficient float and no character holders to rebalance; SKIPPED.`
          );
          continue;
        }
        // Largest-remainder deduction so totals match.
        const floors = charHolders.map((h) => Math.floor((h.shares * remaining) / charTotal));
        const fracs = charHolders.map((h, i) => ({
          i,
          frac: (h.shares * remaining) / charTotal - floors[i]!,
        }));
        const allocated = floors.reduce((s, n) => s + n, 0);
        const leftover = remaining - allocated;
        fracs.sort((a, b) => b.frac - a.frac);
        const deducts = [...floors];
        for (let k = 0; k < leftover; k++) deducts[fracs[k]!.i]!++;
        for (let i = 0; i < charHolders.length; i++) {
          charHolders[i]!.shares -= deducts[i]!;
        }
      }

      // Append victim entries
      for (const v of highConf) {
        const entry: Shareholder = { shares: v.targetSharesPostSplit };
        if (v.holderKind === "character") entry.characterId = v.holderId;
        else if (v.holderKind === "imperial") entry.imperialCharacterId = v.holderId;
        else entry.corporationId = v.holderId;
        // Best-effort avgCostPerShare: current market price.
        entry.avgCostPerShare = latestCorp.sharePrice;
        newShareholders.push(entry);
      }

      // Drop any zero-share rows that fell out of rebalancing.
      const cleaned = newShareholders.filter((h) => h.shares > 0);

      // Verify totals unchanged.
      const sumAfter = cleaned.reduce((s, h) => s + h.shares, 0) + newPublicFloat;
      if (sumAfter !== latestCorp.totalShares) {
        console.log(
          `  Corp ${p.seq ?? p.corpId} — rebalancing produced invariant break (sum=${sumAfter} vs totalShares=${latestCorp.totalShares}); SKIPPED.`
        );
        continue;
      }

      await corporations.updateOne(
        { _id: latestCorp._id },
        {
          $set: {
            shareholders: cleaned,
            publicFloat: newPublicFloat,
            updatedAt: new Date(),
          },
        }
      );
      console.log(
        `  Corp ${p.seq ?? p.corpId} "${p.name}" — restored ${highConf.length} holder(s) (${totalRestore} total shares rebalanced).`
      );
    }
  } finally {
    await client.close();
  }
}

function countryToCurrency(countryId: string): string | undefined {
  switch (countryId) {
    case "US":
      return "USD";
    case "UK":
      return "GBP";
    case "CA":
      return "CAD";
    case "DE":
      return "EUR";
    case "JP":
      return "JPY";
    default:
      return undefined;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
