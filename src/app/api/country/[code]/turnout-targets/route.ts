import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getTurnoutTargetsForCountry } from "@/lib/demographics/turnoutTargets";

export const dynamic = "force-dynamic";

/**
 * The Layer-1 buckets a turnout action can target in this country.
 *
 * Served rather than computed in the browser for two reasons: the bucket set is
 * era-dependent (it comes from the seeded substrate for the game's preset), and
 * the country models are a large server-only module that has no business in a
 * client bundle.
 *
 * Not per-user — the answer depends only on country and preset — but still
 * `no-store`, because the era can roll over mid-game and a stale picker would
 * offer buckets the electorate no longer has.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const db = await getDb();
  const gs = await db
    .collection<{ _id: string; preset?: string }>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1 } });

  const sections = getTurnoutTargetsForCountry(code.toUpperCase(), gs?.preset ?? null);
  return NextResponse.json({ sections }, { headers: { "Cache-Control": "no-store" } });
}
