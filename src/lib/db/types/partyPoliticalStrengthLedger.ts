import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

/**
 * Source of a `partyPoliticalStrengthLedger` row.
 *
 * - `passive` — the per-turn `+1` trickle granted by `partyActionGeneration`.
 * - `treasury` — country-normalized treasury-driven gain (also from
 *   `partyActionGeneration`), limited by the hard cap headroom.
 * - `spend` — a debit from `spendPoliticalStrength` when a player / chair
 *   action consumes PS (Org Building, Influence, Contest, Recruitment, etc.).
 * - `decay` — reserved for future PS decay rules (Phase 3 has none, but the
 *   union slot is here so the ledger can absorb a decay processor without a
 *   schema change).
 *
 * Distinct from `orgRegLedger` per Phase 0.5 §5.6: that ledger tracks
 * Org / Reg / Support mutations; this one tracks PS reserve movements only.
 */
export type PartyPoliticalStrengthSource = "passive" | "treasury" | "spend" | "decay";

/**
 * Audit-trail row for a single PS reserve movement on a Party or
 * StatePartyOrg document. Written inline by the `partyActionGeneration`
 * processor and the `spendPoliticalStrength` command.
 *
 * `stateId` is set when the row tracks a state-party PS movement (national
 * party actions in a specific state still write `stateId` so the
 * per-geography pressure ladder has a foreign key into the geography).
 *
 * See plan §"Phase 3 — Decisions Recorded During Execution" D2 + Phase 0.5
 * §5.6 distinction.
 */
export interface PartyPoliticalStrengthLedgerRow {
  _id: ObjectId;
  countryId: CountryId;
  partyId: string;
  /** Set when the movement is tied to a specific state. National-only rows leave it unset. */
  stateId?: string;
  turn: number;
  source: PartyPoliticalStrengthSource;
  /** Signed change in PS — positive for gains, negative for spends / decay. */
  delta: number;
  /** Resulting PS value after the change. Audit redundancy. */
  value: number;
  /**
   * When `source === "spend"`, the action key (matches the API route slug
   * — `org-building`, `influence`, `recruitment`, `contest`, etc.). Unset
   * for passive / treasury / decay rows.
   */
  action?: string;
  /**
   * When `source === "spend"`, the geography key the spend escalated. For
   * national actions in a specific state this matches `stateId`; for purely
   * national actions (Phase 3 has none, but kept for future) this is unset.
   */
  geography?: string;
  createdAt: Date;
}
