import type { ObjectId } from "mongodb";
import type { AlignmentCountryKey } from "@/lib/constants/alignmentRoster";
import type { CountryId } from "@/lib/constants/countries";
import type { InternationalOrganizationId } from "@/lib/constants/internationalOrganizations";

/**
 * An influence play: a member spending its organization's pooled fund to pull a
 * nation toward that org's alignment pole.
 *
 * Queued when committed and consumed by the alignment turn phase, which folds it
 * into the same pull vector drift feeds — so a play inherits the non-aligned
 * resistance, the locked gate and the per-nation turn cap for free.
 *
 * Resolved rows are STAMPED rather than deleted (`resolvedTurn`, `appliedPoints`)
 * so a member can see what its money actually bought. That is the difference
 * between a lever and a slot machine.
 */
export interface AlignmentPlay {
  _id: ObjectId;
  organizationId: InternationalOrganizationId;
  /** Member that paid for it. */
  sponsorCountryId: CountryId;
  targetEntityId: AlignmentCountryKey;
  /** USD value of the spend, so the phase need not re-run FX. */
  amountUsd: number;
  /** Fund-currency amount actually debited, for the audit trail. */
  amountLocal: number;
  /** Turn it was committed on. */
  turn: number;
  /** Set when the alignment phase consumes it. Null while pending. */
  resolvedTurn: number | null;
  /** Share points it contributed, after the channel weight. Null while pending. */
  appliedPoints: number | null;
  /**
   * True when the spend was returned to the fund because the play resolved to
   * exactly zero points — the target locked, or lost its alignment row, inside
   * the turn between commit and resolve. Absent on rows written before refunds
   * existed; read as "not refunded".
   */
  refunded?: boolean;
  /**
   * What bought this pull. A `play` is money spent purely on influence; `aid` is
   * an aid package, which delivers the money to the recipient's treasury as well.
   * Absent on rows written before aid carried alignment weight — read as "play".
   */
  source?: "play" | "aid";
  createdAt: Date;
}
