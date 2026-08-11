/**
 * Pure builders for the presidential "Registration Influence" card data.
 *
 * The card (`RegistrationInfluenceCard`) consumes the view-model's
 * `regByState` (a per-state party-lean breakdown) + `partyDisplayById`
 * (abbreviation + color per partyId). This module turns the server-side
 * `statePartyOrg.registration` + `stateRegistrationPool` rows into those
 * shapes so `_enrichElection` can attach them to the presidential response.
 *
 * Keying contract: `statePartyOrg.partyId` and `electionCandidate.party`
 * are both the party's `sequentialId` rendered as a string ("1", "2", …),
 * so `partyDisplayById` is keyed the same way.
 *
 * Per `StateRegistrationPool`, a state's registration sums to 100%:
 *   Σ statePartyOrg.registration + pool.independent + pool.unregistered = 100
 * — so passing the raw `registration` value as `leanPct` produces a stacked
 * bar that fills the bar honestly. The view-model clamps/sorts downstream.
 */

interface PartyDisplaySource {
  sequentialId: number;
  abbreviation: string;
  color: string;
}

interface StatePartyOrgRow {
  stateId: string;
  partyId: string;
  registration?: number;
  /** Present on real rows; ignored here — registration is the only signal read. */
  organization?: number;
}

interface RegistrationPoolRow {
  stateId: string;
  independent?: number;
  unregistered?: number;
}

export interface RegByStateInput {
  partyShares: { partyId: string; leanPct: number }[];
  independent?: number;
  unregistered?: number;
}

/** Party abbreviation + color keyed by `String(sequentialId)`. */
export function buildPartyDisplayById(
  parties: PartyDisplaySource[]
): Record<string, { abbr: string; color: string }> {
  const out: Record<string, { abbr: string; color: string }> = {};
  for (const p of parties) {
    out[String(p.sequentialId)] = { abbr: p.abbreviation, color: p.color };
  }
  return out;
}

/**
 * Build the per-state `regByState` view-model input from registration rows.
 *
 * Only states with at least one registration-bearing party row are emitted;
 * states with no registration data are omitted so the card renders its honest
 * "no registration data tracked" placeholder rather than an empty bar.
 */
export function buildPresidentialRegByStateInput(
  statePartyOrgs: StatePartyOrgRow[],
  pools: RegistrationPoolRow[]
): Record<string, RegByStateInput> {
  const poolByState = new Map(pools.map((p) => [p.stateId, p]));

  const sharesByState = new Map<string, { partyId: string; leanPct: number }[]>();
  for (const po of statePartyOrgs) {
    if (typeof po.registration !== "number") continue;
    const list = sharesByState.get(po.stateId) ?? [];
    list.push({ partyId: po.partyId, leanPct: po.registration });
    sharesByState.set(po.stateId, list);
  }

  const out: Record<string, RegByStateInput> = {};
  for (const [stateId, partyShares] of sharesByState) {
    const pool = poolByState.get(stateId);
    out[stateId] = {
      partyShares,
      ...(typeof pool?.independent === "number" ? { independent: pool.independent } : {}),
      ...(typeof pool?.unregistered === "number" ? { unregistered: pool.unregistered } : {}),
    };
  }
  return out;
}
