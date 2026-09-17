import { ObjectId, type Db } from "mongodb";
import type { Bond, Character, Corporation, CorporateSector, CentralBank } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  corpCapitalToAnchor,
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { buildPrimeRateMap, sumDefaultedBondPrincipal } from "@/lib/bonds/corporateBondDefault";
import { sectorExitValueByIdAnchor } from "@/lib/bonds/sectorExitBasis";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { getGameState } from "@/lib/gameState";
import { restoreSectorsToUnowned } from "@/lib/corporations/restoreSectorsToUnowned";
import { previewRestructure } from "@/lib/bonds/restructure";
import {
  applyBondRestructureSpend,
  buildBondRestructureFingerprint,
  resumeBondRestructureByKey,
  type BondRestructureHolderCredit,
} from "@/lib/bonds/bondRestructureSpend";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import { logWireEvent, wireHeadlineCorpRestructured } from "@/lib/wireEvent";
import { badRequest } from "@/lib/api/errors";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

export interface CorporationRestructureResult {
  /** Defaulted principal repaid in full, in ₳. */
  paid: number;
  /** Number of defaulted bonds cured (matured). */
  bondsMatured: number;
  /** Number of sectors liquidated to raise cash. */
  sectorsLiquidated: number;
  /** Salvage cash raised by the liquidation, in ₳. */
  proceeds: number;
  /** Corp liquid capital after restructuring, in ₳. */
  residualLiquidCapital: number;
}

/**
 * Bond-default RESTRUCTURING: liquidate the minimum set of sectors (at the
 * orderly-sale {@link import("@/lib/constants/corporations").RESTRUCTURE_SECTOR_SALVAGE_FRACTION})
 * needed to repay defaulted bondholders IN FULL, then cure the defaulted bonds.
 * The corporation survives with its remaining sectors and cash.
 *
 * Unlike dissolution this pays 100% of face (it only runs when the value is
 * there) and keeps the corp alive. Shared by the CEO-initiated route and the
 * turn-tick auto-restructure that closes the "default then close the tab"
 * loophole. The caller MUST hold the corporation settlement lock; writes are
 * sequential (restoreSectorsToUnowned is not transaction-safe), mirroring
 * {@link import("./executeCorporationBondDefaultDissolution")}.
 *
 * Throws {@link badRequest} when there are no defaulted bonds or when even
 * liquidating every sector cannot cover the defaulted principal (caller should
 * fall back to dissolution).
 */
export async function executeCorporationBondRestructure(
  db: Db,
  corporation: Corporation,
  options: {
    now: Date;
    cureTurn: number;
    /**
     * Idempotency key for the crash-safe money-flow run (issue #1672): the
     * CEO route forwards the client's `Idempotency-Key` header, the turn
     * tick passes a deterministic per-corp-per-turn key. Omit to mint one.
     */
    idempotencyKey?: string;
  }
): Promise<CorporationRestructureResult> {
  if (corporation.countryOwnerId) {
    throw badRequest("National corporations cannot restructure here");
  }
  const { now, cureTurn } = options;

  const refreshed = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: corporation._id });
  if (!refreshed) {
    throw badRequest("Corporation not found");
  }

  const defaultedBonds = await db
    .collection<Bond>("bonds")
    .find({ corporationId: refreshed._id, matured: false, defaulted: true })
    .toArray();
  if (defaultedBonds.length === 0) {
    // Empty-remainder recovery (issue #1672): a crash late in the flow leaves
    // every bond cured with an `in_progress` receipt, so the next retry under
    // the same key rebuilds an empty live set. Resuming the stored plan
    // finishes the remaining deterministic steps and reports the stored
    // outcome instead of stranding paid-and-cured bonds behind a refusal.
    // Without a key (or with nothing resumable under it) the historical
    // refusal stands; terminal/conflicting receipts keep their error
    // semantics via throw.
    if (options.idempotencyKey !== undefined) {
      const resumed = await resumeBondRestructureByKey(
        db,
        options.idempotencyKey,
        refreshed._id
      );
      if (resumed) return { ...resumed.outcome };
    }
    throw badRequest("No defaulted bonds to restructure");
  }

  const [sectors, centralBanks, fxByCurrency, marketMode, gameState] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: refreshed._id })
      .toArray(),
    db.collection<CentralBank>("centralBanks").find({}).toArray(),
    loadFxRatesByCurrency(db),
    getMarketSystemModeForDb(db),
    getGameState(db),
  ]);
  const plantsEnabled = marketAtLeast(marketMode, "plants");

  const primeMap = buildPrimeRateMap(centralBanks);
  const corpFxRate = fxRateForCorpFromMap(refreshed, fxByCurrency);
  const liquidCapitalAnchor = corpLiquidCapitalToAnchor(
    refreshed.liquidCapital,
    refreshed,
    corpFxRate
  );
  const defaultedPrincipalAnchor = sumDefaultedBondPrincipal(defaultedBonds, fxByCurrency);

  // Per-sector exit value in ₳ — going-concern NPV below plants, replacement-
  // cost BOOK at/above it (D11). Built by the SAME helper the CEO-facing
  // bond-default panel uses, so the set of sectors this liquidates is exactly
  // the set the preview said it would.
  const sectorNpvByIdAnchor = sectorExitValueByIdAnchor(
    sectors,
    primeMap,
    refreshed,
    fxByCurrency,
    {
      plantsEnabled,
      currentYear: gameState?.currentYear,
      eraUnitScale: await loadWorldEraUnitScale(db),
    }
  );

  const preview = previewRestructure({
    defaultedPrincipalAnchor,
    liquidCapitalAnchor,
    sectorNpvByIdAnchor,
  });
  if (!preview.feasible) {
    throw badRequest(
      "Insufficient sector value to restructure this default. Dissolve & settle instead."
    );
  }

  const liquidateIds = new Set(preview.sectorsToLiquidate.map((s) => s.sectorId));
  const sectorsToLiquidate = sectors.filter((s) => liquidateIds.has(s._id.toString()));

  // ── Build full-face bondholder payouts (₳). Restructuring makes holders whole. ──
  const charIncs = new Map<string, number>();
  const imperialIncs = new Map<string, number>();
  const corpIncs = new Map<string, number>();
  const pendingMaturityTxs: Array<{
    holderType: "character" | "imperial" | "corp";
    holderId: string;
    bondId: string;
    bondCcy: CurrencyCode | undefined;
    faceAnchor: number;
    units: number;
    couponRate: number;
  }> = [];

  for (const bond of defaultedBonds) {
    const bondCcy = (bond.currencyCode ?? undefined) as CurrencyCode | undefined;
    const bondRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
    for (const h of bond.holders) {
      const faceAnchor = corpCapitalToAnchor(h.units * BOND_UNIT_FACE_VALUE, bondCcy, bondRate);
      if (h.characterId) {
        const k = h.characterId.toString();
        charIncs.set(k, (charIncs.get(k) ?? 0) + faceAnchor);
        pendingMaturityTxs.push({
          holderType: "character",
          holderId: k,
          bondId: bond._id.toString(),
          bondCcy,
          faceAnchor,
          units: h.units,
          couponRate: bond.couponRate,
        });
      } else if (h.imperialCharacterId) {
        const k = h.imperialCharacterId.toString();
        imperialIncs.set(k, (imperialIncs.get(k) ?? 0) + faceAnchor);
        pendingMaturityTxs.push({
          holderType: "imperial",
          holderId: k,
          bondId: bond._id.toString(),
          bondCcy,
          faceAnchor,
          units: h.units,
          couponRate: bond.couponRate,
        });
      } else if (h.corporationId && h.corporationId.toString() !== refreshed._id.toString()) {
        const k = h.corporationId.toString();
        corpIncs.set(k, (corpIncs.get(k) ?? 0) + faceAnchor);
        pendingMaturityTxs.push({
          holderType: "corp",
          holderId: k,
          bondId: bond._id.toString(),
          bondCcy,
          faceAnchor,
          units: h.units,
          couponRate: bond.couponRate,
        });
      }
    }
  }

  const anchorToLocal = (amtAnchor: number, currency: string): number => {
    const rate = fxByCurrency.get(currency as CurrencyCode);
    return Number.isFinite(rate) && rate && rate > 0 ? amtAnchor * rate : amtAnchor;
  };

  const forexEnabled = await isForexEnabled();
  const nameById = new Map<string, string>();
  const holderCorpFxByHolderId = new Map<
    string,
    { currency: CurrencyCode; fxRate: number; doc: Corporation }
  >();

  // ── Crash-safe settlement (issue #1672; caller holds the settlement lock) ──
  //
  // 1. Liquidate the selected sectors FIRST, before any money moves.
  //    restoreSectorsToUnowned is idempotent across retries (per-sector
  //    restore tokens guard the pool credits; the final delete tolerates
  //    already-deleted rows), so a crash here converges on retry. Sequencing
  //    the sale before the money flow also keeps the imputed proceeds honest:
  //    the proceeds credit inside the flow below never outlives the sale.
  if (sectorsToLiquidate.length > 0) {
    await restoreSectorsToUnowned(db, sectorsToLiquidate, now);
  }

  // 2. Resolve holder credits in each holder's own denomination — the same
  //    accounts and units the legacy bulkWrites credited.
  const holderCredits: BondRestructureHolderCredit[] = [];
  if (charIncs.size > 0) {
    const charIds = [...charIncs.keys()].map((idStr) => new ObjectId(idStr));
    const charDocs = await db
      .collection<Character>("characters")
      .find({ _id: { $in: charIds } })
      .project<Pick<Character, "_id" | "countryId" | "name">>({ _id: 1, countryId: 1, name: 1 })
      .toArray();
    const charCurrencyMap = new Map(
      charDocs.map((c) => [c._id.toString(), getHomeCurrency(c as Character)])
    );
    for (const c of charDocs) nameById.set(c._id.toString(), c.name as string);
    for (const [charIdStr, amtAnchor] of charIncs.entries()) {
      const currency = charCurrencyMap.get(charIdStr) ?? "USD";
      const amt = forexEnabled ? anchorToLocal(amtAnchor, currency) : amtAnchor;
      if (!(amt > 0)) continue;
      holderCredits.push({
        kind: "character",
        holderId: new ObjectId(charIdStr),
        // Same account buildPersonalBalanceInc credits: per-currency
        // personal balance post-forex, cashOnHand before it.
        field: forexEnabled ? `currencyBalances.personal.${currency}` : "cashOnHand",
        amount: amt,
      });
    }
  }

  if (imperialIncs.size > 0) {
    const imperialIds = [...imperialIncs.keys()].map((idStr) => new ObjectId(idStr));
    const imperialDocs = await db
      .collection<ImperialCharacter>("imperialCharacters")
      .find({ _id: { $in: imperialIds } })
      .project<Pick<ImperialCharacter, "_id" | "countryId" | "name">>({
        _id: 1,
        countryId: 1,
        name: 1,
      })
      .toArray();
    const imperialCurrencyMap = new Map(
      imperialDocs.map((c) => [c._id.toString(), getHomeCurrency(c as ImperialCharacter)])
    );
    for (const c of imperialDocs) nameById.set(c._id.toString(), c.name as string);
    for (const [imperialIdStr, amtAnchor] of imperialIncs.entries()) {
      const currency = imperialCurrencyMap.get(imperialIdStr) ?? "USD";
      const amt = forexEnabled ? anchorToLocal(amtAnchor, currency) : amtAnchor;
      if (!(amt > 0)) continue;
      holderCredits.push({
        kind: "imperial",
        holderId: new ObjectId(imperialIdStr),
        field: forexEnabled ? `currencyBalances.personal.${currency}` : "cashOnHand",
        amount: amt,
      });
    }
  }

  if (corpIncs.size > 0) {
    const creditorIds = [...corpIncs.keys()].map((idStr) => new ObjectId(idStr));
    const creditorDocs = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: creditorIds } })
      .toArray();
    const resolvedCreditors = creditorDocs.map((creditor) => {
      const fxRate = fxRateForCorpFromMap(creditor, fxByCurrency);
      const currency = (resolveCorpLiquidCurrencyCode(creditor) ?? "USD") as CurrencyCode;
      return { creditor, fxRate, currency };
    });
    for (const { creditor, fxRate, currency } of resolvedCreditors) {
      holderCorpFxByHolderId.set(creditor._id.toString(), { currency, fxRate, doc: creditor });
      nameById.set(creditor._id.toString(), creditor.name);
    }
    for (const [corpIdStr, amtAnchor] of corpIncs.entries()) {
      const info = holderCorpFxByHolderId.get(corpIdStr);
      if (!info) continue;
      const amtInCapital = anchorToCorpLiquidCapital(amtAnchor, info.doc, info.fxRate);
      if (!(amtInCapital > 0)) continue;
      holderCredits.push({
        kind: "corp",
        holderId: new ObjectId(corpIdStr),
        field: "liquidCapital",
        amount: amtInCapital,
      });
    }
  }

  // 3. Run the keyed money flow: the corp liquid-capital net (+ salvage
  //    proceeds − defaulted principal; non-negative by preview.feasible),
  //    the holder credits, then the per-bond cure claims. A later failure
  //    compensates its own prefix instead of leaving a strand where holders
  //    were paid but bonds never cured, or the corp paid but holders got
  //    nothing. A crash anywhere resumes under the same key.
  const bondIds = defaultedBonds.map((b) => b._id);
  const proceedsLocal = anchorToCorpLiquidCapital(preview.proceeds, refreshed, corpFxRate);
  const costLocal = anchorToCorpLiquidCapital(defaultedPrincipalAnchor, refreshed, corpFxRate);
  const fingerprint = buildBondRestructureFingerprint({
    corpId: refreshed._id,
    netLiquidCapitalDelta: proceedsLocal - costLocal,
    bonds: bondIds,
    holders: holderCredits.map((h) => ({
      kind: h.kind,
      holderId: h.holderId,
      amount: h.amount,
    })),
    cureTurn,
  });
  const outcome = {
    paid: defaultedPrincipalAnchor,
    bondsMatured: bondIds.length,
    sectorsLiquidated: sectorsToLiquidate.length,
    proceeds: preview.proceeds,
    residualLiquidCapital: preview.residualLiquidCapital,
  };
  await applyBondRestructureSpend(db, {
    corpId: refreshed._id,
    netLiquidCapitalDelta: proceedsLocal - costLocal,
    holders: holderCredits,
    bonds: defaultedBonds.map((b) => ({
      bondId: b._id,
      priorMarketPrice: b.marketPrice ?? 1,
    })),
    cureTurn,
    now,
    // Persisted on the receipt's resume plan: an empty-remainder retry under
    // the same key reports this stored outcome after finishing the plan.
    outcome,
    fingerprint,
    ...(options.idempotencyKey !== undefined
      ? { idempotencyKey: options.idempotencyKey }
      : {}),
  });

  // 5. Ledger: one bond_maturity row per (holder, bond), tagged as a restructure payoff.
  if (pendingMaturityTxs.length > 0) {
    const txEntries = pendingMaturityTxs.map((t) => {
      const bondRate = t.bondCcy ? (fxByCurrency.get(t.bondCcy) ?? 1) : 1;
      const bondLocalAmount = t.faceAnchor * (bondRate > 0 ? bondRate : 1);
      if (t.holderType === "corp") {
        const info = holderCorpFxByHolderId.get(t.holderId);
        const lcAmount = anchorToCorpLiquidCapital(t.faceAnchor, info?.doc, info?.fxRate ?? 1);
        const lcCurrency = info?.currency ?? "USD";
        return {
          type: "bond_maturity" as const,
          turn: cureTurn,
          createdAt: now,
          subjectType: "corporation" as const,
          subjectId: new ObjectId(t.holderId),
          subjectName: nameById.get(t.holderId) ?? "(holder)",
          amount: Math.round(lcAmount * 100) / 100,
          currencyCode: lcCurrency as CurrencyCode,
          counterpartyType: "corporation" as const,
          counterpartyId: refreshed._id,
          counterpartyName: refreshed.name,
          meta: {
            bondId: t.bondId,
            units: t.units,
            couponRate: t.couponRate,
            source: "default_restructure_payoff",
            ...(t.bondCcy
              ? { bondCurrency: t.bondCcy, bondAmount: Math.round(bondLocalAmount * 100) / 100 }
              : {}),
          },
        };
      }
      return {
        type: "bond_maturity" as const,
        turn: cureTurn,
        createdAt: now,
        subjectType: "character" as const,
        subjectId: new ObjectId(t.holderId),
        subjectName: nameById.get(t.holderId) ?? "(holder)",
        amount: Math.round(bondLocalAmount * 100) / 100,
        currencyCode: (t.bondCcy ?? "USD") as CurrencyCode,
        counterpartyType: "corporation" as const,
        counterpartyId: refreshed._id,
        counterpartyName: refreshed.name,
        meta: {
          bondId: t.bondId,
          units: t.units,
          couponRate: t.couponRate,
          source: "default_restructure_payoff",
          ...(t.holderType === "imperial" ? { imperial: true } : {}),
        },
      };
    });
    const thresholds = await loadTxThresholds(db);
    void emitTxBulk(db, txEntries, thresholds);
  }

  void logWireEvent(
    "corporation_restructured",
    wireHeadlineCorpRestructured(
      refreshed.name,
      defaultedPrincipalAnchor,
      sectorsToLiquidate.length
    )
  );

  return { ...outcome };
}
