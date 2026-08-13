/**
 * A8 phase 2: valuing what a pension scheme owns.
 *
 * A scheme's assets stopped being one number the moment it could invest. The
 * cash leg lives on the scheme document; the invested leg lives in
 * `indexFundPositions`, which is the source of truth for units. This module is
 * the ONLY place that turns those positions into a ₳ figure, so there is one
 * definition of a scheme's invested value and the funding ratio cannot quietly
 * disagree with the fund book.
 *
 * Marked to market at the fund's quoted NAV, not at cost. A scheme that bought
 * into a fund which then fell is really worse funded, and the ratio should say
 * so rather than reporting the price it paid.
 */

import { ObjectId, type Db } from "mongodb";
import type { IndexFund, IndexFundPosition } from "@/lib/db/types/indexFund";
import type { PensionScheme } from "@/lib/db/types/pensionScheme";

export const FUND_POSITIONS = "indexFundPositions";
export const INDEX_FUNDS = "indexFunds";
export const PENSION_SCHEMES = "pensionSchemes";

/**
 * Current ₳ value of every scheme's fund units, keyed by scheme id string.
 *
 * Schemes with no positions are absent from the map rather than present at
 * zero, so a caller can tell "holds nothing" from "was not asked about".
 * A position pointing at a fund that no longer exists values at zero: units of
 * a deleted fund are worth nothing, and guessing otherwise would inflate the
 * ratio of exactly the scheme that lost its investment.
 */
export async function loadSchemeInvestedValues(
  db: Db,
  schemeIds: ObjectId[]
): Promise<Map<string, number>> {
  const byScheme = new Map<string, number>();
  if (schemeIds.length === 0) return byScheme;

  const positions = await db
    .collection<IndexFundPosition>(FUND_POSITIONS)
    .find(
      { holderKind: "pension_scheme", pensionSchemeId: { $in: schemeIds } },
      { projection: { pensionSchemeId: 1, fundId: 1, units: 1 } }
    )
    .toArray();
  if (positions.length === 0) return byScheme;

  const fundIds = [...new Set(positions.map((p) => p.fundId.toString()))].map(
    (id) => new ObjectId(id)
  );
  const funds = await db
    .collection<IndexFund>(INDEX_FUNDS)
    .find({ _id: { $in: fundIds } }, { projection: { quotedNav: 1 } })
    .toArray();
  const navByFund = new Map(funds.map((f) => [f._id.toString(), f.quotedNav]));

  for (const position of positions) {
    const schemeId = position.pensionSchemeId?.toString();
    if (!schemeId) continue;
    const nav = navByFund.get(position.fundId.toString()) ?? 0;
    const units =
      typeof position.units === "number" && Number.isFinite(position.units)
        ? Math.max(0, position.units)
        : 0;
    const value = units * (Number.isFinite(nav) ? Math.max(0, nav) : 0);
    byScheme.set(schemeId, (byScheme.get(schemeId) ?? 0) + value);
  }

  return byScheme;
}

/**
 * Mark every scheme's invested value to market and write it back.
 *
 * Called at both ends of the pension turn: once before contributions, so a
 * top-up is charged against what the scheme is worth TODAY rather than what it
 * was worth when it last bought units, and once after the investment pass, so
 * the union surface never shows cash that has already left as still being cash
 * with nothing to show for it.
 *
 * Writes only where the value actually changed. Most schemes hold nothing and
 * should not be touched every turn.
 */
export async function refreshSchemeInvestedValues(db: Db): Promise<number> {
  const schemes = await db
    .collection<PensionScheme>(PENSION_SCHEMES)
    .find({}, { projection: { investedValueAnchor: 1 } })
    .toArray();
  if (schemes.length === 0) return 0;

  const valueByScheme = await loadSchemeInvestedValues(
    db,
    schemes.map((s) => s._id)
  );

  const now = new Date();
  let updated = 0;
  for (const scheme of schemes) {
    const next = valueByScheme.get(scheme._id.toString()) ?? 0;
    const current = scheme.investedValueAnchor ?? 0;
    // Exact equality is the right test: both sides are the same product of the
    // same stored numbers, so a scheme whose units and NAV did not move
    // produces a byte-identical figure and is correctly skipped.
    if (next === current) continue;
    await db
      .collection<PensionScheme>(PENSION_SCHEMES)
      .updateOne({ _id: scheme._id }, { $set: { investedValueAnchor: next, updatedAt: now } });
    updated += 1;
  }
  return updated;
}
