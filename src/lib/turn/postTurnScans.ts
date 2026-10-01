import type { Db } from "mongodb";
import * as Sentry from "@sentry/nextjs";
import { runFinancialSuspectScan } from "@/lib/financialTxLog/suspectScan";
import { runAuditAnomalyScan } from "@/lib/audit/anomalyScan";
import { processSuspiciousDetection } from "@/lib/turn/suspiciousDetection";
import { resolveAnomalyScanCadence } from "@/simulation/phases/anomalyScanCadence";

/**
 * Anti-abuse scans, run after the turn commits instead of inside it (#2694).
 *
 * The three scans only stamp flags (financial transactions, audit rows,
 * suspicious-account records) that admin tooling reads. Nothing later in the
 * turn consumes them, and each looks back over a rolling window of at least
 * six turns, so running them just after the turn loses nothing while taking
 * about 10 s off every third turn. Order is preserved: the audit anomaly scan
 * stamps the flags suspicious detection reads.
 *
 * Results and freshness land on the turn's log under `postTurnScans`, so a
 * failed or still-running scan is visible rather than silent. One run at a
 * time per process: if the previous turn's scans are still going, this turn's
 * are skipped and recorded as such; the rolling windows cover the gap.
 */
export type PostTurnScanName = "financialSuspectScan" | "auditAnomalyScan" | "suspiciousDetection";

type ScanRecord = {
  status: "completed" | "failed";
  startedAt: Date;
  completedAt: Date;
  ms: number;
  result?: Record<string, unknown>;
  error?: string;
};

declare global {
  var _ahdPostTurnScansRunning: boolean | undefined;
}

const SCANS: Array<{
  name: PostTurnScanName;
  run: (db: Db, turn: number) => Promise<unknown>;
  summarize: (result: unknown) => Record<string, unknown>;
}> = [
  {
    name: "financialSuspectScan",
    run: (db, turn) => runFinancialSuspectScan(db, turn),
    summarize: () => ({}),
  },
  {
    name: "auditAnomalyScan",
    run: (db, turn) => runAuditAnomalyScan(db, turn),
    summarize: (r) => {
      const result = r as { scannedRows?: number; flaggedRows?: number } | null;
      return { scannedRows: result?.scannedRows ?? 0, flaggedRows: result?.flaggedRows ?? 0 };
    },
  },
  {
    name: "suspiciousDetection",
    run: (db, turn) => processSuspiciousDetection(db, turn),
    summarize: (r) => {
      const result = r as { flagged?: number; cleared?: number; deleted?: number } | null;
      return {
        flagged: result?.flagged ?? 0,
        cleared: result?.cleared ?? 0,
        deleted: result?.deleted ?? 0,
      };
    },
  },
];

/** Whether this turn is on the scan cadence (every Nth turn, see anomalyScanCadence). */
export function isPostTurnScanTurn(
  turn: number,
  everyTurns = resolveAnomalyScanCadence()
): boolean {
  return everyTurns <= 1 || turn % everyTurns === 0;
}

export async function runPostTurnIntegrityScans(
  db: Db,
  turn: number,
  options: { everyTurns?: number; now?: () => Date } = {}
): Promise<Record<PostTurnScanName, ScanRecord> | null> {
  if (!isPostTurnScanTurn(turn, options.everyTurns)) return null;
  const now = options.now ?? (() => new Date());
  const logs = db.collection("turnLogs");
  if (globalThis._ahdPostTurnScansRunning) {
    await logs
      .updateOne(
        { turn },
        {
          $set: {
            postTurnScans: { status: "skipped", reason: "previous scans still running", at: now() },
          },
        }
      )
      .catch(() => {});
    return null;
  }
  globalThis._ahdPostTurnScansRunning = true;
  const records = {} as Record<PostTurnScanName, ScanRecord>;
  try {
    await logs
      .updateOne({ turn }, { $set: { postTurnScans: { status: "running", startedAt: now() } } })
      .catch(() => {});
    for (const scan of SCANS) {
      const startedAt = now();
      try {
        const result = await scan.run(db, turn);
        const completedAt = now();
        records[scan.name] = {
          status: "completed",
          startedAt,
          completedAt,
          ms: completedAt.getTime() - startedAt.getTime(),
          result: scan.summarize(result),
        };
      } catch (err) {
        const completedAt = now();
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[post-turn] ${scan.name} failed for turn ${turn}: ${message}`, err);
        Sentry.captureException(err, { extra: { scan: scan.name, turn } });
        records[scan.name] = {
          status: "failed",
          startedAt,
          completedAt,
          ms: completedAt.getTime() - startedAt.getTime(),
          error: message,
        };
      }
    }
    const failed = Object.values(records).some((r) => r.status === "failed");
    await logs
      .updateOne(
        { turn },
        {
          $set: {
            postTurnScans: {
              status: failed ? "failed" : "completed",
              completedAt: now(),
              scans: records,
            },
          },
        }
      )
      .catch((err) => console.warn("[post-turn] could not record scan results", err));
    return records;
  } finally {
    globalThis._ahdPostTurnScansRunning = false;
  }
}
