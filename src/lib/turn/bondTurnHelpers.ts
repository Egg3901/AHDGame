import { ObjectId, type AnyBulkWriteOperation, type Db } from "mongodb";
import type { Bond, CentralBank, Corporation, CorporateSector } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { computeBondShortfallEscrowCover } from "@/lib/corporations/escrowFunding";
import {
  anchorToCorpCapital,
  corpCapitalToAnchor,
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { corpExitEquityAnchor } from "@/lib/bonds/corpExitEquity";
import { buildPrimeRateMap } from "@/lib/bonds/corporateBondDefault";
import { sumBondPrincipalAnchor } from "@/lib/bonds/bondPrincipalSum";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { getGameState } from "@/lib/gameState";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

/**
 * Bonds-only exception to escrow ring-fencing: before declaring a corp defaulted
 * on its bond obligations, let it cover a negative liquidCapital from a POSITIVE
 * share-buyback escrow (move escrow → liquidCapital, capped at the escrow balance,
 * never below 0). Mutates the passed corps' `liquidCapital` in place so the caller
 * can re-test solvency, persists the moves via bulkWrite, and returns the set of
 * corp ids still negative after cover (the true defaults). Escrow and liquidCapital
 * are both corp-local, so the move is 1:1.
 */
export async function coverBondShortfallsFromEscrow(
  db: Db,
  corps: { _id: ObjectId; liquidCapital: number; shareEscrowBalance?: number }[],
  now: Date
): Promise<Set<string>> {
  const ops: AnyBulkWriteOperation<Corporation>[] = [];
  const stillNegative = new Set<string>();
  for (const corp of corps) {
    const cover = computeBondShortfallEscrowCover({
      liquidCapital: corp.liquidCapital,
      escrowBalance: corp.shareEscrowBalance ?? 0,
    });
    if (cover > 0) {
      corp.liquidCapital += cover;
      ops.push({
        updateOne: {
          filter: { _id: corp._id },
          update: {
            $inc: { liquidCapital: cover, shareEscrowBalance: -cover },
            $set: { updatedAt: now },
          },
        },
      });
    }
    if (corp.liquidCapital < 0) stillNegative.add(corp._id.toString());
  }
  if (ops.length > 0) await db.collection<Corporation>("corporations").bulkWrite(ops);
  return stillNegative;
}

/**
 * Narrow a set of cash-negative corp ids down to the ones that are genuinely
 * INSOLVENT, i.e. whose assets cannot cover their outstanding bond debt.
 *
 * `liquidCapital < 0` says a corp is short of cash right now. It cannot
 * distinguish a corp that has stopped paying from one that converted its cash
 * into plant and is waiting for it to come online — the second is the normal
 * borrow-and-build pattern the game asks players to follow.
 *
 * Assets are valued on the shared exit basis ({@link corpExitEquityAnchor}) —
 * the same one the restructure planner uses when it decides what to sell, and
 * the same one the issuance ceiling is capped by. That equivalence is the
 * point, in both directions: if selling assets could have covered the debt, the
 * corp was never insolvent and the default ladder — which would have attempted
 * exactly that sale — should not start; and a corp that borrowed inside its
 * ceiling cannot land here at all, because the ceiling was measured against
 * this figure (ticket #1198).
 *
 * The basis includes the corp's own bond PORTFOLIO at face. It is not a
 * courtesy: `executeCorporationBondDefaultDissolution` redeems those holdings
 * into `liquidCapital` before settling, so refusing to count them here meant
 * declaring a corp unable to pay with assets the resulting liquidation would
 * have spent paying.
 *
 * Returns the subset that should actually default. Anything filtered out stays
 * cash-negative and under real pressure; it simply is not liquidated for it.
 */
export async function filterInsolventCorps(
  db: Db,
  candidates: Set<string>,
  ctx: {
    corpMap: Map<string, Corporation>;
    fxByCurrency: ReadonlyMap<CurrencyCode, number>;
    centralBanks: { countryId: string; primeRate: number }[];
    activeBonds: Bond[];
  }
): Promise<Set<string>> {
  if (candidates.size === 0) return candidates;

  const [marketMode, gameState, eraUnitScale] = await Promise.all([
    getMarketSystemModeForDb(db),
    getGameState(db),
    loadWorldEraUnitScale(db),
  ]);
  const plantsEnabled = marketAtLeast(marketMode, "plants");
  const primeMap = buildPrimeRateMap(ctx.centralBanks as CentralBank[]);

  const ids = [...candidates].map((id) => new ObjectId(id));
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      { corporationId: { $in: ids } },
      { projection: { buildQueue: 0, plantsPnl: 0, soldByCommodity: 0 } }
    )
    .toArray();
  const sectorsByCorp = new Map<string, CorporateSector[]>();
  for (const s of sectors) {
    const k = s.corporationId.toString();
    const list = sectorsByCorp.get(k);
    if (list) list.push(s);
    else sectorsByCorp.set(k, [s]);
  }

  const insolvent = new Set<string>();
  for (const idStr of candidates) {
    const corp = ctx.corpMap.get(idStr);
    // Unknown corp: fall back to the historical behaviour rather than silently
    // rescuing something we cannot value.
    if (!corp) {
      insolvent.add(idStr);
      continue;
    }

    const debtAnchor = sumBondPrincipalAnchor(
      ctx.activeBonds.filter((b) => !b.matured && b.corporationId?.toString() === idStr),
      ctx.fxByCurrency
    );
    // A candidate reached here because it issued a live bond, so a principal of
    // zero means we could not read the debt, not that there is none. Rescuing on
    // an unreadable figure is the dangerous direction, so fall back to the
    // historical behaviour and let it default.
    if (debtAnchor <= 0) {
      insolvent.add(idStr);
      continue;
    }

    const cashAnchor = corpCapitalToAnchor(
      corp.liquidCapital,
      resolveCorpLiquidCurrencyCode(corp),
      fxRateForCorpFromMap(corp, ctx.fxByCurrency)
    );

    // `ctx.activeBonds` is every non-matured bond in the world, so this picks
    // up the corp's creditor holdings as well as its own issues. `defaulted`
    // on that snapshot is the PRE-turn state, which is the right basis for
    // initial detection: a counterparty failing in this same turn is a cascade,
    // and cascades are resolved in Phase 3.5 rather than here (see
    // `rollbackDefaultedIssuerMaturityFlows`).
    //
    // Rescanning the bond list per candidate is O(candidates x bonds), and
    // deliberately left un-indexed: `candidates` is only the corps that went
    // cash-negative on bond obligations this turn, which is a handful even in a
    // bad turn. No allocation here beats a map rebuilt every turn for it.
    const { exitEquityAnchor } = corpExitEquityAnchor({
      liquidCapitalAnchor: cashAnchor,
      sectors: sectorsByCorp.get(idStr) ?? [],
      corporationId: idStr,
      corp,
      fxByCurrency: ctx.fxByCurrency,
      primeRateByCountry: primeMap,
      bonds: ctx.activeBonds,
      plantsEnabled,
      currentYear: gameState?.currentYear,
      eraUnitScale,
    });

    if (exitEquityAnchor < debtAnchor) {
      insolvent.add(idStr);
    }
  }
  return insolvent;
}

/**
 * Resolve a bond's denomination currency from `bond.currencyCode` first,
 * falling back to the bond's country-inferred currency for pre-migration
 * rows. **Never** derives from the issuer corp's current country — Task-18B
 * canonicalizes `bond.currencyCode` as the denomination of record, and
 * admin-initiated cross-country HQ moves would otherwise silently
 * re-denominate outstanding bonds (see docs/design/corporations.md §HQ
 * Relocation → Bond denomination).
 */
export function resolveBondCurrency(bond: Bond): CurrencyCode {
  if (bond.currencyCode) return bond.currencyCode as CurrencyCode;
  if (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP) {
    return COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP];
  }
  return "USD";
}

/**
 * Maturity face-value flows pre-computed in Phase 1.5 so they enter the
 * unified pre-default delta (Phase 2) instead of the post-default Phase 5.
 * Tracked per-bond as well so a newly-defaulted issuer's maturity flows can
 * be rolled back (Phase 3.5) — the bond becomes defaulted, not matured, and
 * holders never actually receive face value.
 */
export type BondMaturityFlow = {
  bond: Bond;
  issuerCostAnchor: number;
  holderCorpCreditsAnchor: Map<string, number>;
};

/**
 * Phase 3.5: Roll back maturity flows for newly-defaulted issuers.
 *
 * Phase 1.5 optimistically applied maturity face value to issuers (debit)
 * and corp holders (credit) so the default check could see net flow. When
 * an issuer ends up defaulting, the bond is marked defaulted (not matured)
 * by Phase 4 and per existing semantics holders never receive face value
 * and the issuer never pays it. Reverse those optimistic writes here.
 *
 * Cascade: if a holder corp's solvency depended on the rolled-back income
 * (their post-clawback balance is now negative), they default too — and
 * their own maturity flows must be rolled back, potentially cascading
 * further. The loop processes one wave of defaults per iteration and
 * terminates when no new corps fall under zero. Convergence is guaranteed
 * because each iteration adds at least one corp to `processedFlows`, which
 * is bounded by the number of distinct issuers with maturity flows.
 *
 * Mutates `defaultedCorps` in place, adding cascade-defaulted holder corps.
 */
export async function rollbackDefaultedIssuerMaturityFlows(args: {
  db: Db;
  bondMaturityFlows: BondMaturityFlow[];
  defaultedCorps: Set<string>;
  corpMap: Map<string, Corporation>;
  natcorpIds: Set<string>;
  fxByCurrency: Map<CurrencyCode, number>;
  now: Date;
}): Promise<void> {
  const { db, bondMaturityFlows, defaultedCorps, corpMap, natcorpIds, fxByCurrency, now } = args;
  if (bondMaturityFlows.length > 0) {
    const processedFlowIssuers = new Set<string>();
    let pending = new Set(defaultedCorps);
    while (pending.size > 0) {
      const rollbackOps = [];
      const affectedHolders = new Set<string>();
      for (const flow of bondMaturityFlows) {
        const issuerCorpIdStr = flow.bond.corporationId.toString();
        if (!pending.has(issuerCorpIdStr)) continue;
        if (processedFlowIssuers.has(issuerCorpIdStr)) continue;

        if (flow.issuerCostAnchor > 0) {
          const issuer = corpMap.get(issuerCorpIdStr);
          const refundLocal = anchorToCorpCapital(
            flow.issuerCostAnchor,
            resolveCorpLiquidCurrencyCode(issuer),
            fxRateForCorpFromMap(issuer, fxByCurrency)
          );
          rollbackOps.push({
            updateOne: {
              filter: { _id: new ObjectId(issuerCorpIdStr) },
              update: { $inc: { liquidCapital: refundLocal }, $set: { updatedAt: now } },
            },
          });
        }

        for (const [holderCorpIdStr, creditAnchor] of flow.holderCorpCreditsAnchor) {
          const holder = corpMap.get(holderCorpIdStr);
          const clawbackLocal = anchorToCorpCapital(
            creditAnchor,
            resolveCorpLiquidCurrencyCode(holder),
            fxRateForCorpFromMap(holder, fxByCurrency)
          );
          rollbackOps.push({
            updateOne: {
              filter: { _id: new ObjectId(holderCorpIdStr) },
              update: { $inc: { liquidCapital: -clawbackLocal }, $set: { updatedAt: now } },
            },
          });
          affectedHolders.add(holderCorpIdStr);
        }
      }
      for (const id of pending) processedFlowIssuers.add(id);
      pending = new Set();

      if (rollbackOps.length > 0) {
        await db.collection("corporations").bulkWrite(rollbackOps);
      }

      if (affectedHolders.size > 0) {
        const updated = await db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: [...affectedHolders].map((id) => new ObjectId(id)) } })
          .project<{ _id: ObjectId; liquidCapital: number; shareEscrowBalance?: number }>({
            _id: 1,
            liquidCapital: 1,
            shareEscrowBalance: 1,
          })
          .toArray();
        // Same bonds-only escrow fallback for cascade-affected holders: cover a
        // negative balance from positive escrow before cascading the default.
        const cascadeCandidates = updated.filter(
          (corp) =>
            corp.liquidCapital < 0 &&
            !defaultedCorps.has(corp._id.toString()) &&
            !natcorpIds.has(corp._id.toString())
        );
        const stillNegative = await coverBondShortfallsFromEscrow(db, cascadeCandidates, now);
        for (const idStr of stillNegative) {
          defaultedCorps.add(idStr);
          pending.add(idStr);
        }
      }
    }
  }
}
