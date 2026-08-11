import { NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { parseJsonBody } from "@/lib/api/validate";
import { getGameState } from "@/lib/gameState";
import { issueAdminSovereignBondSeries } from "@/lib/bonds/sovereign";
import { SOVEREIGN_BOND_MATURITY_ADMIN_OPTIONS } from "@/lib/db/types/bond";
import { countryIdSchema } from "@/lib/api/schemas/country";
import { emitTx } from "@/lib/financialTxLog/emit";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";

const schema = z.object({
  countryId: countryIdSchema,
  faceValue: z.number().min(100_000).optional(),
  useQuarterDeficit: z.boolean().optional(),
  maturityTurns: z
    .number()
    .int()
    .refine((value) => SOVEREIGN_BOND_MATURITY_ADMIN_OPTIONS.includes(value as 48 | 96 | 240), {
      message: "Maturity must be 48, 96, or 240 turns.",
    })
    .optional(),
});

export const POST = withAdminAuth(async (_auth, request: Request) => {
  try {
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { countryId, faceValue, maturityTurns, useQuarterDeficit } = parsed.data;
    const db = await getDb();
    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;

    const result = await issueAdminSovereignBondSeries(db, {
      countryId,
      turn: currentTurn,
      now: new Date(),
      faceValue,
      maturityTurns: maturityTurns as 48 | 96 | 240 | undefined,
      useQuarterDeficit,
    });

    if (!result) {
      return NextResponse.json(
        { error: "No sovereign issuance was created for the selected country." },
        { status: 400 }
      );
    }

    const issueCurrency = (COUNTRY_CURRENCY_MAP[
      result.countryId as keyof typeof COUNTRY_CURRENCY_MAP
    ] ?? "USD") as CurrencyCode;
    void emitTx(db, {
      type: "gov_bond_issuance",
      turn: currentTurn,
      createdAt: new Date(),
      subjectType: "government",
      countryId: result.countryId,
      subjectName: `${result.countryId} Government`,
      amount: result.issueAmount,
      currencyCode: issueCurrency,
      meta: { bondId: result.bondId.toString(), couponRate: result.couponRate },
    });

    return NextResponse.json({
      success: true,
      message: `Issued ${countryId} sovereign debt series for ${result.issueAmount.toLocaleString()} at ${result.couponRate.toFixed(2)}%.`,
      result: {
        bondId: result.bondId.toString(),
        countryId: result.countryId,
        issueAmount: result.issueAmount,
        couponRate: result.couponRate,
        newPrincipal: result.newPrincipal,
        newDebtInterest: result.newDebtInterest,
        newSurplus: result.newSurplus,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
});
