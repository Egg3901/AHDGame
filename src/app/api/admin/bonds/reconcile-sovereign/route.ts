// POST /api/admin/bonds/reconcile-sovereign
//
// Converts unrepresented sovereign debt principal into tradeable bond series,
// staggered across multiple maturities with term-premium yields. The gap is
// computed as budget.debt.principal minus the total issued of all active
// sovereign bonds for the country. Each tranche is issued at
// getSovereignCouponRate(primeRate, maturityTurns) so longer-dated paper
// carries a higher yield.
//
// Budget impact: spending.debtInterest and surplus are updated with the new
// annual coupon costs. debt.principal is left unchanged — it already reflects
// the national debt; bonds will retire it progressively as they mature.
//
// Body: { countryId, distribution? }
//   distribution: optional fractional split across maturities, e.g.
//     { "48": 0.25, "96": 0.35, "240": 0.40 }  (must sum to 1)
//
// Auth: requireAdmin
// Errors: 400, 401, 403, 500

import { NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { parseJsonBody } from "@/lib/api/validate";
import { getGameState } from "@/lib/gameState";
import { reconcileSovereignDebt, SOVEREIGN_RECONCILE_DISTRIBUTION } from "@/lib/bonds/sovereign";
import { countryIdSchema } from "@/lib/api/schemas/country";
import { SOVEREIGN_BOND_MATURITY_ADMIN_OPTIONS } from "@/lib/db/types/bond";
import { emitTx } from "@/lib/financialTxLog/emit";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { BondMaturityTurns } from "@/lib/db/types/bond";

const distributionSchema = z
  .record(z.string(), z.number().min(0).max(1))
  .optional()
  .refine(
    (dist) => {
      if (!dist) return true;
      const keys = Object.keys(dist).map(Number);
      if (keys.some((k) => !SOVEREIGN_BOND_MATURITY_ADMIN_OPTIONS.includes(k as BondMaturityTurns)))
        return false;
      const total = Object.values(dist).reduce((s, v) => s + v, 0);
      return Math.abs(total - 1) < 0.0001;
    },
    {
      message:
        "distribution keys must be valid maturity turns (48/96/240) and values must sum to 1",
    }
  );

const schema = z.object({
  countryId: countryIdSchema,
  distribution: distributionSchema,
});

export const POST = withAdminAuth(async (_auth, request: Request) => {
  try {
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { countryId, distribution: rawDistribution } = parsed.data;

    // Convert string keys from JSON to BondMaturityTurns numbers.
    const distribution = rawDistribution
      ? (Object.fromEntries(
          Object.entries(rawDistribution).map(([k, v]) => [Number(k) as BondMaturityTurns, v])
        ) as Partial<Record<BondMaturityTurns, number>>)
      : undefined;

    const db = await getDb();
    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;

    const result = await reconcileSovereignDebt(db, {
      countryId,
      turn: currentTurn,
      now: new Date(),
      distribution,
    });

    if (!result) {
      return NextResponse.json(
        { error: `No federal budget found for country ${countryId}.` },
        { status: 400 }
      );
    }

    if (result.totalIssued > 0) {
      const issueCurrency = (COUNTRY_CURRENCY_MAP[
        result.countryId as keyof typeof COUNTRY_CURRENCY_MAP
      ] ?? "USD") as CurrencyCode;

      for (const tranche of result.tranches) {
        void emitTx(db, {
          type: "gov_bond_issuance",
          turn: currentTurn,
          createdAt: new Date(),
          subjectType: "government",
          countryId: result.countryId,
          subjectName: `${result.countryId} Government (reconcile)`,
          amount: tranche.issueAmount,
          currencyCode: issueCurrency,
          meta: {
            bondId: tranche.bondId.toString(),
            couponRate: tranche.couponRate,
            maturityTurns: tranche.maturityTurns,
            reconcile: true,
          },
        });
      }
    }

    const defaultDistribution = Object.entries(SOVEREIGN_RECONCILE_DISTRIBUTION).map(
      ([maturity, fraction]) => ({ maturityTurns: Number(maturity), fraction })
    );

    return NextResponse.json({
      success: true,
      countryId: result.countryId,
      coveredByExistingBonds: result.coveredByExistingBonds,
      gap: result.gap,
      totalIssued: result.totalIssued,
      budgetInterestDelta: result.budgetInterestDelta,
      newPrincipal: result.newPrincipal,
      newDebtInterest: result.newDebtInterest,
      newSurplus: result.newSurplus,
      newDebtToGdpRatio: result.newDebtToGdpRatio,
      newCreditRating: result.newCreditRating,
      distribution: distribution
        ? Object.entries(distribution).map(([maturity, fraction]) => ({
            maturityTurns: Number(maturity),
            fraction,
          }))
        : defaultDistribution,
      tranches: result.tranches.map((t) => ({
        bondId: t.bondId.toString(),
        maturityTurns: t.maturityTurns,
        maturityTurn: currentTurn + t.maturityTurns,
        issueAmount: t.issueAmount,
        couponRate: t.couponRate,
        annualCouponCost: t.annualCouponCost,
      })),
      message:
        result.totalIssued > 0
          ? `Reconciled ${countryId}: issued ${result.tranches.length} tranche(s) totalling ${result.totalIssued.toLocaleString()} from a ${result.gap.toLocaleString()} gap. Interest service +${result.budgetInterestDelta.toLocaleString()}/yr.`
          : `No gap to reconcile for ${countryId}: all ${result.coveredByExistingBonds.toLocaleString()} of principal is already covered by active bonds.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
});
