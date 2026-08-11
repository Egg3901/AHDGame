// GET /api/admin/corporations/[id]/imf-bailout — Preview bonds + facility + payoff estimate (query params).
// POST — Activate or deactivate IMF restructuring.
// PATCH — Update income capture % while bailout is active.
// Auth: requireAdmin
// Errors: 401, 403, 400, 404

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import type { Bond, Character, Corporation } from "@/lib/db/types";
import { adminImfBailoutSchema } from "@/lib/api/schemas/adminImfBailout";
import { getImfCorporation } from "@/lib/imf/resolveImfCorporation";
import { roundFaceToBondUnits } from "@/lib/bonds/corporateBondDefault";
import { sendSystemMail } from "@/lib/mail/systemMail";
import { fireImfBailoutPulse } from "@/lib/corporations/sentimentEvents";
import {
  IMF_BAILOUT_DEFAULT_INCOME_CAPTURE_FRACTION,
  IMF_BAILOUT_INCOME_FRACTION_CAP,
} from "@/lib/imf/constants";
import {
  imfLevelPaymentPerTurn,
  imfPerTurnInterestRate,
  simulateImfFacilityPayoffTurns,
} from "@/lib/imf/imfFacilityMath";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const DEFAULT_INCOME_CAPTURE_PERCENT = IMF_BAILOUT_DEFAULT_INCOME_CAPTURE_FRACTION * 100;

const patchIncomeCaptureSchema = z.object({
  incomeCapturePercent: z.number().min(1).max(45),
});

function incomeCapturePercentToFraction(percent: number): number {
  const clamped = Math.min(45, Math.max(1, percent));
  return Math.min(IMF_BAILOUT_INCOME_FRACTION_CAP, clamped / 100);
}

function dilutionSharesForImf(totalShares: number, targetPercent: number): number {
  const p = targetPercent / 100;
  if (p <= 0 || p >= 1) return 0;
  return Math.floor((p * totalShares) / (1 - p));
}

/**
 * GET /api/admin/corporations/[id]/imf-bailout
 * Query: retention, annualRate, amortizationTurns, incomeCapturePercent — for preview / what-if.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();
    const corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: new ObjectId(id) });
    if (!corp) throw notFound("Corporation not found");

    const { searchParams } = new URL(request.url);
    const retention = Math.min(
      1,
      Math.max(0.01, parseFloat(searchParams.get("retention") ?? "0.7"))
    );
    const annualRate = parseFloat(searchParams.get("annualRate") ?? "6");
    const amortTurns = Math.min(
      960,
      Math.max(24, parseInt(searchParams.get("amortizationTurns") ?? "240", 10))
    );
    const incomeCapturePct = parseFloat(
      searchParams.get("incomeCapturePercent") ?? `${DEFAULT_INCOME_CAPTURE_PERCENT}`
    );
    const incomeCapFraction = incomeCapturePercentToFraction(
      Number.isFinite(incomeCapturePct) ? incomeCapturePct : DEFAULT_INCOME_CAPTURE_PERCENT
    );

    const lastHist = await db
      .collection<{ income?: number; turn?: number }>("corporationHistory")
      .findOne(
        { corporationId: corp._id },
        { sort: { turn: -1 }, projection: { income: 1, turn: 1 } }
      );

    const lastTurnIncome =
      typeof lastHist?.income === "number" && Number.isFinite(lastHist.income)
        ? lastHist.income
        : 0;
    const lastHistoryTurn = typeof lastHist?.turn === "number" ? lastHist.turn : null;

    if (corp.imfBailoutActive) {
      const principal = corp.imfFacilityPrincipalOutstanding ?? 0;
      const ann = corp.imfFacilityAnnualRate ?? 0;
      const rem = corp.imfFacilityAmortizationTurnsRemaining ?? 48;
      const storedFraction =
        corp.imfFacilityIncomeCaptureFraction ?? IMF_BAILOUT_DEFAULT_INCOME_CAPTURE_FRACTION;
      const r = imfPerTurnInterestRate(ann);
      const scheduledFirstTurn =
        principal > 0 ? imfLevelPaymentPerTurn(principal, r, Math.max(1, rem)) : 0;
      const incomeCapPerTurn = lastTurnIncome * incomeCapFraction;
      const sim = simulateImfFacilityPayoffTurns({
        initialPrincipal: principal,
        annualRatePercent: ann,
        amortizationTurns: rem,
        turnIncome: lastTurnIncome,
        incomeCapFraction,
      });

      return NextResponse.json({
        mode: "active" as const,
        corporationId: corp._id.toString(),
        name: corp.name,
        bonds: [],
        facilityPrincipal: principal,
        annualRatePercent: ann,
        amortizationTurnsRemaining: rem,
        incomeCapturePercent: Math.round(incomeCapFraction * 1000) / 10,
        incomeCapturePercentStored: Math.round(storedFraction * 1000) / 10,
        incomeCapturePercentMax: IMF_BAILOUT_INCOME_FRACTION_CAP * 100,
        lastReportedTurnIncome: lastTurnIncome,
        lastHistoryTurn,
        scheduledPaymentPerTurn: scheduledFirstTurn,
        incomeCapPerTurn,
        simulation: {
          estimatedTurnsToClear: sim.estimatedTurns,
          outcome: sim.outcome,
          principalEnd: sim.principalEnd,
          warning: sim.warning,
        },
      });
    }

    const bonds = await db
      .collection<Bond>("bonds")
      .find({ corporationId: corp._id, matured: false })
      .toArray();

    const bondRows = bonds.map((b) => {
      const after = roundFaceToBondUnits((b.totalIssued ?? 0) * retention);
      return {
        bondId: b._id.toString(),
        totalIssued: b.totalIssued ?? 0,
        afterHaircutFace: after,
        couponRate: b.couponRate,
      };
    });

    let facilityPrincipal = 0;
    for (const b of bonds) {
      facilityPrincipal += roundFaceToBondUnits((b.totalIssued ?? 0) * retention);
    }

    const ann = Number.isFinite(annualRate) ? Math.min(80, Math.max(0, annualRate)) : 6;
    const rem = Number.isFinite(amortTurns) ? amortTurns : 240;
    const r = imfPerTurnInterestRate(ann);
    const scheduledFirstTurn =
      facilityPrincipal > 0 ? imfLevelPaymentPerTurn(facilityPrincipal, r, Math.max(1, rem)) : 0;
    const incomeCapPerTurn = lastTurnIncome * incomeCapFraction;

    const sim =
      facilityPrincipal > 0
        ? simulateImfFacilityPayoffTurns({
            initialPrincipal: facilityPrincipal,
            annualRatePercent: ann,
            amortizationTurns: rem,
            turnIncome: lastTurnIncome,
            incomeCapFraction,
          })
        : {
            estimatedTurns: 0,
            principalEnd: 0,
            outcome: "cleared" as const,
            warning: null as string | null,
          };

    return NextResponse.json({
      mode: "preview" as const,
      corporationId: corp._id.toString(),
      name: corp.name,
      retention,
      bonds: bondRows,
      facilityPrincipal,
      annualRatePercent: ann,
      amortizationTurns: rem,
      incomeCapturePercent: Math.round(incomeCapFraction * 1000) / 10,
      incomeCapturePercentMax: IMF_BAILOUT_INCOME_FRACTION_CAP * 100,
      lastReportedTurnIncome: lastTurnIncome,
      lastHistoryTurn,
      scheduledPaymentPerTurn: scheduledFirstTurn,
      incomeCapPerTurn,
      simulation: {
        estimatedTurnsToClear: sim.estimatedTurns,
        outcome: sim.outcome,
        principalEnd: sim.principalEnd,
        warning: sim.warning,
      },
      note: "Estimated turns assume last reported per-turn operating income stays constant. If income falls, payoff stretches; if the cap cannot cover interest, principal grows.",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH /api/admin/corporations/[id]/imf-bailout — income capture % only (active bailout).
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const parsed = await parseJsonBody(request, patchIncomeCaptureSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: new ObjectId(id) });
    if (!corp) throw notFound("Corporation not found");

    if (!corp.imfBailoutActive) {
      return NextResponse.json(
        { error: "Income capture can only be changed while an IMF bailout is active" },
        { status: 400 }
      );
    }

    const fraction = incomeCapturePercentToFraction(parsed.data.incomeCapturePercent);
    const now = new Date();
    await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: corp._id },
        { $set: { imfFacilityIncomeCaptureFraction: fraction, updatedAt: now } }
      );

    return NextResponse.json({
      success: true,
      incomeCapturePercent: Math.round(fraction * 1000) / 10,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/corporations/[id]/imf-bailout
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const parsed = await parseJsonBody(request, adminImfBailoutSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const body = parsed.data;
    const db = await getDb();

    const corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: new ObjectId(id) });
    if (!corp) throw notFound("Corporation not found");

    if (corp.imfInstitution) {
      return NextResponse.json(
        { error: "Cannot apply IMF bailout to the IMF institution itself" },
        { status: 400 }
      );
    }

    if (corp.countryOwnerId) {
      return NextResponse.json(
        { error: "National corporations cannot enter IMF restructuring" },
        { status: 400 }
      );
    }

    const imfCorp = await getImfCorporation(db);
    if (!imfCorp) {
      return NextResponse.json(
        {
          error:
            "IMF institution corporation not found — seed it from Admin → Server Setup or Corporations (IMF form), or run scripts/seed-imf-institution.ts",
        },
        { status: 400 }
      );
    }

    const now = new Date();

    if (!body.active) {
      await db.collection<Corporation>("corporations").updateOne(
        { _id: corp._id },
        {
          $set: { imfBailoutActive: false, updatedAt: now },
          $unset: {
            imfBailoutImfCorporationId: "",
            imfBailoutTargetOwnershipPercent: "",
            imfFacilityPrincipalOutstanding: "",
            imfFacilityAnnualRate: "",
            imfFacilityAmortizationTurnsRemaining: "",
            imfFacilityIncomeCaptureFraction: "",
          },
        }
      );
      return NextResponse.json({ success: true, active: false });
    }

    if (corp.imfBailoutActive) {
      return NextResponse.json(
        { error: "IMF bailout is already active for this corporation" },
        { status: 400 }
      );
    }

    if (
      body.targetOwnershipPercent == null ||
      body.annualRatePercent == null ||
      body.amortizationTurns == null
    ) {
      return NextResponse.json(
        {
          error:
            "targetOwnershipPercent, annualRatePercent, and amortizationTurns are required when activating",
        },
        { status: 400 }
      );
    }

    const incomeFraction = incomeCapturePercentToFraction(
      body.incomeCapturePercent ?? DEFAULT_INCOME_CAPTURE_PERCENT
    );

    const bonds = await db
      .collection<Bond>("bonds")
      .find({ corporationId: corp._id, matured: false })
      .toArray();

    const retention = body.bondHaircutRetention ?? 0.7;
    let facilityPrincipal = 0;
    const holderCharIds = new Set<string>();

    for (const bond of bonds) {
      const newIssued = roundFaceToBondUnits((bond.totalIssued ?? 0) * retention);
      facilityPrincipal += newIssued;
      for (const h of bond.holders ?? []) {
        if (h.characterId) holderCharIds.add(h.characterId.toString());
      }
    }

    if (facilityPrincipal <= 0) {
      return NextResponse.json(
        { error: "IMF bailout requires outstanding bond principal" },
        { status: 400 }
      );
    }

    if (bonds.length > 0) {
      if (holderCharIds.size > 0) {
        const chars = await db
          .collection<Character>("characters")
          .find(
            { _id: { $in: [...holderCharIds].map((x) => new ObjectId(x)) } },
            { projection: { _id: 1, name: 1, userId: 1, sequentialId: 1 } }
          )
          .toArray();

        for (const ch of chars) {
          await sendSystemMail(db, {
            toCharacterId: ch._id,
            toCharacterName: ch.name,
            toCharacterSequentialId: ch.sequentialId ?? 0,
            toUserId: ch.userId,
            senderName: "IMF Restructuring",
            subject: `${corp.name}: bond position haircut`,
            body: `Your bond holdings in ${corp.name} were reduced as part of an IMF restructuring. Bondholders retain approximately ${Math.round(retention * 100)}% of face value; remaining obligations are consolidated into an IMF facility. Dividends and CEO pay are suspended until the facility is repaid or the program ends.`,
          });
        }
      }

      const bondIds = bonds.map((b) => b._id);
      if (bondIds.length > 0) {
        await db.collection("bondHistory").deleteMany({ bondId: { $in: bondIds } });
      }
      await db.collection<Bond>("bonds").deleteMany({ corporationId: corp._id });
    }

    const shareholders = [...(corp.shareholders ?? [])];
    const imfKey = imfCorp._id.toString();
    const imfIdx = shareholders.findIndex(
      (s) => s.corporationId && s.corporationId.toString() === imfKey
    );
    const currentImfShares = imfIdx >= 0 ? (shareholders[imfIdx].shares ?? 0) : 0;
    const O = corp.totalShares ?? 10_000_000;
    const targetImfShares = dilutionSharesForImf(O, body.targetOwnershipPercent);
    const newShares = Math.max(0, targetImfShares - currentImfShares);

    if (newShares < 1 && currentImfShares === 0) {
      return NextResponse.json(
        { error: "Diluted share issuance rounds to zero — raise target %" },
        { status: 400 }
      );
    }

    if (imfIdx >= 0) {
      shareholders[imfIdx] = {
        ...shareholders[imfIdx],
        shares: (shareholders[imfIdx].shares ?? 0) + newShares,
      };
    } else if (newShares > 0) {
      shareholders.push({
        corporationId: imfCorp._id,
        shares: newShares,
      });
    }

    const newTotal = O + newShares;

    await db.collection<Corporation>("corporations").updateOne(
      { _id: corp._id },
      {
        $set: {
          totalShares: newTotal,
          shareholders,
          imfBailoutActive: true,
          imfBailoutImfCorporationId: imfCorp._id,
          imfBailoutTargetOwnershipPercent: body.targetOwnershipPercent,
          imfBailoutStartedAt: now,
          imfFacilityPrincipalOutstanding: facilityPrincipal,
          imfFacilityAnnualRate: body.annualRatePercent,
          imfFacilityAmortizationTurnsRemaining: body.amortizationTurns,
          imfFacilityIncomeCaptureFraction: incomeFraction,
          dividendRate: 0,
          ceoSalary: 0,
          lastDividendChange: now,
          updatedAt: now,
        },
      }
    );

    await fireImfBailoutPulse(db, id);

    return NextResponse.json({
      success: true,
      active: true,
      facilityPrincipalAnchor: facilityPrincipal,
      newSharesIssuedToImf: newShares,
      newTotalShares: newTotal,
      incomeCapturePercent: Math.round(incomeFraction * 1000) / 10,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
