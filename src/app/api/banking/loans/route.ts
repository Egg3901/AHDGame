import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { handleRouteError, notFound, badRequest } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { originateLoan } from "@/lib/banking/lending";

const loanSchema = z
  .object({
    bankCorporationId: schemas.objectId,
    borrowerType: z.enum(["corporation", "character"]),
    borrowerCorporationId: schemas.objectId.optional(),
    principal: z.number().finite().positive(),
    termTurns: z.number().int().min(4).max(120),
  })
  .superRefine((body, ctx) => {
    if (body.borrowerType === "corporation" && !body.borrowerCorporationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "borrowerCorporationId is required when borrowerType is corporation",
        path: ["borrowerCorporationId"],
      });
    }
  });

// POST /api/banking/loans - Apply for a private-bank loan (self or CEO corp).
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
export async function POST(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    if (!(await isPrivateBankingEnabled())) {
      throw notFound("Not found");
    }

    const parsed = await parseJsonBody(request, loanSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const { bankCorporationId, borrowerType, borrowerCorporationId, principal, termTurns } =
      parsed.data;

    let borrowerId: ObjectId;
    if (borrowerType === "character") {
      borrowerId = auth.user.character._id;
    } else {
      if (!borrowerCorporationId) {
        throw badRequest("borrowerCorporationId is required");
      }
      const resolved = await resolveCorporation(db, borrowerCorporationId);
      if (!resolved.ok) return resolved.response;
      const ceoCheck = requireCeo(resolved.corporation, auth.user.userId);
      if (ceoCheck) return ceoCheck;
      borrowerId = resolved.corporation._id;
    }

    const result = await originateLoan(
      db,
      new ObjectId(bankCorporationId),
      { type: borrowerType, id: borrowerId },
      principal,
      termTurns
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      loan: result.loan,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
