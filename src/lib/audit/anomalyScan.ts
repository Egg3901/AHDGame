/**
 * Anomaly scanners over the unified action-audit spine (forensics/alt-
 * detection rework plan §3.1 "Anomaly scanners", Phase 3 T3.1).
 *
 * Candidate-narrowed, never a full collection scan: every detector runs
 * over a single bounded query — `actionAuditLog` rows from the last
 * `windowTurns` turns (an indexed range on `{turn:-1}`, the same idiom
 * `runFinancialSuspectScan` uses over `financialTxLog`) — never an
 * unindexed or unbounded read. Detectors are pure functions over plain rows
 * so each is independently unit-testable; `runAuditAnomalyScan` is the thin
 * DB wrapper that feeds them from Mongo, stamps `flags[]` back onto the
 * offending `actionAuditLog` rows, and writes one compact summary to
 * `auditAnomalies` (mirrors `apiAbuseScans`/`persistApiAbuseScan`).
 *
 * Report-only doctrine: nothing here bans, throttles, or auto-acts. Runs as
 * the best-effort `auditAnomalyScan` turn phase (after `activityLogging`,
 * before `suspiciousDetection` — see `turnPhaseNames.ts` /
 * `stateEffectsPhase.ts`), flag-gated on `isAuditLogEnabled()`. A throw here
 * is caught by `runtime.runPhase` and logged to Sentry without halting the
 * turn (same contract `financialSuspectScan`/`suspiciousDetection` rely on).
 */
import * as Sentry from "@sentry/nextjs";
import { ObjectId, type Db } from "mongodb";
import { getActionAuditLogCollection } from "@/lib/db/collections/actionAuditLog";
import { getAuditAnomaliesCollection } from "@/lib/db/collections/auditAnomalies";
import { isAuditLogEnabled } from "@/lib/audit/featureFlag";
import type { ActionAuditRecord } from "@/lib/db/types/actionAuditLog";
import type { AuditAnomalyFinding, AuditAnomalyType } from "@/lib/db/types/auditAnomalies";
import {
  detectCircularWire as detectTransferCircularWire,
  detectWireFanInFanOut as detectTransferWireFanInFanOut,
  type AnomalyAuditRow,
} from "@/lib/audit/rules/transferFlows";

export type { AnomalyAuditRow } from "@/lib/audit/rules/transferFlows";
export { SYSTEM_SETTLEMENT_ACTIONS } from "@/lib/audit/rules/transferFlows";

// ── Config ───────────────────────────────────────────────────────────────

export interface AnomalyScanConfig {
  /** Lookback window for the `actionAuditLog` query, in turns. */
  windowTurns: number;
  /** `rapid_repeat`: same actor+action this many times within the window. */
  rapidRepeatWindowSeconds: number;
  rapidRepeatThreshold: number;
  /** `wire_fanin_fanout`: distinct counterparties/senders before flagging a hub. */
  fanInThreshold: number;
  fanOutThreshold: number;
  /** `wash_trade`: same actor+corp+price buy/sell pair within this window
   * (mirrors `suspectScan.ts`'s `samePriceWashWindowSeconds` semantics). */
  washTradeWindowSeconds: number;
  /** `pre_election_funding_surge`: how close (in turns) to an election's
   * `endTurn` counts as "pre-election". */
  preElectionWindowTurns: number;
  /** Sliding sum window (seconds) used to detect a funding burst once inside
   * the pre-election turn window. */
  preElectionFundingWindowSeconds: number;
  preElectionMinDistinctPayers: number;
  preElectionMinTotalAmount: number;
  /** `off_hours_privileged_action`: UTC hour range treated as "off hours".
   * `offHoursStartUtcHour <= offHoursEndUtcHour` is a same-day range;
   * `start > end` wraps past midnight (e.g. 22 → 6). */
  offHoursStartUtcHour: number;
  offHoursEndUtcHour: number;
}

export const ANOMALY_SCAN_DEFAULTS: AnomalyScanConfig = {
  windowTurns: 6,
  rapidRepeatWindowSeconds: 60,
  rapidRepeatThreshold: 8,
  fanInThreshold: 5,
  fanOutThreshold: 5,
  washTradeWindowSeconds: 300,
  preElectionWindowTurns: 8,
  preElectionFundingWindowSeconds: 3600,
  preElectionMinDistinctPayers: 4,
  preElectionMinTotalAmount: 250_000,
  offHoursStartUtcHour: 2,
  offHoursEndUtcHour: 6,
};

// ── Row shape shared by every pure detector ─────────────────────────────

export function toAnomalyRow(doc: ActionAuditRecord): AnomalyAuditRow {
  const actorKey = doc.actor?.userId
    ? `u:${doc.actor.userId.toString()}`
    : doc.actor?.characterId
      ? `c:${doc.actor.characterId.toString()}`
      : null;

  const priceDelta = doc.delta?.find((d) => d.field === "pricePerShare");
  const orderTypeDelta = doc.delta?.find((d) => d.field === "orderType");

  let orderSide: "buy" | "sell" | undefined;
  if (doc.action === "share.sell" || doc.action === "stock.sell") {
    orderSide = "sell";
  } else if (
    doc.action === "share.order" ||
    doc.action === "stock.buy" ||
    orderTypeDelta?.after === "buy"
  ) {
    orderSide = "buy";
  } else if (orderTypeDelta?.after === "sell") {
    orderSide = "sell";
  }

  return {
    id: doc._id.toString(),
    traceId: doc.traceId,
    seq: doc.seq,
    ts: doc.ts,
    turn: doc.turn,
    action: doc.action,
    category: doc.category,
    actorKey,
    actorKind: doc.actor.kind,
    subjectType: doc.subject?.type,
    subjectId: doc.subject?.id !== undefined ? String(doc.subject.id) : undefined,
    counterpartyType: doc.counterparty?.type,
    counterpartyId: doc.counterparty?.id !== undefined ? String(doc.counterparty.id) : undefined,
    amount: doc.amount,
    agreementId:
      doc.meta?.agreementId === undefined || doc.meta?.agreementId === null
        ? undefined
        : String(doc.meta.agreementId),
    pricePerShare:
      priceDelta && typeof priceDelta.after === "number" ? priceDelta.after : undefined,
    orderSide,
  };
}

export interface DetectorResult {
  flaggedIds: Set<string>;
  finding: AuditAnomalyFinding | null;
}

function findingOrNull(
  type: AuditAnomalyType,
  flaggedIds: Set<string>,
  detail: string
): AuditAnomalyFinding | null {
  return flaggedIds.size > 0 ? { type, detail, flaggedRows: flaggedIds.size } : null;
}

// ── Detector: rapid_repeat ──────────────────────────────────────────────
// Same actor + same action >= N times within a short sliding window. Same
// sliding-window technique as suspectScan.ts's time_velocity detector, but
// keyed on (actor, action) over the audit spine instead of (subject, tx type)
// over financialTxLog — so it also catches non-money bursts (repeated votes,
// repeated party-donate clicks, repeated admin actions).
export function detectRapidRepeat(
  rows: AnomalyAuditRow[],
  config: Pick<
    AnomalyScanConfig,
    "rapidRepeatWindowSeconds" | "rapidRepeatThreshold"
  > = ANOMALY_SCAN_DEFAULTS
): DetectorResult {
  const flaggedIds = new Set<string>();
  const byActorAction = new Map<string, AnomalyAuditRow[]>();
  for (const row of rows) {
    if (!row.actorKey) continue;
    const key = `${row.actorKey}|${row.action}`;
    const arr = byActorAction.get(key) ?? [];
    arr.push(row);
    byActorAction.set(key, arr);
  }

  const windowMs = config.rapidRepeatWindowSeconds * 1000;
  const threshold = config.rapidRepeatThreshold;
  for (const group of byActorAction.values()) {
    if (group.length < threshold) continue;
    const sorted = [...group].sort((a, b) => a.ts.getTime() - b.ts.getTime());
    for (let i = 0; i + threshold - 1 < sorted.length; i++) {
      const span = sorted[i + threshold - 1].ts.getTime() - sorted[i].ts.getTime();
      if (span <= windowMs) {
        for (let j = i; j < i + threshold; j++) flaggedIds.add(sorted[j].id);
      }
    }
  }

  return {
    flaggedIds,
    finding: findingOrNull(
      "rapid_repeat",
      flaggedIds,
      `${flaggedIds.size} rows in same-actor/same-action bursts (>= ${threshold} within ${config.rapidRepeatWindowSeconds}s)`
    ),
  };
}

export function detectCircularWire(rows: AnomalyAuditRow[]): DetectorResult {
  return detectTransferCircularWire(rows);
}

export function detectWireFanInFanOut(
  rows: AnomalyAuditRow[],
  config: Pick<AnomalyScanConfig, "fanInThreshold" | "fanOutThreshold"> = ANOMALY_SCAN_DEFAULTS
): DetectorResult {
  return detectTransferWireFanInFanOut(rows, config);
}

// ── Detector: wash_trade ─────────────────────────────────────────────────
// Reuses suspectScan.ts's `same_price_wash` semantics: buy + sell on the
// same corp at the identical `pricePerShare`, by the same actor, within a
// short window — no PnL, suggesting churn to fake volume rather than a real
// investment decision.
export function detectWashTrade(
  rows: AnomalyAuditRow[],
  config: Pick<AnomalyScanConfig, "washTradeWindowSeconds"> = ANOMALY_SCAN_DEFAULTS
): DetectorResult {
  const flaggedIds = new Set<string>();
  const tradeRows = rows.filter(
    (r) => r.orderSide && r.subjectId && r.actorKey && typeof r.pricePerShare === "number"
  );

  const groups = new Map<string, AnomalyAuditRow[]>();
  for (const row of tradeRows) {
    // Round to 6dp to absorb display-precision noise, same as suspectScan.ts.
    const key = `${row.actorKey}|${row.subjectId}|${row.pricePerShare!.toFixed(6)}`;
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, arr);
  }

  const windowMs = config.washTradeWindowSeconds * 1000;
  for (const group of groups.values()) {
    const buys = group
      .filter((r) => r.orderSide === "buy")
      .sort((a, b) => a.ts.getTime() - b.ts.getTime());
    const sells = group
      .filter((r) => r.orderSide === "sell")
      .sort((a, b) => a.ts.getTime() - b.ts.getTime());
    if (buys.length === 0 || sells.length === 0) continue;

    const sellFlagDeltas = new Int32Array(sells.length + 1);
    let sellStart = 0;
    let sellEnd = 0;
    for (const b of buys) {
      const minTime = b.ts.getTime() - windowMs;
      const maxTime = b.ts.getTime() + windowMs;
      while (sellStart < sells.length && sells[sellStart].ts.getTime() < minTime) sellStart++;
      if (sellEnd < sellStart) sellEnd = sellStart;
      while (sellEnd < sells.length && sells[sellEnd].ts.getTime() <= maxTime) sellEnd++;
      if (sellStart < sellEnd) {
        flaggedIds.add(b.id);
        sellFlagDeltas[sellStart]++;
        sellFlagDeltas[sellEnd]--;
      }
    }
    let activeRanges = 0;
    for (let index = 0; index < sells.length; index++) {
      activeRanges += sellFlagDeltas[index];
      if (activeRanges > 0) flaggedIds.add(sells[index].id);
    }
  }

  return {
    flaggedIds,
    finding: findingOrNull(
      "wash_trade",
      flaggedIds,
      `${flaggedIds.size} rows in same-price buy/sell churn within ${config.washTradeWindowSeconds}s`
    ),
  };
}

// ── Detector: pre_election_funding_surge ─────────────────────────────────
// Many distinct payers pushing a large total into the same party/candidate
// recipient in a short burst, while an election is imminent. `isPreElection
// Window` is resolved once per scan by the DB wrapper (a narrow, indexed
// `elections` query) rather than re-derived per row.
export function detectPreElectionFundingSurge(
  rows: AnomalyAuditRow[],
  opts: { isPreElectionWindow: boolean } & Pick<
    AnomalyScanConfig,
    "preElectionFundingWindowSeconds" | "preElectionMinDistinctPayers" | "preElectionMinTotalAmount"
  >
): DetectorResult {
  const flaggedIds = new Set<string>();
  if (!opts.isPreElectionWindow) return { flaggedIds, finding: null };

  const fundingRows = rows.filter(
    (r) =>
      r.category === "money" &&
      r.subjectId &&
      r.counterpartyId &&
      typeof r.amount === "number" &&
      (r.action === "party.donate" ||
        r.action === "party.transfer" ||
        r.counterpartyType === "party")
  );

  const byRecipient = new Map<string, AnomalyAuditRow[]>();
  for (const row of fundingRows) {
    const arr = byRecipient.get(row.counterpartyId!) ?? [];
    arr.push(row);
    byRecipient.set(row.counterpartyId!, arr);
  }

  const windowMs = opts.preElectionFundingWindowSeconds * 1000;
  let surges = 0;
  for (const group of byRecipient.values()) {
    const sorted = [...group].sort((a, b) => a.ts.getTime() - b.ts.getTime());
    const payerCounts = new Map<string, number>();
    const flagDeltas = new Int32Array(sorted.length + 1);
    let start = 0;
    let distinctPayers = 0;
    let total = 0;
    for (let end = 0; end < sorted.length; end++) {
      const addedPayer = sorted[end].subjectId!;
      const addedCount = payerCounts.get(addedPayer) ?? 0;
      if (addedCount === 0) distinctPayers++;
      payerCounts.set(addedPayer, addedCount + 1);
      total += Math.abs(sorted[end].amount ?? 0);

      while (sorted[end].ts.getTime() - sorted[start].ts.getTime() > windowMs) {
        const removed = sorted[start];
        const removedPayer = removed.subjectId!;
        const remainingCount = (payerCounts.get(removedPayer) ?? 1) - 1;
        if (remainingCount === 0) {
          payerCounts.delete(removedPayer);
          distinctPayers--;
        } else {
          payerCounts.set(removedPayer, remainingCount);
        }
        total -= Math.abs(removed.amount ?? 0);
        start++;
      }
      if (
        distinctPayers >= opts.preElectionMinDistinctPayers &&
        total >= opts.preElectionMinTotalAmount
      ) {
        surges++;
        // Mark the qualifying range and materialize ids once after the scan.
        // Repeated overlapping surge windows used to slice, allocate a Set,
        // reduce, and revisit every row for every endpoint, making this O(n²)
        // for large party-funding groups.
        flagDeltas[start]++;
        flagDeltas[end + 1]--;
      }
    }
    let activeRanges = 0;
    for (let index = 0; index < sorted.length; index++) {
      activeRanges += flagDeltas[index];
      if (activeRanges > 0) flaggedIds.add(sorted[index].id);
    }
  }

  return {
    flaggedIds,
    finding: findingOrNull(
      "pre_election_funding_surge",
      flaggedIds,
      `${surges} funding-surge window(s) (>= ${opts.preElectionMinDistinctPayers} distinct payers, >= ${opts.preElectionMinTotalAmount.toLocaleString()} total) during a pre-election period`
    ),
  };
}

// ── Detector: off_hours_privileged_action ────────────────────────────────
// Admin-category rows (bans, resource grants, config edits, world resets)
// landing in a configured off-hours UTC window — surfaces privilege abuse
// without judging any legitimate admin's normal working hours.
export function detectOffHoursPrivilegedAction(
  rows: AnomalyAuditRow[],
  config: Pick<
    AnomalyScanConfig,
    "offHoursStartUtcHour" | "offHoursEndUtcHour"
  > = ANOMALY_SCAN_DEFAULTS
): DetectorResult {
  const flaggedIds = new Set<string>();
  const { offHoursStartUtcHour: start, offHoursEndUtcHour: end } = config;
  const inOffHours = (hour: number): boolean =>
    start <= end ? hour >= start && hour < end : hour >= start || hour < end;

  for (const row of rows) {
    if (row.category !== "admin") continue;
    if (inOffHours(row.ts.getUTCHours())) flaggedIds.add(row.id);
  }

  return {
    flaggedIds,
    finding: findingOrNull(
      "off_hours_privileged_action",
      flaggedIds,
      `${flaggedIds.size} admin-category actions between ${start}:00–${end}:00 UTC`
    ),
  };
}

// ── DB wrapper / turn-phase entry point ─────────────────────────────────

interface MinimalElection {
  _id: unknown;
  status?: string;
  endTurn?: number;
}

/** Narrow, indexed lookup: is any active/upcoming election's `endTurn`
 * within `preElectionWindowTurns` of `currentTurn`? Never a full scan —
 * bounded by status + turn range, capped at one document. Missing/absent
 * `elections` collection (unit/sim fixtures) resolves to `false` rather than
 * throwing, so this never blocks the rest of the scan. */
async function resolveIsPreElectionWindow(
  db: Db,
  currentTurn: number,
  windowTurns: number
): Promise<boolean> {
  try {
    const doc = await db.collection<MinimalElection>("elections").findOne(
      {
        status: { $in: ["active", "upcoming"] },
        endTurn: { $gte: currentTurn, $lte: currentTurn + windowTurns },
      },
      { projection: { _id: 1 } }
    );
    return doc !== null;
  } catch {
    return false;
  }
}

export interface AuditAnomalyScanResult {
  scannedRows: number;
  flaggedRows: number;
  findings: AuditAnomalyFinding[];
}

/**
 * Run every detector over the last `windowTurns` of `actionAuditLog`, stamp
 * `flags[]` back onto flagged rows, and persist one summary to
 * `auditAnomalies`. No-op (returns without touching either collection) when
 * `gameConfig.auditLog` is off or the window has no rows — this is a
 * best-effort phase, never load-bearing.
 */
export async function runAuditAnomalyScan(
  db: Db,
  currentTurn: number,
  config: AnomalyScanConfig = ANOMALY_SCAN_DEFAULTS
): Promise<AuditAnomalyScanResult | null> {
  try {
    if (!(await isAuditLogEnabled())) return null;

    const minTurn = currentTurn - config.windowTurns + 1;
    const col = await getActionAuditLogCollection(db);
    const docs = await col
      .find(
        { turn: { $gte: minTurn } },
        {
          projection: {
            _id: 1,
            ts: 1,
            traceId: 1,
            seq: 1,
            turn: 1,
            action: 1,
            category: 1,
            actor: 1,
            subject: 1,
            counterparty: 1,
            amount: 1,
            delta: 1,
            "meta.agreementId": 1,
          },
        }
      )
      .toArray();

    if (docs.length === 0) return null;

    const rows = docs.map(toAnomalyRow);
    const isPreElectionWindow = await resolveIsPreElectionWindow(
      db,
      currentTurn,
      config.preElectionWindowTurns
    );

    const results: DetectorResult[] = [
      detectRapidRepeat(rows, config),
      detectCircularWire(rows),
      detectWireFanInFanOut(rows, config),
      detectWashTrade(rows, config),
      detectPreElectionFundingSurge(rows, { isPreElectionWindow, ...config }),
      detectOffHoursPrivilegedAction(rows, config),
    ];

    const flagsById = new Map<string, Set<AuditAnomalyType>>();
    const findings: AuditAnomalyFinding[] = [];
    for (const { flaggedIds, finding } of results) {
      if (!finding) continue;
      findings.push(finding);
      for (const id of flaggedIds) {
        const set = flagsById.get(id) ?? new Set<AuditAnomalyType>();
        set.add(finding.type);
        flagsById.set(id, set);
      }
    }

    if (flagsById.size > 0) {
      const ops = Array.from(flagsById.entries()).map(([id, types]) => ({
        updateOne: {
          filter: { _id: new ObjectId(id) },
          update: { $addToSet: { flags: { $each: [...types] } } },
        },
      }));
      await col.bulkWrite(ops, { ordered: false });
    }

    const anomaliesCol = await getAuditAnomaliesCollection(db);
    await anomaliesCol.insertOne({
      _id: new ObjectId(),
      detectedAt: new Date(),
      turn: currentTurn,
      windowTurns: config.windowTurns,
      scannedRows: rows.length,
      flaggedRows: flagsById.size,
      findings,
    });

    return { scannedRows: rows.length, flaggedRows: flagsById.size, findings };
  } catch (err) {
    Sentry.captureException(err, { extra: { phase: "auditAnomalyScan", turn: currentTurn } });
    throw err;
  }
}
