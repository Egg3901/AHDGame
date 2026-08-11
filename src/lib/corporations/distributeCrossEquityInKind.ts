import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import {
  computeInKindEquityDistribution,
  type InKindShareholder,
} from "@/lib/corporations/inKindEquityDistribution";
import {
  creditShares,
  creditSharesToImperial,
  creditSharesToCorp,
  creditSharesToFund,
} from "@/lib/corporations/shareholderOps";
import { upsertFundHoldingShares } from "@/lib/indexFunds/fundQueries";
import { getCorpFxRate, shareTradeAnchorValue } from "@/lib/currency/corporationCapital";

/**
 * Distribute a dissolving corp's holdings in OTHER corps IN-KIND, pro-rata to
 * the dissolving corp's own cap table — instead of cashing them out at market
 * price (the money-mint both dissolution paths used to do: they credited
 * `shares × issuer.sharePrice` into liquidCapital with no counterparty debit,
 * letting a ring pump prices and extract the difference). No cash is created
 * and every issuer's `totalShares` stays invariant: the dissolving corp's stake
 * simply moves to its shareholders (and its public-float fraction to the
 * issuer's public float). A corp may never hold its own shares, so any
 * allocation back to the issuer itself (cross-holding rings hit this) is routed
 * to the issuer's public float instead.
 *
 * Shared by the quick-dissolve route and the bond-default dissolution.
 */
export async function distributeCrossEquityInKind(
  db: Db,
  dissolvingCorp: Pick<Corporation, "_id" | "shareholders" | "totalShares" | "publicFloat">,
  now: Date
): Promise<void> {
  const inKindShareholders = (dissolvingCorp.shareholders ?? [])
    .map((s): InKindShareholder | null => {
      if (s.characterId)
        return { id: s.characterId.toString(), kind: "character", shares: s.shares };
      if (s.imperialCharacterId)
        return { id: s.imperialCharacterId.toString(), kind: "imperial", shares: s.shares };
      if (s.corporationId)
        return { id: s.corporationId.toString(), kind: "corporation", shares: s.shares };
      if (s.fundId) return { id: s.fundId.toString(), kind: "fund", shares: s.shares };
      return null;
    })
    .filter((x): x is InKindShareholder => x !== null && x.shares > 0);
  const totalShares = dissolvingCorp.totalShares ?? 0;
  const publicFloatShares = dissolvingCorp.publicFloat ?? 0;

  const heldEquityCorps = await db
    .collection<Corporation>("corporations")
    .find(
      { "shareholders.corporationId": dissolvingCorp._id },
      {
        projection: { _id: 1, sharePrice: 1, shareholders: 1, liquidCurrencyCode: 1, countryId: 1 },
      }
    )
    .toArray();

  for (const issuer of heldEquityCorps) {
    const entry = issuer.shareholders?.find(
      (s) => s.corporationId?.toString() === dissolvingCorp._id.toString()
    );
    if (!entry || entry.shares <= 0) continue;

    const dist = computeInKindEquityDistribution({
      shareholders: inKindShareholders,
      publicFloatShares,
      totalShares,
      blockShares: entry.shares,
    });

    let floatShares = dist.publicFloatShares;
    const credits = dist.allocations.filter((a) => {
      if (a.kind === "corporation" && a.id === issuer._id.toString()) {
        floatShares += a.shares;
        return false;
      }
      return true;
    });

    await db.collection<Corporation>("corporations").updateOne(
      { _id: issuer._id, "shareholders.corporationId": dissolvingCorp._id },
      {
        $pull: { shareholders: { corporationId: dissolvingCorp._id } },
        ...(floatShares > 0 ? { $inc: { publicFloat: floatShares } } : {}),
        $set: { updatedAt: now },
      }
    );

    // Carry the dissolving corp's cost basis for this holding to recipients.
    const basis = entry.avgCostPerShare ?? issuer.sharePrice ?? 0;
    for (const alloc of credits) {
      const recipientId = new ObjectId(alloc.id);
      if (alloc.kind === "character") {
        await creditShares(
          db,
          issuer._id,
          recipientId,
          alloc.shares,
          { $set: { updatedAt: now } },
          { pricePerShare: basis }
        );
      } else if (alloc.kind === "imperial") {
        await creditSharesToImperial(
          db,
          issuer._id,
          recipientId,
          alloc.shares,
          { $set: { updatedAt: now } },
          { pricePerShare: basis }
        );
      } else if (alloc.kind === "fund") {
        await creditSharesToFund(db, issuer._id, recipientId, alloc.shares, basis, {
          $set: { updatedAt: now },
        });
        // Mirror the cap-table credit into the fund's own holdings ledger
        // (anchor currency) so NAV reflects the windfall; non-constituent
        // positions are liquidated by the next rebalance sweep.
        const fxRate = await getCorpFxRate(db, issuer);
        const basisAnchor = shareTradeAnchorValue(1, { ...issuer, sharePrice: basis }, fxRate);
        await upsertFundHoldingShares(db, recipientId, issuer._id, alloc.shares, basisAnchor);
      } else {
        await creditSharesToCorp(db, issuer._id, recipientId, alloc.shares, basis, {
          $set: { updatedAt: now },
        });
      }
    }
  }
}
