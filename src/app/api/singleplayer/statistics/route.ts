import { NextResponse } from "next/server";
import { requireSingleplayer } from "@/lib/api/requireSingleplayer";
import { getDb } from "@/lib/mongodb";
import { collectLocalStatistics } from "@/lib/singleplayerStatistics";

export const dynamic = "force-dynamic";

/** Local aggregates only. No names, identifiers or save documents leave this route. */
export async function GET(request: Request) {
  const denied = requireSingleplayer(request);
  if (denied) return denied;
  const db = await getDb();
  const payload = await collectLocalStatistics(db);
  if (!payload) return NextResponse.json({ error: "No local world" }, { status: 409 });
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
