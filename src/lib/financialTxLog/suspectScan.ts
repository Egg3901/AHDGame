import * as Sentry from "@sentry/nextjs";
import type { Collection, Db } from "mongodb";
import type { FinancialTxLogEntry, FinancialSuspectFlag } from "@/lib/db/types/financialTxLog";
import type { PortfolioHistory, SystemSettings } from "@/lib/db/types";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";

interface ScanConfig {
  windowTurns: number; // default 6 — coarse pair-velocity / round-trip window
  velocityThreshold: number; // default 5 transactions per (subjectId, counterpartyId) pair

  /** Phase 6: tighter time-based velocity detector. Default 10 tx of the same
   * type by the same subject within 60 seconds. Surfaces the rapid-fire
   * pattern from the live audit (KIMI: 6 bond buys in 9 minutes, 4-second gap
   * between two of them) which the per-turn pair detector under-reports. */
  timeVelocityWindowSeconds: number; // default 60
  timeVelocityThreshold: number; // default 10

  /** Phase 6: same-price wash detector. Buy + sell on same corp, same
   * pricePerShare, by same character, within N seconds. Tighter than the
   * per-turn wash_trade signal — catches the exact Mark O'Rubio pattern of
   * 10M shares churned at identical price within minutes. */
  samePriceWashWindowSeconds: number; // default 300 (5 min)

  /** Phase 6: cash-mismatch detector. When the sum of logged tx amounts for
   * a subject in the scan window diverges from the actual cash-balance delta
   * in portfolioHistory by more than this absolute anchor-unit threshold,
   * flag the most recent tx so admins see it on the alerts dashboard. The
   * default $1M anchor catches the bond-buy bug at first emergence; lower it
   * to $100k for tighter monitoring once Phase 6 stabilises. */
  cashMismatchThresholdAnchor: number; // default 1_000_000
}

const SUSPECT_SCAN_BUDGET_MS = 90_000;
const SUSPECT_SCAN_YIELD_EVERY = 250;
const FINANCIAL_TX_TURN_INDEX_NAME = "financialTxLog_turn_desc";

let financialTxTurnIndexPromise: Promise<string> | null = null;

class SuspectScanBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuspectScanBudgetError";
  }
}

function createBudgetGuard(currentTurn: number, getWindowSize: () => number) {
  const startedAt = Date.now();

  return {
    async checkpoint(step: string, index?: number): Promise<void> {
      if (index === undefined || index % SUSPECT_SCAN_YIELD_EVERY === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs <= SUSPECT_SCAN_BUDGET_MS) return;

      throw new SuspectScanBudgetError(
        `financialSuspectScan exceeded ${SUSPECT_SCAN_BUDGET_MS / 1000}s budget at ${step} for turn ${currentTurn} (${getWindowSize()} window tx)`
      );
    },
  };
}

async function ensureFinancialTxTurnIndex(col: Collection<FinancialTxLogEntry>): Promise<void> {
  if (!financialTxTurnIndexPromise) {
    // The archived migration script added this index, but live data can lag a deploy.
    // Ensure the turn-range scan can heal itself on the next invocation instead of
    // repeatedly full-scanning the ledger until someone notices and runs a script.
    financialTxTurnIndexPromise = col
      .createIndex({ turn: -1 }, { background: true, name: FINANCIAL_TX_TURN_INDEX_NAME })
      .catch((error) => {
        financialTxTurnIndexPromise = null;
        throw error;
      });
  }

  await financialTxTurnIndexPromise;
}

async function loadScanConfig(db: Db): Promise<ScanConfig> {
  const settings = await db
    .collection<SystemSettings>("systemSettings")
    .findOne({ _id: "current" });
  const cfg = settings?.financialTxLog;
  return {
    windowTurns: cfg?.suspectScanWindowTurns ?? 6,
    velocityThreshold: cfg?.velocityThreshold ?? 5,
    timeVelocityWindowSeconds:
      (cfg as { timeVelocityWindowSeconds?: number } | undefined)?.timeVelocityWindowSeconds ?? 60,
    timeVelocityThreshold:
      (cfg as { timeVelocityThreshold?: number } | undefined)?.timeVelocityThreshold ?? 10,
    samePriceWashWindowSeconds:
      (cfg as { samePriceWashWindowSeconds?: number } | undefined)?.samePriceWashWindowSeconds ??
      300,
    cashMismatchThresholdAnchor:
      (cfg as { cashMismatchThresholdAnchor?: number } | undefined)?.cashMismatchThresholdAnchor ??
      1_000_000,
  };
}

export async function runFinancialSuspectScan(db: Db, currentTurn: number): Promise<void> {
  try {
    const config = await loadScanConfig(db);
    const minTurn = currentTurn - config.windowTurns + 1;
    const now = new Date();

    const col = db.collection<FinancialTxLogEntry>("financialTxLog");
    await ensureFinancialTxTurnIndex(col);
    const window = await col
      .find(
        { turn: { $gte: minTurn } },
        {
          projection: {
            _id: 1,
            type: 1,
            turn: 1,
            createdAt: 1,
            subjectType: 1,
            subjectId: 1,
            counterpartyId: 1,
            amount: 1,
            anchorAmount: 1,
            currencyCode: 1,
            meta: 1,
          },
        }
      )
      .toArray();
    const budget = createBudgetGuard(currentTurn, () => window.length);

    const flagUpdates = new Map<string, FinancialSuspectFlag[]>();

    function addFlag(id: string, flag: FinancialSuspectFlag) {
      const existing = flagUpdates.get(id) ?? [];
      // avoid duplicate flag types on the same document
      if (!existing.some((f) => f.type === flag.type)) {
        existing.push(flag);
        flagUpdates.set(id, existing);
      }
    }

    // ── Velocity: pairs with > threshold transactions ────────────────────────
    const pairCounts = new Map<string, string[]>();
    for (const [index, doc] of window.entries()) {
      await budget.checkpoint("pairVelocityGrouping", index);
      if (!doc.subjectId || !doc.counterpartyId) continue;
      const key = `${doc.subjectId}|${doc.counterpartyId}`;
      const ids = pairCounts.get(key) ?? [];
      ids.push(String(doc._id));
      pairCounts.set(key, ids);
    }
    let pairIndex = 0;
    for (const [, ids] of pairCounts) {
      await budget.checkpoint("pairVelocityFlagging", pairIndex++);
      if (ids.length > config.velocityThreshold) {
        for (const id of ids) {
          addFlag(id, {
            type: "velocity",
            severity: "medium",
            detail: `${ids.length} transactions between same pair in ${config.windowTurns} turns (threshold: ${config.velocityThreshold})`,
            detectedAt: now,
          });
        }
      }
    }

    // ── Wash trade: buy + sell same corp between same two characters ─────────
    const buysByCorpAndPair = new Map<string, FinancialTxLogEntry[]>();
    const sellsByCorpAndPair = new Map<string, FinancialTxLogEntry[]>();
    for (const [index, doc] of window.entries()) {
      await budget.checkpoint("washTradeGrouping", index);
      if (doc.type !== "stock_trade_buy" && doc.type !== "stock_trade_sell") continue;
      if (!doc.subjectId || !doc.counterpartyId) continue;
      const corpId = String((doc.meta as Record<string, unknown>)?.corporationId ?? "");
      if (!corpId) continue;
      const a = String(doc.subjectId);
      const b = String(doc.counterpartyId);
      const pairKey = [a, b].sort().join("|");
      const key = `${corpId}|${pairKey}`;
      if (doc.type === "stock_trade_buy") {
        const arr = buysByCorpAndPair.get(key) ?? [];
        arr.push(doc);
        buysByCorpAndPair.set(key, arr);
      } else {
        const arr = sellsByCorpAndPair.get(key) ?? [];
        arr.push(doc);
        sellsByCorpAndPair.set(key, arr);
      }
    }
    let washPairIndex = 0;
    for (const [key, buys] of buysByCorpAndPair) {
      await budget.checkpoint("washTradeFlagging", washPairIndex++);
      const sells = sellsByCorpAndPair.get(key);
      if (!sells || sells.length === 0) continue;
      const corpName = String(
        (buys[0].meta as Record<string, unknown>)?.corporationName ?? key.split("|")[0]
      );
      const detail = `Wash trade detected on ${corpName} within ${config.windowTurns} turns`;
      for (const doc of [...buys, ...sells]) {
        addFlag(String(doc._id), { type: "wash_trade", severity: "high", detail, detectedAt: now });
      }
    }

    // ── Round trip: A debits → B, B credits → A ──────────────────────────────
    // Build debit counterparty map: for each entity A with debits, collect B IDs
    const debitsBySubject = new Map<string, Set<string>>();
    const docsBySubject = new Map<string, FinancialTxLogEntry[]>();
    for (const [index, doc] of window.entries()) {
      await budget.checkpoint("roundTripGrouping", index);
      if (!doc.subjectId) continue;
      const sid = String(doc.subjectId);
      const arr = docsBySubject.get(sid) ?? [];
      arr.push(doc);
      docsBySubject.set(sid, arr);
      if (doc.amount < 0 && doc.counterpartyId) {
        const set = debitsBySubject.get(sid) ?? new Set<string>();
        set.add(String(doc.counterpartyId));
        debitsBySubject.set(sid, set);
      }
    }
    let roundTripSubjectIndex = 0;
    for (const [aId, bIds] of debitsBySubject) {
      await budget.checkpoint("roundTripSubjectScan", roundTripSubjectIndex++);
      let roundTripCounterpartyIndex = 0;
      for (const bId of bIds) {
        await budget.checkpoint("roundTripCounterpartyScan", roundTripCounterpartyIndex++);
        // check if B sent a credit back to A
        const bDocs = docsBySubject.get(bId) ?? [];
        const returnCredits = bDocs.filter(
          (d) => d.amount > 0 && d.counterpartyId && String(d.counterpartyId) === aId
        );
        if (returnCredits.length === 0) continue;
        const aDebits = (docsBySubject.get(aId) ?? []).filter(
          (d) => d.amount < 0 && d.counterpartyId && String(d.counterpartyId) === bId
        );
        const detail = `Round-trip detected: ${aId.slice(-6)} → ${bId.slice(-6)} → ${aId.slice(-6)} within ${config.windowTurns} turns`;
        for (const doc of [...aDebits, ...returnCredits]) {
          addFlag(String(doc._id), {
            type: "round_trip",
            severity: "high",
            detail,
            detectedAt: now,
          });
        }
      }
    }

    // ── Phase 6: time_velocity — same-subject same-type ≥N within Ns ─────────
    // The pair-based velocity above counts per (subjectId, counterpartyId)
    // over a turn window; many of the bond-buy exploit's tightly-clustered
    // rapid-fire purchases didn't share a counterparty and therefore evaded
    // it. Re-bucket by (subjectId, type) and walk timestamps for clusters.
    const docsBySubjectType = new Map<string, FinancialTxLogEntry[]>();
    for (const [index, doc] of window.entries()) {
      await budget.checkpoint("timeVelocityGrouping", index);
      if (!doc.subjectId) continue;
      const key = `${doc.subjectId}|${doc.type}`;
      const arr = docsBySubjectType.get(key) ?? [];
      arr.push(doc);
      docsBySubjectType.set(key, arr);
    }
    const timeWindowMs = config.timeVelocityWindowSeconds * 1000;
    let subjectTypeIndex = 0;
    for (const [key, docs] of docsBySubjectType) {
      await budget.checkpoint("timeVelocityWindowScan", subjectTypeIndex++);
      if (docs.length < config.timeVelocityThreshold) continue;
      // Sort by createdAt and slide an N-document window; flag every doc in
      // any window whose first-to-last span ≤ timeWindowMs.
      docs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const flaggedHere = new Set<string>();
      for (let i = 0; i + config.timeVelocityThreshold - 1 < docs.length; i++) {
        await budget.checkpoint("timeVelocitySlidingWindow", i);
        const span =
          docs[i + config.timeVelocityThreshold - 1].createdAt.getTime() -
          docs[i].createdAt.getTime();
        if (span <= timeWindowMs) {
          for (let j = i; j < i + config.timeVelocityThreshold; j++) {
            flaggedHere.add(String(docs[j]._id));
          }
        }
      }
      if (flaggedHere.size > 0) {
        const detail = `${flaggedHere.size} ${key.split("|")[1]} tx within ${config.timeVelocityWindowSeconds}s (threshold: ${config.timeVelocityThreshold})`;
        for (const id of flaggedHere) {
          addFlag(id, {
            type: "time_velocity",
            severity: "high",
            detail,
            detectedAt: now,
          });
        }
      }
    }

    // ── Phase 6: same_price_wash — buy + sell on same corp at identical
    // pricePerShare, same character, within Ns ────────────────────────────
    // Captures the live wealth-list pattern of 10M shares churned at the
    // exact same price within minutes (no PnL, suggesting wash-trading to
    // generate apparent volume or to mask other moves). The existing
    // wash_trade detector pairs buyer+seller; this one targets a single
    // character cycling their own holding.
    const tradesByCharCorpPrice = new Map<string, FinancialTxLogEntry[]>();
    for (const [index, doc] of window.entries()) {
      await budget.checkpoint("samePriceWashGrouping", index);
      if (doc.type !== "stock_trade_buy" && doc.type !== "stock_trade_sell") continue;
      if (!doc.subjectId) continue;
      const meta = (doc.meta ?? {}) as Record<string, unknown>;
      const corpId = String(meta.corporationId ?? "");
      const price = Number(meta.pricePerShare);
      if (!corpId || !Number.isFinite(price)) continue;
      // Round to 6 dp to absorb display-precision noise without missing the
      // exact-match cluster the live audit identified.
      const priceKey = price.toFixed(6);
      const key = `${doc.subjectId}|${corpId}|${priceKey}`;
      const arr = tradesByCharCorpPrice.get(key) ?? [];
      arr.push(doc);
      tradesByCharCorpPrice.set(key, arr);
    }
    const washWindowMs = config.samePriceWashWindowSeconds * 1000;
    let samePriceGroupIndex = 0;
    for (const [key, docs] of tradesByCharCorpPrice) {
      await budget.checkpoint("samePriceWashMatching", samePriceGroupIndex++);
      const buys = docs.filter((d) => d.type === "stock_trade_buy");
      const sells = docs.filter((d) => d.type === "stock_trade_sell");
      if (buys.length === 0 || sells.length === 0) continue;
      // Find any buy-sell pair within the wash window.
      buys.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      sells.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const matched = new Set<string>();
      let sellIndex = 0;
      for (const [buyIndex, b] of buys.entries()) {
        await budget.checkpoint("samePriceWashBuyScan", buyIndex);
        while (
          sellIndex < sells.length &&
          sells[sellIndex].createdAt.getTime() < b.createdAt.getTime() - washWindowMs
        ) {
          sellIndex++;
        }

        for (let candidateIndex = sellIndex; candidateIndex < sells.length; candidateIndex++) {
          const s = sells[candidateIndex];
          const deltaMs = s.createdAt.getTime() - b.createdAt.getTime();
          if (deltaMs > washWindowMs) break;
          if (Math.abs(deltaMs) <= washWindowMs) {
            matched.add(String(b._id));
            matched.add(String(s._id));
          }
        }
      }
      if (matched.size > 0) {
        const [, corpId, priceKey] = key.split("|");
        const detail = `Same-price wash on corp ${corpId.slice(-6)} @ ${priceKey} within ${config.samePriceWashWindowSeconds}s`;
        for (const id of matched) {
          addFlag(id, {
            type: "same_price_wash",
            severity: "high",
            detail,
            detectedAt: now,
          });
        }
      }
    }

    // ── Phase 6: cash_mismatch — logged-net vs actual cash delta ─────────────
    // For each character / corporation subject in the window, compare the sum
    // of logged tx amounts (in anchor units) against the actual cash-balance
    // delta from portfolioHistory between the first and last snapshot in the
    // same window. Gap > threshold → flag the most-recent tx for that subject
    // so admins see it in the alerts list. The reconcile endpoint does the
    // same calc on demand; this is its automated counterpart.
    try {
      const charSubjectIds = new Set<string>();
      const corpSubjectIds = new Set<string>();
      for (const [index, doc] of window.entries()) {
        await budget.checkpoint("cashMismatchSubjectDiscovery", index);
        if (!doc.subjectId) continue;
        if (doc.subjectType === "character") charSubjectIds.add(String(doc.subjectId));
        else if (doc.subjectType === "corporation") corpSubjectIds.add(String(doc.subjectId));
      }

      if (charSubjectIds.size > 0 || corpSubjectIds.size > 0) {
        const exchangeRates = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();
        const ratesByCurrency = new Map<string, number>();
        for (const r of exchangeRates) {
          ratesByCurrency.set(r.currencyCode as string, r.rate);
        }
        const toAnchor = (amount: number, currency: string): number => {
          const rate = ratesByCurrency.get(currency);
          if (!rate || rate <= 0) return amount;
          // exchangeRate.rate is local-per-anchor, so anchor = local / rate.
          return amount / rate;
        };

        // Logged net per subject (in anchor units).
        const loggedNetBySubject = new Map<string, number>();
        const lastTxMetaBySubject = new Map<string, { id: string; createdAtMs: number }>();
        for (const [index, doc] of window.entries()) {
          await budget.checkpoint("cashMismatchLoggedNetScan", index);
          if (!doc.subjectId) continue;
          if (doc.subjectType !== "character" && doc.subjectType !== "corporation") continue;
          const key = String(doc.subjectId);
          loggedNetBySubject.set(
            key,
            (loggedNetBySubject.get(key) ?? 0) +
              (doc.anchorAmount ?? toAnchor(doc.amount, doc.currencyCode))
          );
          // The window is already turn-sorted by Mongo's natural ordering for
          // a fixed turn-min query, but rely on createdAt for the "most
          // recent" pick that drives where the flag lands.
          const existing = lastTxMetaBySubject.get(key);
          const createdAtMs = doc.createdAt.getTime();
          if (!existing || createdAtMs > existing.createdAtMs) {
            lastTxMetaBySubject.set(key, { id: String(doc._id), createdAtMs });
          }
        }

        const { ObjectId: ObjectIdCtor } = await import("mongodb");
        const fetchSnapshots = async (
          collection: "portfolioHistory" | "corporationPortfolioHistory",
          idField: "characterId" | "corporationId",
          subjectIds: string[]
        ): Promise<Map<string, PortfolioHistory[]>> => {
          if (subjectIds.length === 0) return new Map();
          const docs = await db
            .collection<PortfolioHistory>(collection)
            .find({
              [idField]: { $in: subjectIds.map((id) => new ObjectIdCtor(id)) },
              turn: { $gte: minTurn },
            } as never)
            .sort({ turn: 1 })
            .toArray();
          const map = new Map<string, PortfolioHistory[]>();
          for (const [index, d] of docs.entries()) {
            await budget.checkpoint("cashMismatchSnapshotMap", index);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sid = String((d as any)[idField]);
            const arr = map.get(sid) ?? [];
            arr.push(d);
            map.set(sid, arr);
          }
          return map;
        };

        const [charSnapshots, corpSnapshots] = await Promise.all([
          fetchSnapshots("portfolioHistory", "characterId", [...charSubjectIds]),
          fetchSnapshots("corporationPortfolioHistory", "corporationId", [...corpSubjectIds]),
        ]);

        const evaluateSubject = async (
          subjectId: string,
          snapshots: PortfolioHistory[] | undefined,
          index: number
        ) => {
          await budget.checkpoint("cashMismatchEvaluation", index);
          if (!snapshots || snapshots.length < 2) return;
          const first = snapshots[0];
          const last = snapshots[snapshots.length - 1];
          const actualCashDelta = (last.cashValue ?? 0) - (first.cashValue ?? 0);
          const loggedNet = loggedNetBySubject.get(subjectId) ?? 0;
          const gap = actualCashDelta - loggedNet;
          if (Math.abs(gap) < config.cashMismatchThresholdAnchor) return;
          const lastTxId = lastTxMetaBySubject.get(subjectId)?.id;
          if (!lastTxId) return;
          const sign = gap > 0 ? "phantom inflow" : "phantom outflow";
          const detail = `Cash ${sign}: actual Δ ${Math.round(actualCashDelta).toLocaleString()} − logged ${Math.round(loggedNet).toLocaleString()} = ${Math.round(gap).toLocaleString()} (₳)`;
          addFlag(lastTxId, {
            type: "cash_mismatch",
            severity: "high",
            detail,
            detectedAt: now,
          });
        };
        let mismatchEvalIndex = 0;
        for (const sid of charSubjectIds) {
          await evaluateSubject(sid, charSnapshots.get(sid), mismatchEvalIndex++);
        }
        for (const sid of corpSubjectIds) {
          await evaluateSubject(sid, corpSnapshots.get(sid), mismatchEvalIndex++);
        }
      }
    } catch (innerErr) {
      if (innerErr instanceof SuspectScanBudgetError) {
        throw innerErr;
      }
      // Cash-mismatch detection touches portfolioHistory + exchangeRates; if
      // either is missing (test env) we want the rest of the scan to still
      // commit, so swallow the inner error and report it without aborting.
      Sentry.captureException(innerErr, {
        extra: { phase: "financialSuspectScan/cashMismatch", turn: currentTurn },
      });
    }

    if (flagUpdates.size === 0) return;

    // Early ledger rows were seeded with `suspectFlags: null`; Mongo rejects
    // `$push` against those docs, and any non-array shape can abort the whole
    // unordered bulk scan during turn processing. Normalize the current window
    // first so the scan can heal legacy data instead of bricking the phase.
    await col.updateMany(
      {
        turn: { $gte: minTurn },
        $expr: { $eq: [{ $isArray: "$suspectFlags" }, false] },
      } as Record<string, unknown>,
      [{ $set: { suspectFlags: [] } }] as Record<string, unknown>[]
    );

    // Backfill flags via bulkWrite, merging into existing suspectFlags array
    const { ObjectId } = await import("mongodb");
    await budget.checkpoint("bulkWritePreparation");
    const ops = Array.from(flagUpdates.entries()).map(([id, newFlags]) => ({
      updateOne: {
        filter: { _id: new ObjectId(id) },
        update: {
          $push: { suspectFlags: { $each: newFlags } } as Record<string, unknown>,
          $set: { flagged: true },
        },
      },
    }));

    await col.bulkWrite(ops, { ordered: false });
    await budget.checkpoint("bulkWriteComplete");
  } catch (err) {
    Sentry.captureException(err, { extra: { phase: "financialSuspectScan", turn: currentTurn } });
    throw err;
  }
}
