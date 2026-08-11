/**
 * GET /api/country/[code]/legislature/seanad/composition — returns the read-only
 * cosmetic Seanad composition for Ireland (only IE is supported; other codes
 * return 404). See `src/lib/ireland/seanadComposition.ts` for the derivation
 * rules and design doc §3.3 for the design rationale.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { deriveSeanadComposition } from "@/lib/ireland/seanadComposition";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    if (code.toUpperCase() !== "IE") {
      return NextResponse.json(
        { error: "Seanad composition is only available for Ireland" },
        { status: 404 }
      );
    }
    const db = await getDb();
    const composition = await deriveSeanadComposition(db, "IE");
    return NextResponse.json(composition);
  } catch (error) {
    return handleRouteError(error);
  }
}
