import type { Db, ObjectId } from "mongodb";
import type { IndexFund, IndexFundPosition } from "@/lib/db/types/indexFund";
import { creditFundPosition, debitFundPosition } from "./fundQueries";

export interface ReleaseCharacterHeldPositionsResult {
  unitsReleased: number;
  positionsReleased: number;
}

/**
 * Remove a character's index-fund positions before they exit the game, the
 * fund analogue of `releaseCharacterHeldSharesToFloat` (shares → corp's
 * `publicFloat`) and `releaseCharacterHeldBondsToFloat` (bond units → issuer's
 * `publicFloat`) — same no-cash abandonment semantics, just reassigned to a
 * different accounting bucket:
 *
 * `IndexFund.unitSupply` is the fund's total outstanding claims and must stay
 * constant — the fund still holds the same underlying assets backing those
 * units, only the claimant changes. So instead of decrementing `unitSupply`
 * (which would desync it from the fund's real backing), the abandoned units
 * move to that fund's `fund_reserve` position (a special `IndexFundPosition`
 * with `holderKind: "fund_reserve"`, matched by `fundId` alone) via the same
 * atomic debit/credit primitives the real redemption flow uses. `reserveUnits`
 * on the `IndexFund` doc is a display-only field nothing else keeps live
 * (only ever set once, at fund-seed time) — deliberately not touched here.
 *
 * Without this, a retiring character's fund position is simply orphaned
 * (confirmed: no other code path — not the redeem route, not any admin/NPP
 * sweep — ever cleans one up), the same "index fund positions never get
 * cleaned up on exit" gap as bonds had before `releaseCharacterHeldBondsToFloat`.
 */
export async function releaseCharacterHeldIndexFundPositionsToFloat(
  db: Db,
  characterIds: ObjectId[]
): Promise<ReleaseCharacterHeldPositionsResult> {
  if (characterIds.length === 0) {
    return { unitsReleased: 0, positionsReleased: 0 };
  }

  const positions = await db
    .collection<IndexFundPosition>("indexFundPositions")
    .find(
      { holderKind: "character", characterId: { $in: characterIds } },
      { projection: { _id: 1, fundId: 1, characterId: 1, units: 1 } }
    )
    .toArray();

  let unitsReleased = 0;
  let positionsReleased = 0;

  for (const pos of positions) {
    const characterId = pos.characterId;
    const units = pos.units ?? 0;
    if (!characterId || units <= 0) continue;

    // CAS via debitFundPosition's own `units: { $gte: units }` guard (mirrors
    // the exact-unit-count CAS in releaseCharacterHeldBondsToFloat): if a
    // concurrent subscribe/redeem/dividend-reinvest changed this position
    // between our read and now, the debit no-ops (`ok: false`) rather than
    // releasing a stale unit count.
    const debited = await debitFundPosition(db, pos.fundId, "character", { characterId }, units);
    if (!debited.ok) continue;

    const fund = await db
      .collection<IndexFund>("indexFunds")
      .findOne({ _id: pos.fundId }, { projection: { quotedNav: 1 } });

    await creditFundPosition(db, pos.fundId, "fund_reserve", {}, units, fund?.quotedNav ?? 0);

    unitsReleased += units;
    positionsReleased += 1;
  }

  return { unitsReleased, positionsReleased };
}
