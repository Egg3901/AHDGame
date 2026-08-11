/**
 * One-shot backfill: write each corp's actual post-bondTurn liquidCapital
 * into the latest `corporationHistory` row.
 *
 * Why: until this migration ran, `corporationHistory.liquidCapital` was
 * captured by the corp turn's snapshot (marketCapSnapshot) BEFORE the
 * bondTurn coupon flows applied, so the Cash-on-Hand chart showed a stale
 * value while the corporation hero header (which reads live
 * `corp.liquidCapital`) showed the post-bondTurn value. The forward fix
 * lives in `recomputeSharePrices.ts`, but historical rows stay stale.
 *
 * Scope decision: only the LATEST turn is backfilled. Pre-fix turns accept
 * the historical inaccuracy. This keeps the repair narrow and avoids
 * mutating long-frozen history rows.
 *
 * Safety model:
 * - The script reconstructs the latest-turn bond cash-flow delta from the
 *   current bonds collection.
 * - It only APPLIES if that reconstructed delta reconciles each affected
 *   corp back to the current live `corp.liquidCapital`, and the history row's
 *   currency stamp still matches the corp's current liquid-currency stamp.
 * - If either check fails, the live state has drifted (bond trades, FX
 *   changes, HQ relocation, manual admin edits, etc.) and the script ABORTS
 *   rather than writing a potentially wrong value.
 *
 * Idempotent via `migrationsRun` marker
 * (`_id = "backfill-latest-liquid-capital-snapshot"`). Re-running after a
 * successful apply is a no-op.
 *
 * Default: dry-run (prints changes, writes nothing).
 * Pass `--apply` to commit the bulkWrite.
 *
 * Runs against `MONGODB_URI_LIVE`.
 */
import { MongoClient, ObjectId, type AnyBulkWriteOperation } from "mongodb";
import * as dotenv from "dotenv";
import path from "path";
import { resolveCorpLiquidCurrencyCode } from "../../src/lib/currency/corporationCapital";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const uri = process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error("MONGODB_URI_LIVE not set");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const MARKER_ID = "backfill-latest-liquid-capital-snapshot";
const TURNS_PER_YEAR = 48;
const BOND_UNIT_FACE_VALUE = 1000;

type CorpDoc = {
  _id: ObjectId;
  name?: string;
  sequentialId?: number;
  liquidCapital?: number;
  liquidCurrencyCode?: string;
  countryId?: string;
  countryOwnerId?: ObjectId | string | null;
};

type HistoryRow = {
  corporationId: ObjectId;
  turn: number;
  liquidCapital?: number;
  currencyCode?: string;
  createdAt?: Date;
};

type BondReplayRow = {
  matured?: boolean;
  defaulted?: boolean;
  defaultedAtTurn?: number | null;
  maturityTurn: number;
  couponRate?: number;
  currencyCode?: string | null;
  issuerType?: string;
  corporationId?: ObjectId;
  publicFloat?: number;
  holders?: Array<{ corporationId?: ObjectId; units?: number }>;
};

function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Convert an amount in `fromCcy` to `toCcy` via the anchor.
 *  rate = local-per-anchor (matches ExchangeRate.rate). Missing/falsy
 *  ccy => pass-through (pre-forex / anchor balance). */
function convert(
  amount: number,
  fromCcy: string | null | undefined,
  toCcy: string | null | undefined,
  rateByCcy: Map<string, number>
): number {
  const fromRate = fromCcy ? (rateByCcy.get(fromCcy) ?? 1) : 1;
  const toRate = toCcy ? (rateByCcy.get(toCcy) ?? 1) : 1;
  return (amount / fromRate) * toRate;
}

function describeCorp(corp: CorpDoc | undefined): string {
  const name = corp?.name ?? "(unknown)";
  const seqId = corp?.sequentialId != null ? ` #${corp.sequentialId}` : "";
  return `${name}${seqId}`;
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db("a-house-divided");

  try {
    const marker = await db
      .collection<{ _id: string; completedAt: Date }>("migrationsRun")
      .findOne({ _id: MARKER_ID });
    if (marker) {
      console.log(`[${MARKER_ID}] already ran at ${marker.completedAt}. Exiting.`);
      return;
    }

    const gameState =
      (await db
        .collection<{ _id: string; isActive?: boolean; isProcessing?: boolean }>("gameState")
        .findOne({ _id: "current" })) ?? null;
    if (gameState?.isActive || gameState?.isProcessing) {
      console.warn(
        `[${MARKER_ID}] WARNING: gameState.isActive=${gameState.isActive ?? false}, ` +
          `isProcessing=${gameState.isProcessing ?? false}. This repair reads mutable live ` +
          `bond/corp state and should only run while turns are paused. Continuing in 10s; ` +
          `abort with Ctrl-C if this is unexpected.`
      );
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }

    const last = await db
      .collection<{ turn: number }>("corporationHistory")
      .find({})
      .sort({ turn: -1 })
      .limit(1)
      .project({ turn: 1 })
      .toArray();
    if (!last.length) {
      console.error("No corporationHistory rows found");
      process.exitCode = 1;
      return;
    }
    const turn = last[0].turn;
    console.log(`Latest turn: T${turn}  (mode: ${APPLY ? "APPLY" : "DRY-RUN"})\n`);

    const latestHistoryRows = await db
      .collection<HistoryRow>("corporationHistory")
      .find({ turn })
      .project({ corporationId: 1, liquidCapital: 1, currencyCode: 1, createdAt: 1 })
      .toArray();
    if (latestHistoryRows.length === 0) {
      console.error(`No corporationHistory rows found for turn ${turn}`);
      process.exitCode = 1;
      return;
    }
    const histByCorpId = new Map(
      latestHistoryRows.map((row) => [row.corporationId.toString(), row] as const)
    );

    const corps: CorpDoc[] = await db
      .collection<CorpDoc>("corporations")
      .find({})
      .project<CorpDoc>({
        _id: 1,
        name: 1,
        sequentialId: 1,
        liquidCapital: 1,
        liquidCurrencyCode: 1,
        countryId: 1,
        countryOwnerId: 1,
      })
      .toArray();
    const corpById = new Map(corps.map((corp) => [corp._id.toString(), corp] as const));
    const isNatcorp = new Set(
      corps.filter((corp) => !!corp.countryOwnerId).map((corp) => corp._id.toString())
    );

    const fxDocs = await db.collection("exchangeRates").find({}).toArray();
    const rateByCcy = new Map<string, number>();
    for (const row of fxDocs as Array<{ currencyCode?: string; rate?: number }>) {
      if (row.currencyCode && typeof row.rate === "number") {
        rateByCcy.set(row.currencyCode, row.rate);
      }
    }
    console.log(
      `Loaded FX rates for ${rateByCcy.size} currencies: ${[...rateByCcy.keys()].join(", ")}\n`
    );

    const bonds = await db
      .collection<BondReplayRow>("bonds")
      .find({ maturityTurn: { $gte: turn } })
      .toArray();

    type Delta = { totalIn: number; totalOut: number; ccy: string };
    const deltas = new Map<string, Delta>();
    const ensureDelta = (corpId: string): Delta => {
      let delta = deltas.get(corpId);
      if (!delta) {
        const historyRow = histByCorpId.get(corpId);
        const corp = corpById.get(corpId);
        delta = {
          totalIn: 0,
          totalOut: 0,
          ccy: historyRow?.currencyCode ?? resolveCorpLiquidCurrencyCode(corp) ?? "(none)",
        };
        deltas.set(corpId, delta);
      }
      return delta;
    };

    let couponBondCount = 0;
    let maturedBondCount = 0;
    let skippedDefaulted = 0;
    let skippedRetired = 0;

    for (const bond of bonds) {
      const matured = bond.matured === true;
      const defaulted = bond.defaulted === true;
      const wasMaturedAtStart = matured && bond.maturityTurn !== turn;
      const wasDefaultedAtStart =
        defaulted && (bond.defaultedAtTurn == null || bond.defaultedAtTurn < turn);

      if (wasMaturedAtStart) {
        skippedRetired++;
        continue;
      }
      if (wasDefaultedAtStart) {
        skippedDefaulted++;
        continue;
      }

      couponBondCount++;
      const isMaturingThisTurn = bond.maturityTurn === turn && matured && !defaulted;
      if (isMaturingThisTurn) maturedBondCount++;

      const bondCcy = bond.currencyCode ?? null;
      const couponPerUnitLocal =
        (((bond.couponRate ?? 0) / 100) * BOND_UNIT_FACE_VALUE) / TURNS_PER_YEAR;

      let holderUnitsTotal = 0;
      for (const holder of bond.holders ?? []) {
        const units = holder.units ?? 0;
        holderUnitsTotal += units;
        if (!holder.corporationId || units <= 0) continue;

        const holderId = holder.corporationId.toString();
        const holderHistory = histByCorpId.get(holderId);
        if (!holderHistory) continue;

        const holderTargetCcy =
          holderHistory.currencyCode ??
          resolveCorpLiquidCurrencyCode(corpById.get(holderId)) ??
          null;
        const couponLocal = couponPerUnitLocal * units;
        ensureDelta(holderId).totalIn += convert(couponLocal, bondCcy, holderTargetCcy, rateByCcy);

        if (isMaturingThisTurn) {
          const faceLocal = BOND_UNIT_FACE_VALUE * units;
          ensureDelta(holderId).totalIn += convert(faceLocal, bondCcy, holderTargetCcy, rateByCcy);
        }
      }

      const isCorporateBond = bond.issuerType !== "sovereign";
      if (isCorporateBond && bond.corporationId) {
        const issuerId = bond.corporationId.toString();
        const issuerHistory = histByCorpId.get(issuerId);
        if (!issuerHistory || isNatcorp.has(issuerId)) continue;

        const issuerTargetCcy =
          issuerHistory.currencyCode ??
          resolveCorpLiquidCurrencyCode(corpById.get(issuerId)) ??
          null;
        const totalUnits = holderUnitsTotal + (bond.publicFloat ?? 0);
        const couponLocal = couponPerUnitLocal * totalUnits;
        ensureDelta(issuerId).totalOut += convert(couponLocal, bondCcy, issuerTargetCcy, rateByCcy);

        if (isMaturingThisTurn) {
          const faceLocal = BOND_UNIT_FACE_VALUE * totalUnits;
          ensureDelta(issuerId).totalOut += convert(faceLocal, bondCcy, issuerTargetCcy, rateByCcy);
        }
      }
    }

    console.log(`Bonds scanned: ${bonds.length}`);
    console.log(`  paying coupon at T${turn}:        ${couponBondCount}`);
    console.log(`  also redeeming at T${turn}:       ${maturedBondCount}`);
    console.log(`  skipped (defaulted before T${turn}): ${skippedDefaulted}`);
    console.log(`  skipped (retired/matured before T${turn}): ${skippedRetired}`);
    console.log(`Corps with non-zero bond cash flow: ${deltas.size}\n`);

    const histOps: AnyBulkWriteOperation<HistoryRow>[] = [];
    console.log(
      `${"corp".padEnd(28)} ${"ccy".padEnd(4)} ${"old hist LC".padStart(18)}  ${"net delta".padStart(16)}  ${"replayed LC".padStart(18)}  ${"live corp LC".padStart(18)}  status`
    );
    console.log("-".repeat(124));

    const sorted = [...deltas.entries()].sort(
      (a, b) => Math.abs(b[1].totalIn - b[1].totalOut) - Math.abs(a[1].totalIn - a[1].totalOut)
    );

    let touched = 0;
    let mismatchCount = 0;
    let currencyDriftCount = 0;
    let missingLiveCorpCount = 0;
    let totalDeltaAbs = 0;
    for (const [corpId, delta] of sorted) {
      const corp = corpById.get(corpId);
      const hist = histByCorpId.get(corpId);
      if (!hist) continue;

      const oldHistLc = hist.liquidCapital ?? 0;
      const liveLc = corp?.liquidCapital;
      const liveCurrency = resolveCorpLiquidCurrencyCode(corp);
      const histCurrency = hist.currencyCode;
      const currencyDrift = !!histCurrency && !!liveCurrency && histCurrency !== liveCurrency;
      const netDelta = delta.totalIn - delta.totalOut;
      if (Math.abs(netDelta) < 0.005 && liveLc != null && Math.abs(oldHistLc - liveLc) < 0.005) {
        continue;
      }

      touched++;
      totalDeltaAbs += Math.abs(netDelta);
      const replayedLc = oldHistLc + netDelta;
      const missingLiveCorp = liveLc == null;
      const matchesLive = !missingLiveCorp && Math.abs(replayedLc - liveLc) < 1;

      if (currencyDrift) currencyDriftCount++;
      if (missingLiveCorp) missingLiveCorpCount++;
      if (!matchesLive) mismatchCount++;

      const statusParts: string[] = [];
      if (currencyDrift) statusParts.push("currency-drift");
      if (missingLiveCorp) statusParts.push("missing-live-corp");
      if (!matchesLive) statusParts.push("mismatch");
      if (statusParts.length === 0) statusParts.push("ok");

      console.log(
        `${describeCorp(corp).slice(0, 28).padEnd(28)} ${delta.ccy.padEnd(4)} ${fmt(oldHistLc, 0).padStart(18)}  ${fmt(netDelta, 0).padStart(16)}  ${fmt(replayedLc, 0).padStart(18)}  ${fmt(liveLc ?? Number.NaN, 0).padStart(18)}  ${statusParts.join(",")}`
      );

      if (missingLiveCorp || currencyDrift) continue;
      if (!matchesLive) continue;
      if (liveLc == null || Math.abs(oldHistLc - liveLc) < 0.005) continue;

      histOps.push({
        updateOne: {
          filter: { corporationId: new ObjectId(corpId), turn, liquidCapital: oldHistLc },
          update: { $set: { liquidCapital: liveLc } },
        },
      });
    }

    console.log("-".repeat(124));
    console.log(`Corps touched:          ${touched}`);
    console.log(`Total |delta| (raw sum): ${fmt(totalDeltaAbs, 2)}`);
    console.log(`Currency drifts:        ${currencyDriftCount}`);
    console.log(`Missing live corps:     ${missingLiveCorpCount}`);
    console.log(`Replay mismatches:      ${mismatchCount}`);

    const unsafe = currencyDriftCount > 0 || missingLiveCorpCount > 0 || mismatchCount > 0;
    if (unsafe) {
      console.log(
        `\n[${MARKER_ID}] UNSAFE TO APPLY: the latest-turn replay no longer reconciles ` +
          `cleanly back to live corp cash. This usually means the live bond/corp state ` +
          `has drifted since turn ${turn}.`
      );
    } else {
      console.log(
        `\n[${MARKER_ID}] Safe replay confirmed for turn ${turn}; ${histOps.length} row(s) ` +
          `would be updated to match live corp.liquidCapital.`
      );
    }

    if (!APPLY) {
      console.log("\nDRY-RUN: no writes performed. Re-run with --apply to commit.");
      return;
    }

    if (unsafe) {
      console.error(`[${MARKER_ID}] ABORT: refusing to write drifted latest-turn data.`);
      process.exitCode = 1;
      return;
    }

    if (histOps.length === 0) {
      console.log(`[${MARKER_ID}] Nothing to update.`);
      await db
        .collection<{
          _id: string;
          completedAt: Date;
          turn: number;
          rowsUpdated: number;
        }>("migrationsRun")
        .insertOne({
          _id: MARKER_ID,
          completedAt: new Date(),
          turn,
          rowsUpdated: 0,
        });
      return;
    }

    const result = await db.collection<HistoryRow>("corporationHistory").bulkWrite(histOps);
    await db
      .collection<{
        _id: string;
        completedAt: Date;
        turn: number;
        rowsUpdated: number;
        rowsMatched?: number;
      }>("migrationsRun")
      .insertOne({
        _id: MARKER_ID,
        completedAt: new Date(),
        turn,
        rowsUpdated: result.modifiedCount,
        rowsMatched: result.matchedCount,
      });
    console.log(
      `\n[${MARKER_ID}] Applied. matched=${result.matchedCount} modified=${result.modifiedCount}`
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
