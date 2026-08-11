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
  const ledgerRows = await db
    .collection<OrgRegLedger>("orgRegLedger")
    .find({ countryId, stateId, partyId: top.partyId, metric: "reg" })
    .sort({ turn: -1 })
    .limit(lookback)
    .toArray();

  const movement = ledgerRows
    .map((l) => ({ turn: l.turn, regPct: l.value }))
    .sort((a, b) => a.turn - b.turn);

  return { seeded: true, headline, movement };
}
