import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { OrgRegLedger, PoliticalParty, StatePartyOrg } from "@/lib/db/types";

export interface StateRegLedgerResult {
  seeded: boolean;
  headline: { partyId: string; abbr: string; color: string; regPct: number } | null;
  movement: Array<{ turn: number; regPct: number }>;
}

const NEUTRAL_COLOR = "#6b6b7a";
/** Default lookback window (turns) for the movement sparkline. */
export const REG_LEDGER_LOOKBACK_TURNS = 24;
/**
 * Upper bound on `reg` ledger rows one party can receive in a single turn.
 * Used to size the over-fetch so the per-turn collapse still covers the full
 * lookback window.
 *
 * Budget: 3 from `regDriftDecay` (renormalize + drift + decay) plus, from
 * `demographicTurnoutTurn`, the party's own registration-drive row AND one
 * NEGATIVE row for every rival whose drive sources its surplus. That last term
 * scales with the number of parties funding drives in the state — all six US
 * parties currently do, which is 8 rows in a turn against the old budget of 4,
 * and an undersized budget silently returns half the requested window rather
 * than failing. 16 leaves headroom for a country with a wider roster; it only
 * costs a larger capped read on an indexed query.
 */
const MAX_REG_ROWS_PER_TURN = 16;

/**
 * Read the per-state Registration headline + recent movement. First reader of
 * `orgRegLedger`. Returns an honest unseeded result (no fabricated numbers)
 * when no party in the state has a defined `registration` value.
 */
export async function getStateRegLedger(
  db: Db,
  args: { countryId: CountryId; stateId: string; lookbackTurns?: number }
): Promise<StateRegLedgerResult> {
  const { countryId, stateId } = args;
  const lookback = args.lookbackTurns ?? REG_LEDGER_LOOKBACK_TURNS;

  const rows = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({ countryId, stateId })
    .toArray();

  const seededRows = rows.filter((r) => typeof r.registration === "number");
  if (seededRows.length === 0) {
    return { seeded: false, headline: null, movement: [] };
  }

  // Top-Reg party is the headline.
  const top = seededRows.reduce((best, r) =>
    (r.registration ?? 0) > (best.registration ?? 0) ? r : best
  );

  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId })
    .toArray();
  const partyBySeq = new Map(parties.map((p) => [String(p.sequentialId), p]));
  const topParty = partyBySeq.get(top.partyId);

  const headline = {
    partyId: top.partyId,
    abbr: topParty?.abbreviation ?? top.partyId.toUpperCase(),
    color: topParty?.color ?? NEUTRAL_COLOR,
    regPct: top.registration ?? 0,
  };

  // Recent reg movement for the headline party (descending turn from the
  // index, then re-sorted ascending for the sparkline).
  //
  // A party can carry several `reg` rows in one turn: renormalize, drift
  // (including a negative drift row when its surplus is sourced by a climbing
  // rival), and decay are each written separately, in that order, within one
  // batch insert — plus registration-drive rows from the earlier GOTV phase,
  // both its own gain and a negative row per rival drive that sourced its
  // surplus. The sparkline wants one point per turn holding the running
  // total after the LAST of those writes, so over-fetch by the maximum rows a
  // turn can carry, keep the greatest _id per turn (ObjectIds in a batch are
  // generated in array order), and only then cut to the lookback window. The
  // sort stays on `turn` alone so it is served by `reg_ledger_lookup`; the
  // within-turn ordering is resolved here rather than by a blocking sort.
  const ledgerRows = await db
    .collection<OrgRegLedger>("orgRegLedger")
    .find({ countryId, stateId, partyId: top.partyId, metric: "reg" })
    .sort({ turn: -1 })
    .limit(lookback * MAX_REG_ROWS_PER_TURN)
    .toArray();

  const lastByTurn = new Map<number, { id: string; value: number }>();
  for (const l of ledgerRows) {
    const id = String(l._id);
    const cur = lastByTurn.get(l.turn);
    if (!cur || id > cur.id) lastByTurn.set(l.turn, { id, value: l.value });
  }
  const movement = Array.from(lastByTurn.entries())
    .sort((a, b) => b[0] - a[0])
    .slice(0, lookback)
    .map(([turn, { value }]) => ({ turn, regPct: value }))
    .sort((a, b) => a.turn - b.turn);

  return { seeded: true, headline, movement };
}
