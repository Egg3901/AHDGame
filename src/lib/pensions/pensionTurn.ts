/**
 * A8: the turn pass that moves pension money.
 *
 * Runs once per turn over every ACTIVE collective agreement carrying a
 * contribution rate. For each one it charges the employer, accrues the workers'
 * claim, and asks a scheme in deficit for a top-up.
 *
 * ## Where the wage bill comes from
 *
 * `sector.laborCost` is written by the corporation turn and documented there as
 * display-and-analytics telemetry, not read back into the economy. This reads
 * it back, which makes it load-bearing, so two things follow and are enforced
 * below: an absent or unusable figure contributes NOTHING (the labour system
 * can be off entirely, and inventing a wage bill would charge an employer for
 * workers the economy is not modelling), and the same figure drives BOTH the
 * contribution and the accrual so the two can never be measured against
 * different populations.
 *
 * That field is stored on a DAILY basis (`sectorTurn.ts` writes the per-turn
 * cost times `TURNS_PER_DAY`, like `revenue`), and this pass runs once per TURN,
 * so it is divided back down before anything is charged against it. Reading the
 * stored figure as if it were per-turn billed every employer 24 times the
 * bargained rate and accrued 24 times the claim.
 *
 * ## Order
 *
 * Charge, then accrue, then top up. Accruing first would ask an employer to
 * top up a shortfall created by the very same turn's accrual, before that
 * turn's contribution had been counted against it.
 */

import { ObjectId, type Db } from "mongodb";
import type { CollectiveAgreement, Corporation, Union } from "@/lib/db/types";
import type { CorporateSector } from "@/lib/db/types/corporation";
import type { PensionScheme } from "@/lib/db/types/pensionScheme";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import { emitTx } from "@/lib/financialTxLog/emit";
import { atomicallyDebitCorpLiquidCapital } from "@/lib/financialTxLog/atomicCashGuard";
import { activeCollectiveAgreementFilter } from "@/lib/unions/bargaining";
import {
  isValidContributionRate,
  pensionAccrualForTurn,
  pensionContributionForTurn,
  pensionSchemeAssetsAnchor,
  pensionTopUpForTurn,
} from "./rules";
import { PENSION_SCHEMES, refreshSchemeInvestedValues } from "./schemeAssets";
import { runPensionBenefitsTurn, type PensionBenefitsResult } from "./pensionBenefits";
import { runPensionSchemeInvestments, type PensionInvestingResult } from "./schemeInvesting";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";

export { PENSION_SCHEMES };

export interface PensionTurnResult {
  schemesCharged: number;
  contributionsAnchor: number;
  topUpsAnchor: number;
  accrualsAnchor: number;
  /** Employers that could not pay in full. The claim still accrues. */
  shortfalls: number;
  /** Phase 2: what the schemes paid their pensioners. */
  benefits: PensionBenefitsResult;
  /** Phase 2: what the schemes put into index funds. */
  investing: PensionInvestingResult;
  errors: string[];
}

/** The scheme for a union, created on first use. */
export async function ensurePensionScheme(
  db: Db,
  union: Pick<Union, "_id" | "countryId" | "name">,
  currentTurn: number
): Promise<PensionScheme> {
  const existing = await db
    .collection<PensionScheme>(PENSION_SCHEMES)
    .findOne({ unionId: union._id });
  if (existing) return existing;

  const now = new Date();
  const scheme: PensionScheme = {
    _id: new ObjectId(),
    unionId: union._id,
    countryId: union.countryId,
    unionName: union.name,
    assetsAnchor: 0,
    liabilitiesAnchor: 0,
    totalContributionsAnchor: 0,
    totalTopUpsAnchor: 0,
    createdAtTurn: currentTurn,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await db.collection<PensionScheme>(PENSION_SCHEMES).insertOne(scheme);
    return scheme;
  } catch {
    // Lost the race against a concurrent settlement; the unique index did its
    // job and the other writer's document is the one that counts.
    const raced = await db
      .collection<PensionScheme>(PENSION_SCHEMES)
      .findOne({ unionId: union._id });
    if (raced) return raced;
    throw new Error(`Could not create or load a pension scheme for union ${union._id.toString()}`);
  }
}

/** Summed labour cost of the sectors an agreement covers, on the stored DAILY basis. */
export function coveredWageBill(sectors: Pick<CorporateSector, "laborCost">[]): number {
  let total = 0;
  for (const sector of sectors) {
    const cost = sector.laborCost;
    // Absent means the labour system never wrote one. Treating that as zero is
    // the fail-closed reading: no measured wages, no pension charge.
    if (typeof cost === "number" && Number.isFinite(cost) && cost > 0) total += cost;
  }
  return total;
}

/**
 * The same wage bill on the clock this pass actually runs on.
 *
 * Everything charged or accrued per turn keys off THIS, never the stored daily
 * figure.
 */
export function coveredWageBillPerTurn(sectors: Pick<CorporateSector, "laborCost">[]): number {
  return coveredWageBill(sectors) / TURNS_PER_DAY;
}

export async function runPensionTurn(db: Db, currentTurn: number): Promise<PensionTurnResult> {
  const result: PensionTurnResult = {
    schemesCharged: 0,
    contributionsAnchor: 0,
    topUpsAnchor: 0,
    accrualsAnchor: 0,
    shortfalls: 0,
    benefits: {
      schemesPaying: 0,
      retirementsAnchor: 0,
      benefitsPaidAnchor: 0,
      benefitsUnpaidAnchor: 0,
      schemesCutting: 0,
      errors: [],
    },
    investing: { schemesInvesting: 0, investedAnchor: 0, errors: [] },
    errors: [],
  };

  // Phase 2: mark every scheme's units to market BEFORE anything reads a
  // funding ratio this turn. A top-up charged against a stale valuation would
  // bill an employer for a deficit that a risen fund had already closed, or let
  // a fallen one off entirely.
  await refreshSchemeInvestedValues(db);

  const agreements = await db
    .collection<CollectiveAgreement>("collectiveAgreements")
    .find({
      ...activeCollectiveAgreementFilter(currentTurn),
      pensionContributionRate: { $gt: 0 },
    })
    .toArray();
  if (agreements.length === 0) {
    await runPensionPostContributionPasses(db, currentTurn, result);
    return result;
  }

  const unionIds = [...new Set(agreements.map((a) => a.unionId.toString()))].map(
    (id) => new ObjectId(id)
  );
  const unions = await db
    .collection<Union>("unions")
    .find({ _id: { $in: unionIds } }, { projection: { name: 1, countryId: 1 } })
    .toArray();
  const unionById = new Map(unions.map((u) => [u._id.toString(), u]));

  const employerIds = [...new Set(agreements.map((a) => a.employerCorporationId.toString()))].map(
    (id) => new ObjectId(id)
  );
  const employers = await db
    .collection<Corporation>("corporations")
    .find(
      { _id: { $in: employerIds } },
      { projection: { name: 1, countryId: 1, liquidCurrencyCode: 1 } }
    )
    .toArray();
  const employerById = new Map(employers.map((c) => [c._id.toString(), c]));
  const fxByCurrency = await loadFxRatesByCurrency(db);

  // Sectors live in their own collection, so load every covered sector for the
  // whole sweep in one read rather than per agreement.
  const coveredSectorIds = agreements.flatMap((a) => a.sectorIds);
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ _id: { $in: coveredSectorIds } }, { projection: { laborCost: 1 } })
    .toArray();
  const sectorById = new Map(sectors.map((s) => [s._id.toString(), s]));

  for (const agreement of agreements) {
    try {
      const rate = agreement.pensionContributionRate ?? 0;
      if (!isValidContributionRate(rate) || rate <= 0) continue;

      const union = unionById.get(agreement.unionId.toString());
      const employer = employerById.get(agreement.employerCorporationId.toString());
      if (!union || !employer) continue;

      const covered = agreement.sectorIds
        .map((id) => sectorById.get(id.toString()))
        .filter((s): s is CorporateSector => s !== undefined);
      const wageBillLocal = coveredWageBillPerTurn(covered);
      if (wageBillLocal <= 0) continue;

      const scheme = await ensurePensionScheme(db, union, currentTurn);
      const currency = (employer.liquidCurrencyCode ?? "USD") as CurrencyCode;
      const fxRate = fxRateForCorpFromMap(employer, fxByCurrency);
      const now = new Date();

      // 1. Contribution.
      const contributionLocal = pensionContributionForTurn({
        coveredWageBill: wageBillLocal,
        contributionRate: rate,
      });
      let paidLocal = 0;
      if (contributionLocal > 0) {
        const debit = await atomicallyDebitCorpLiquidCapital(db, employer._id, contributionLocal);
        if (debit.ok) {
          paidLocal = contributionLocal;
        } else {
          // An employer that cannot pay does NOT get the claim forgiven. That
          // is the whole shape of an underfunded scheme: the promise stands and
          // the assets do not arrive.
          result.shortfalls += 1;
        }
      }

      // 2. Top-up, on the position BEFORE this turn's accrual.
      // TOTAL assets, cash plus the marked value of the scheme's units. Reading
      // `scheme.assetsAnchor` alone here would treat every ₳ a scheme invested
      // as an ₳ it had lost and bill its employer for the difference.
      const paidAnchor = corpLiquidCapitalToAnchor(paidLocal, employer, fxRate);
      const topUpAnchor = pensionTopUpForTurn({
        assetsAnchor: pensionSchemeAssetsAnchor(scheme) + paidAnchor,
        liabilitiesAnchor: scheme.liabilitiesAnchor,
      });
      const topUpLocal = anchorToCorpLiquidCapital(topUpAnchor, employer, fxRate);
      let toppedUpAnchor = 0;
      let toppedUpLocal = 0;
      if (topUpLocal > 0) {
        const debit = await atomicallyDebitCorpLiquidCapital(db, employer._id, topUpLocal);
        if (debit.ok) {
          toppedUpAnchor = topUpAnchor;
          toppedUpLocal = topUpLocal;
        } else result.shortfalls += 1;
      }

      // 3. Accrual, always, whether or not the employer could pay.
      const accrualAnchor = corpLiquidCapitalToAnchor(
        pensionAccrualForTurn(wageBillLocal),
        employer,
        fxRate
      );

      await db.collection<PensionScheme>(PENSION_SCHEMES).updateOne(
        { _id: scheme._id },
        {
          $inc: {
            assetsAnchor: paidAnchor + toppedUpAnchor,
            liabilitiesAnchor: accrualAnchor,
            totalContributionsAnchor: paidAnchor,
            totalTopUpsAnchor: toppedUpAnchor,
          },
          $set: { lastChargedTurn: currentTurn, updatedAt: now },
        }
      );

      const movedLocal = paidLocal + toppedUpLocal;
      if (movedLocal > 0) {
        // Both legs. The scheme is a real counterparty holding real assets, so
        // a one-sided debit would read as money destroyed.
        await emitTx(db, {
          type: "pension_contribution",
          turn: currentTurn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: employer._id,
          subjectName: employer.name,
          amount: -movedLocal,
          currencyCode: currency,
          counterpartyType: "pension_scheme",
          counterpartyId: scheme._id,
          counterpartyName: `${union.name} pension scheme`,
          meta: {
            schemeId: scheme._id.toString(),
            contribution: paidLocal,
            topUp: toppedUpLocal,
            rate,
          },
        });
        await emitTx(db, {
          type: "pension_contribution",
          turn: currentTurn,
          createdAt: now,
          subjectType: "pension_scheme",
          subjectId: scheme._id,
          subjectName: `${union.name} pension scheme`,
          amount: movedLocal,
          currencyCode: currency,
          counterpartyType: "corporation",
          counterpartyId: employer._id,
          counterpartyName: employer.name,
          meta: { schemeId: scheme._id.toString(), rate },
        });
      }

      result.schemesCharged += 1;
      result.contributionsAnchor += paidAnchor;
      result.topUpsAnchor += toppedUpAnchor;
      result.accrualsAnchor += accrualAnchor;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Agreement ${agreement._id.toString()}: ${message}`);
    }
  }

  await runPensionPostContributionPasses(db, currentTurn, result);
  return result;
}

/**
 * Benefits, then investment, then a final mark to market.
 *
 * Benefits first, because the buffer the investment pass reserves is sized off
 * the in-payment stock this turn's retirements just changed, and because a
 * scheme must never invest cash a pensioner was owed the same turn.
 *
 * Split out and exported so the agreement sweep above staying empty (no active
 * agreement carries a contribution) does not stop mature schemes paying the
 * pensions they already owe. A scheme with liabilities and no live agreement is
 * the ordinary end state of a workplace that closed.
 */
export async function runPensionPostContributionPasses(
  db: Db,
  currentTurn: number,
  result: PensionTurnResult
): Promise<void> {
  result.benefits = await runPensionBenefitsTurn(db, currentTurn);
  result.investing = await runPensionSchemeInvestments(db, currentTurn);
  await refreshSchemeInvestedValues(db);
}
