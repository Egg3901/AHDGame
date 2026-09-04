// PATCH /api/country/[code]/executive/cabinet/[positionId]/intelligence/budget
//
// Move money from the defence appropriation into the intelligence purse.
//
// The agency's own `budgetRemaining` IS the appropriation line, deliberately, and
// not an estate envelope: the estate fallback resolves to a flat band that is the
// same for a superpower and a small state, which erases exactly the asymmetry an
// intelligence budget exists to express.
//
// Auth: the intelligence seat holder or an admin. Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { creditAppropriation, debitAppropriation } from "@/lib/db/collections/defenseAppropriation";
import { getIntelligenceAgenciesCollection } from "@/lib/db/collections/intelligence";
import {
  getOrCreateAgency,
  loadCurrentTurn,
  requireIntelligenceHolder,
  type IntelligenceRouteParams,
} from "../shared";

const bodySchema = z.object({
  amount: z.number().finite().positive(),
});

export async function PATCH(request: Request, { params }: IntelligenceRouteParams) {
  try {
    const { code, positionId } = await params;
    const guard = await requireIntelligenceHolder(code, positionId);
    if ("error" in guard) return guard.error;
    const { db, countryId, member } = guard;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const amount = Math.round(parsed.data.amount);
    const turn = await loadCurrentTurn(db);
    const agency = await getOrCreateAgency(db, countryId, turn, member?.characterId ?? null);

    // Guarded debit first: it fails atomically when the appropriation cannot
    // cover the draw, so a concurrent spend loses cleanly rather than overdrawing.
    const drawn = await debitAppropriation(db, countryId, amount);
    if (!drawn) {
      return NextResponse.json(
        { error: "The defence appropriation cannot cover that transfer." },
        { status: 409 }
      );
    }

    const agencies = await getIntelligenceAgenciesCollection(db);
    const credited = await agencies.updateOne(
      { _id: agency._id },
      { $inc: { budgetRemaining: amount }, $set: { updatedAt: new Date() } }
    );
    if (credited.modifiedCount === 0) {
      // Refund rather than swallow: the money left the appropriation above.
      // `creditAppropriation`, NOT a negative debit: debit returns early on any
      // non-positive amount, so a negative "refund" would silently do nothing.
      await creditAppropriation(db, countryId, amount);
      return NextResponse.json({ error: "Could not credit the service." }, { status: 500 });
    }

    // Re-read rather than adding to the snapshot: an operation resolving
    // concurrently also moves this figure, and reporting snapshot + amount would
    // hand the console a number that was never true.
    const fresh = await agencies.findOne(
      { _id: agency._id },
      { projection: { budgetRemaining: 1 } }
    );
    return NextResponse.json({ budgetRemaining: fresh?.budgetRemaining ?? agency.budgetRemaining });
  } catch (error) {
    return handleRouteError(error);
  }
}
