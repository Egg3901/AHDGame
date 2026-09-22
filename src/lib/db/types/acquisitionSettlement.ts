import type { ObjectId } from "mongodb";
import type { FinancialTxType } from "./financialTxLog";

/** Lifecycle of one agreed-acquisition money settlement (one row per offer). */
export type AcquisitionSettlementStatus = "in_progress" | "applied" | "compensated";

export type AcquisitionLegKind =
  | "acquirer_debit"
  | "holder_credit"
  | "shell_cash_credit"
  | "acquirer_refund"
  | "shell_cash_reversal";

/**
 * One pinned money leg of an agreed acquisition. Every amount and recipient is
 * resolved once, before any money moves, and replayed verbatim on retry — so a
 * retry can never recompute (and double-pay) from drifted FX or roster state.
 *
 * Each leg applies as a single atomic document write (credit plus idempotency
 * stamp in one `updateOne`), the same shape as the banking `applyLeg`: a replay
 * of a landed leg matches nothing and is read back as applied from the stamp.
 */
export interface AcquisitionSettlementLeg {
  /** Stable within the offer (e.g. "debit", "holder:character:<hex>"). */
  key: string;
  kind: AcquisitionLegKind;
  /** Collection holding the balance document. */
  collection: string;
  /** Pinned recipient selector. ObjectIds, never strings. */
  filter: Record<string, unknown>;
  /** Pinned balance increments applied in one write. */
  inc: Record<string, number>;
  /**
   * Idempotent cleanup applied BEFORE the stamped credit (index-fund holding
   * removal). A `$pull` of an absent element is a no-op, so crash-then-replay
   * between the pull and the credit still credits exactly once.
   */
  pull?: { path: string; selector: Record<string, unknown> };
  /** Sufficiency guard field (debit legs only): the write matches only above it. */
  guardPath?: string;
  guardGte?: number;
  /** Holder slice in anchor units, for audit and compensation accounting. */
  payoutAnchor: number;
  /**
   * Pinned cost of this leg in the acquirer's capital units. Terminal
   * compensation refunds `price` minus the applied holder-leg costs, so every
   * holder leg must know what the acquirer paid for it regardless of later FX
   * drift. Shell-cash legs carry their cost for audit only: the relocation is
   * unwound by taking it back from the acquirer, never by shrinking the refund.
   */
  costInAcquirerCapital: number;
  currencyCode: string;
  note: string;
  applied: boolean;
  ledgerEmitted: boolean;
  /** Ledger legs emitted right after this money leg lands (same content as the legacy flush). */
  ledgers: Array<{
    type: FinancialTxType;
    amount: number;
    currencyCode: string;
    subjectType: "character" | "corporation" | "government";
    subjectId?: ObjectId;
    subjectName: string;
    countryId?: string;
    counterpartyType: "character" | "corporation" | "government";
    counterpartyId: ObjectId;
    counterpartyName?: string;
    meta: Record<string, unknown>;
  }>;
}

export interface AcquisitionSettlementResult {
  sectorsMoved: number;
  priceAnchor: number;
  acquirerName: string;
  targetName: string;
  bankCharterTransferred: boolean;
}

/**
 * Durable record of one agreed-acquisition execution, keyed by offer id. The
 * retry path resumes from this record: pinned legs are never recomputed, landed
 * legs are skipped by stamp, and a completed settlement returns its recorded
 * result instead of re-executing.
 */
export interface AcquisitionSettlement {
  /** The acquisition offer this settlement executes. */
  _id: ObjectId;
  /** Stable idempotency key: `agreed_acquisition:<offerHex>`. */
  key: string;
  status: AcquisitionSettlementStatus;
  acquirerCorporationId: ObjectId;
  targetCorporationId: ObjectId;
  acquirerName: string;
  targetName: string;
  priceAnchor: number;
  priceInAcquirerCapital: number;
  acquirerCurrency: string;
  legs: AcquisitionSettlementLeg[];
  /** Review whose remedy attaches on commit (persisted for post-teardown retries). */
  remedyReviewId?: string;
  /** Acquirer-capital units refunded to the acquirer across compensations. */
  refundTotal: number;
  /**
   * Target sector count pinned at claim time, before any move. The recorded
   * `sectorsMoved` total is derived as `sectorTotal` minus the sectors still
   * on the target, so moves landed by an attempt that crashed before marking
   * are still counted on retry.
   */
  sectorTotal: number;
  /** Shell cash in the target's own units (for the reversal leg on compensation). */
  shellCashTargetLocal: number;
  targetCurrency: string;
  sectorsMoved: number;
  bankCharterTransferred: boolean;
  /** Set after the target shell row is deleted. */
  shellDeleted: boolean;
  completedResult?: AcquisitionSettlementResult;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}
