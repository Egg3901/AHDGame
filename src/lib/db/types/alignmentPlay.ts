import type { ObjectId } from "mongodb";
import type { AlignmentPoleId } from "@/lib/constants/alignmentEras";
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
 * Resolved rows are stamped rather than deleted. `appliedPoints` preserves the
 * accounting input; `effectivePoints` reports the attributed final share gain.
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
  /** Raw pull after channel weight and bloc strain, before drift. Null while pending. */
  appliedPoints: number | null;
  /**
   * Attributed share gain after opposition, resistance, the shared turn cap and
   * normalization. Absent on legacy rows; never substitute appliedPoints.
   * Zero effective gain does not itself entitle a play to a refund.
   */
  effectivePoints?: number;
  /** Pole the play resolved toward, so later era/channel changes cannot relabel its gain. */
  effectivePoleId?: AlignmentPoleId;
  /**
   * True when the spend was returned to the fund because the play resolved to
   * exactly zero raw applied points: the target locked, or lost its alignment row, inside
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
