import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import * as Sentry from "@sentry/nextjs";
import { getDb } from "@/lib/mongodb";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { consolidateSharesSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { hasOpenPrivatizationVote } from "@/lib/corporations/commands/privatization/openVoteGuard";
import { getGameState } from "@/lib/gameState";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { getEraFounderShares } from "@/lib/constants/sectorSeedEra";
import {
  MAX_FORWARD_SHARE_SPLIT_MULTIPLIER,
  MIN_SHARE_PRICE,
  SHARE_CONSOLIDATION_MIN_TOTAL_SHARES,
  SHARE_STRUCTURE_COOLDOWN_TURNS,
} from "@/lib/constants/corporations";
import {
  allocateProportionalShareTotals,
  findDroppedShareholders,
  corporationCanRestructureShares,
  planFundHoldingSplitSync,
  scaleSharePricesForStructureChange,
  sumAccountedOutstandingShares,
} from "@/lib/corporations/shareConsolidation";
import { cleanupShareMarketActivityForCorporationTargets } from "@/lib/corporations/cleanupShareMarketActivity";
import { buildStructureChangeHolderList } from "@/lib/corporations/structureChangeSnapshot";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import { generateStockExchangeSnapshots } from "@/lib/turn/stockExchangeSnapshot";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import type { Character, Corporation, Shareholder, ImperialCharacter } from "@/lib/db/types";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/shares/consolidate
 * CEO-only stock split or reverse split: change total outstanding shares and scale prices
 * so market cap is unchanged. Applies proportionally to all shareholders and the public float.
 * 48-turn cooldown. Open share orders, private listings, and pending offers on the
 * corporation are cancelled and refunded before the restructure runs (escrow to buyers,
 * reserved shares to sellers) so leftover pre-split share counts cannot fill on the next
 * turn and wipe holders (ticket #1154).
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, consolidateSharesSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { targetTotalShares } = parsed.data;
    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (await hasOpenPrivatizationVote(db, corporation._id)) {
      return NextResponse.json(
        { error: "Cannot restructure shares while a privatization vote is open" },
        { status: 400 }
      );
    }

    const eligibility = corporationCanRestructureShares(corporation);
    if (!eligibility.ok) {
      return NextResponse.json({ error: eligibility.reason }, { status: 400 });
    }

    const gameState = await getGameState(db);
    const currentTurn = gameState?.currentTurn ?? 0;
    const lastStructure = corporation.lastShareStructureTurn;
    if (lastStructure != null && currentTurn < lastStructure + SHARE_STRUCTURE_COOLDOWN_TURNS) {
      const wait = lastStructure + SHARE_STRUCTURE_COOLDOWN_TURNS - currentTurn;
      return NextResponse.json(
        {
          error: `Share structure can only change once every ${SHARE_STRUCTURE_COOLDOWN_TURNS} turns. Next allowed in ${wait} turn(s).`,
        },
        { status: 429 }
      );
    }

    const oldTotal = corporation.totalShares ?? 0;
    if (targetTotalShares === oldTotal) {
      return NextResponse.json(
        { error: "Target must differ from current total shares." },
        { status: 400 }
      );
    }

    const isReverse = targetTotalShares < oldTotal;
    if (isReverse) {
      // Share counts deflate with the era, so the floor must too: a 1953 corp
      // is founded at ~143k shares and would sit permanently below a modern
      // 1M floor, unable to reverse-split at all.
      const minTotalShares = getEraFounderShares(
        SHARE_CONSOLIDATION_MIN_TOTAL_SHARES,
        await getGameStatePresetOrDefault(db)
      );
      if (targetTotalShares < minTotalShares) {
        return NextResponse.json(
          {
            error: `Cannot consolidate below ${minTotalShares.toLocaleString()} total shares.`,
          },
          { status: 400 }
        );
      }
    } else {
      const maxTotal = Math.floor(oldTotal * MAX_FORWARD_SHARE_SPLIT_MULTIPLIER);
      if (targetTotalShares > maxTotal) {
        return NextResponse.json(
          {
            error: `Forward split cannot exceed ${MAX_FORWARD_SHARE_SPLIT_MULTIPLIER}× current shares (${maxTotal.toLocaleString()} max).`,
          },
          { status: 400 }
        );
      }
      // Prevent splits that would take the per-share price below MIN_SHARE_PRICE.
      // The turn engine clamps all prices to MIN_SHARE_PRICE, so a split that
      // crosses the floor inflates market cap rather than preserving it.
      const currentSharePrice = corporation.sharePrice ?? 0;
      const projectedPrice = currentSharePrice * (oldTotal / targetTotalShares);
      if (projectedPrice < MIN_SHARE_PRICE) {
        const maxSplitShares = Math.floor(oldTotal * (currentSharePrice / MIN_SHARE_PRICE));
        return NextResponse.json(
          {
            error: `Forward split would reduce share price below the €${MIN_SHARE_PRICE} minimum floor. At the current price of €${currentSharePrice}, the maximum split target is ${maxSplitShares.toLocaleString()} shares.`,
          },
          { status: 400 }
        );
      }
    }

    // Cancel orders, private listings, and pending offers before restructuring.
    // Listings debit reserved shares out of the register; leaving them at the
    // pre-split count lets a later fill dump more shares than exist. Currency
    // conversion already uses this same target-corp cleanup.
    const forexEnabled = await isForexEnabled();
    let marketCleanup = { ordersCancelled: 0, listingsCancelled: 0, offersCancelled: 0 };
    try {
      marketCleanup = await cleanupShareMarketActivityForCorporationTargets(
        db,
        [corporation._id],
        new Date(),
        forexEnabled
      );
    } catch (cleanupErr) {
      const message = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
      const status = message.startsWith("Exchange rate") ? 503 : 400;
      return NextResponse.json(
        { error: `Could not clear open orders before restructure: ${message}` },
        { status }
      );
    }

    // Always re-read: listing cancels restore reserved shares onto the register.
    const freshCorporation =
      (await db.collection<Corporation>("corporations").findOne({ _id: corporation._id })) ??
      corporation;

    const accounted = sumAccountedOutstandingShares(freshCorporation);
    if (accounted !== oldTotal) {
      return NextResponse.json(
        {
          error: "Share register does not match total outstanding (run admin share heal).",
        },
        { status: 400 }
      );
    }

    let newPublicFloat: number;
    let newShareholders: Shareholder[];
    try {
      const alloc = allocateProportionalShareTotals(freshCorporation, targetTotalShares);
      newPublicFloat = alloc.publicFloat;
      newShareholders = alloc.shareholders;
    } catch {
      return NextResponse.json(
        { error: "Unable to allocate new share totals — check shareholder and float data." },
        { status: 400 }
      );
    }

    const verifySum = newShareholders.reduce((s, h) => s + h.shares, 0) + newPublicFloat;
    if (verifySum !== targetTotalShares) {
      return NextResponse.json({ error: "Internal allocation mismatch." }, { status: 500 });
    }

    // Belt-and-suspenders: every pre-split owner (character, imperial, corp)
    // must survive the restructure. Catches any future regression that
    // silently drops a holder kind. Surface names (not raw ObjectIds) so the
    // CEO sees which shareholder is blocking the change.
    const droppedHolders = findDroppedShareholders(
      freshCorporation.shareholders ?? [],
      newShareholders
    );
    if (droppedHolders.length > 0) {
      const charIds = droppedHolders.filter((d) => d.kind === "character").map((d) => d.ownerId);
      const imperialIds = droppedHolders.filter((d) => d.kind === "imperial").map((d) => d.ownerId);
      const corpIds = droppedHolders.filter((d) => d.kind === "corporation").map((d) => d.ownerId);
      const [charDocs, imperialDocs, corpDocs] = await Promise.all([
        charIds.length > 0
          ? db
              .collection<Character>("characters")
              .find({ _id: { $in: charIds } })
              .project<{ _id: ObjectId; name: string }>({ name: 1 })
              .toArray()
          : Promise.resolve([] as { _id: ObjectId; name: string }[]),
        imperialIds.length > 0
          ? db
              .collection<ImperialCharacter>("imperialCharacters")
              .find({ _id: { $in: imperialIds } })
              .project<{ _id: ObjectId; name: string }>({ name: 1 })
              .toArray()
          : Promise.resolve([] as { _id: ObjectId; name: string }[]),
        corpIds.length > 0
          ? db
              .collection<Corporation>("corporations")
              .find({ _id: { $in: corpIds } })
              .project<{ _id: ObjectId; name: string }>({ name: 1 })
              .toArray()
          : Promise.resolve([] as { _id: ObjectId; name: string }[]),
      ]);
      const nameByKey = new Map<string, string>();
      for (const c of charDocs) nameByKey.set(`character:${c._id.toString()}`, c.name);
      for (const i of imperialDocs) nameByKey.set(`imperial:${i._id.toString()}`, i.name);
      for (const c of corpDocs) nameByKey.set(`corporation:${c._id.toString()}`, c.name);
      const labels = droppedHolders.map((d) => {
        const key = `${d.kind}:${d.ownerId.toString()}`;
        return nameByKey.get(key) ?? key;
      });
      return NextResponse.json(
        {
          error: `Share structure change would drop shareholders: ${labels.join(", ")}.`,
        },
        { status: 500 }
      );
    }

    const sharePrice = corporation.sharePrice ?? 0;
    const scaled = scaleSharePricesForStructureChange(oldTotal, targetTotalShares, sharePrice);
    // Scale fundamentalSharePrice by the same factor. The 5-minute
    // applyPriceMultipliers cron computes
    //   sharePrice = fundamentalSharePrice × sentiment × orderFlow
    // off the persisted fundamental, so leaving fundamentalSharePrice at the
    // pre-split value clobbers the just-scaled sharePrice on the next tick
    // and erases the split's market-cap-preserving scaling (bug #0449).
    const fundamentalSharePrice = corporation.fundamentalSharePrice ?? sharePrice;
    const scaledFundamental = scaleSharePricesForStructureChange(
      oldTotal,
      targetTotalShares,
      fundamentalSharePrice
    );

    const now = new Date();
    const $set: Partial<Corporation> = {
      totalShares: targetTotalShares,
      shareholders: newShareholders,
      publicFloat: newPublicFloat,
      sharePrice: scaled.sharePrice,
      fundamentalSharePrice: scaledFundamental.sharePrice,
      lastShareStructureTurn: currentTurn,
      updatedAt: now,
    };

    await db.collection<Corporation>("corporations").updateOne({ _id: corporation._id }, { $set });

    // Mirror each surviving index fund's rescaled cap-table position into its
    // internal `holdings` ledger. allocateProportionalShareTotals already
    // rescaled the fund's cap-table shares; copy that exact count and scale the
    // per-share cost basis by the same factor. Without this, mark-to-market
    // keeps multiplying the pre-split share count by the new price, so the
    // fund's NAV is off by the split factor (the cap table and the ledger drift
    // apart on every split).
    const fundSyncs = planFundHoldingSplitSync(newShareholders, oldTotal, targetTotalShares);
    for (const sync of fundSyncs) {
      await db
        .collection("indexFunds")
        .updateOne(
          { _id: sync.fundId, "holdings.corporationId": corporation._id },
          { $set: { "holdings.$.shares": sync.newShares, updatedAt: now } }
        );
      // Scale per-share cost basis only where it exists, so a missing field is
      // never coerced to 0 by $mul.
      await db.collection("indexFunds").updateOne(
        {
          _id: sync.fundId,
          holdings: {
            $elemMatch: {
              corporationId: corporation._id,
              avgCostPerShareAnchor: { $exists: true },
            },
          },
        },
        { $mul: { "holdings.$.avgCostPerShareAnchor": sync.basisFactor } }
      );
    }

    // --- Emit a share-history audit row with full before/after holder detail ---
    try {
      const ownerIds: {
        characterIds: Set<string>;
        imperialIds: Set<string>;
        corporationIds: Set<string>;
        fundIds: Set<string>;
      } = {
        characterIds: new Set(),
        imperialIds: new Set(),
        corporationIds: new Set(),
        fundIds: new Set(),
      };
      for (const h of [...(freshCorporation.shareholders ?? []), ...newShareholders]) {
        if (h.characterId) ownerIds.characterIds.add(h.characterId.toString());
        if (h.imperialCharacterId) ownerIds.imperialIds.add(h.imperialCharacterId.toString());
        if (h.corporationId) ownerIds.corporationIds.add(h.corporationId.toString());
        if (h.fundId) ownerIds.fundIds.add(h.fundId.toString());
      }
      const [charDocs, imperialDocs, corpDocs, fundDocs] = await Promise.all([
        ownerIds.characterIds.size > 0
          ? db
              .collection<Character>("characters")
              .find({
                _id: {
                  $in: [...ownerIds.characterIds].map((s) => new ObjectId(s)),
                },
              })
              .project<{ _id: ObjectId; name: string }>({ name: 1 })
              .toArray()
          : Promise.resolve([] as { _id: ObjectId; name: string }[]),
        ownerIds.imperialIds.size > 0
          ? db
              .collection<ImperialCharacter>("imperialCharacters")
              .find({
                _id: { $in: [...ownerIds.imperialIds].map((s) => new ObjectId(s)) },
              })
              .project<{ _id: ObjectId; name: string }>({ name: 1 })
              .toArray()
          : Promise.resolve([] as { _id: ObjectId; name: string }[]),
        ownerIds.corporationIds.size > 0
          ? db
              .collection<Corporation>("corporations")
              .find({
                _id: { $in: [...ownerIds.corporationIds].map((s) => new ObjectId(s)) },
              })
              .project<{ _id: ObjectId; name: string }>({ name: 1 })
              .toArray()
          : Promise.resolve([] as { _id: ObjectId; name: string }[]),
        ownerIds.fundIds.size > 0
          ? db
              .collection("indexFunds")
              .find({
                _id: { $in: [...ownerIds.fundIds].map((s) => new ObjectId(s)) },
              })
              .project<{ _id: ObjectId; name: string }>({ name: 1 })
              .toArray()
          : Promise.resolve([] as { _id: ObjectId; name: string }[]),
      ]);
      const names = {
        characters: new Map(charDocs.map((c) => [c._id.toString(), c.name])),
        imperial: new Map(imperialDocs.map((c) => [c._id.toString(), c.name])),
        corporations: new Map(corpDocs.map((c) => [c._id.toString(), c.name])),
        funds: new Map(fundDocs.map((c) => [c._id.toString(), c.name])),
      };
      const before = buildStructureChangeHolderList(
        freshCorporation.shareholders ?? [],
        oldTotal,
        freshCorporation.publicFloat ?? 0,
        names
      );
      const after = buildStructureChangeHolderList(
        newShareholders,
        targetTotalShares,
        newPublicFloat,
        names
      );
      const corpCurrencyCode = resolveCorpLiquidCurrencyCode(freshCorporation);
      await recordShareTrade(db, {
        corporationId: corporation._id,
        kind: isReverse ? "reverse_split" : "stock_split",
        turn: currentTurn,
        // Signed delta so downstream consumers can tell forward from reverse
        // without re-deriving from kind (net change in outstanding shares).
        shares: targetTotalShares - oldTotal,
        pricePerShareAnchor: 0,
        from: null,
        to: null,
        corpCurrencyCode,
        note: `${isReverse ? "Reverse split" : "Stock split"}: ${oldTotal.toLocaleString()} → ${targetTotalShares.toLocaleString()} shares; price scaled to preserve market cap.`,
        structureChange: {
          oldTotalShares: oldTotal,
          newTotalShares: targetTotalShares,
          oldSharePriceLocal: sharePrice,
          newSharePriceLocal: scaled.sharePrice,
          oldPublicFloat: freshCorporation.publicFloat ?? 0,
          newPublicFloat,
          triggeredByCharacterId: corporation.ceoId.toString(),
          before,
          after,
        },
      });
    } catch (auditError) {
      // recordShareTrade itself is best-effort (logs to Sentry); swallowing here
      // prevents any name-lookup hiccup from blocking the successful split. We
      // still surface the failure to Sentry so we never lose a split silently.
      Sentry.captureException(auditError, {
        tags: { module: "consolidate/audit" },
        extra: {
          corporationId: corporation._id.toString(),
          oldTotal,
          targetTotalShares,
        },
      });
    }

    // Rebuild exchange listings now so market cap is price × post-split shares
    // instead of a mixed stale snapshot (ticket #1154). A snapshot hiccup must
    // not fail the restructure.
    try {
      await generateStockExchangeSnapshots(currentTurn, db);
    } catch (snapErr) {
      Sentry.captureException(snapErr, {
        tags: { module: "consolidate/snapshot" },
        extra: { corporationId: corporation._id.toString() },
      });
    }

    return NextResponse.json({
      success: true,
      previousTotalShares: oldTotal,
      newTotalShares: targetTotalShares,
      newSharePrice: scaled.sharePrice,
      newMarketCap: Math.round(scaled.sharePrice * targetTotalShares),
      newPublicFloat,
      reverseSplit: isReverse,
      cancelledOpenOrders: marketCleanup.ordersCancelled,
      cancelledOpenListings: marketCleanup.listingsCancelled,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
