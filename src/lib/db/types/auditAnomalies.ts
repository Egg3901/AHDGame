import type { ObjectId } from "mongodb";

/**
 * `auditAnomalies` — compact scan summaries written by
 * `src/lib/audit/anomalyScan.ts` (forensics/alt-detection rework plan §3.1
 * "Anomaly scanners", Phase 3 T3.1). Mirrors the `apiAbuseScans` pattern
 * (`src/lib/api/abuseDetection.ts`): the detectors themselves stamp
 * `flags[]` back onto the offending `actionAuditLog` rows for per-row
 * drill-down; this collection is the "what ran, what did it find" rollup for
 * the Forensic Explorer / admin dashboards to list without re-scanning.
 */

/** Matches the detector set in `anomalyScan.ts`. Kept as its own union
 * (rather than reusing `ActionAuditRecord.flags: string[]`) so callers get
 * autocomplete/typo-safety when filtering by anomaly type. */
export type AuditAnomalyType =
  | "rapid_repeat"
  | "circular_wire"
  | "wire_fanin_fanout"
  | "wash_trade"
  | "pre_election_funding_surge"
  | "off_hours_privileged_action";

/** One detector's result for a single scan run. `null`/absent when nothing
 * fired — the scan only appends findings for detectors that flagged rows. */
export interface AuditAnomalyFinding {
  type: AuditAnomalyType;
  /** Human-readable summary (thresholds used, counts) — no raw PII. */
  detail: string;
  flaggedRows: number;
}

export interface AuditAnomalyScan {
  _id: ObjectId;
  detectedAt: Date;
  /** Turn the scan ran on. */
  turn: number;
  /** Lookback window (in turns) the scan queried `actionAuditLog` over. */
  windowTurns: number;
  scannedRows: number;
  /** Distinct `actionAuditLog` rows flagged by at least one detector (rows
   * can be flagged by more than one detector; this counts rows, not tags). */
  flaggedRows: number;
  findings: AuditAnomalyFinding[];
}

export type AuditAnomalyScanInput = Omit<AuditAnomalyScan, "_id">;
