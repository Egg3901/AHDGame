import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { runSeed } from "@/lib/admin/seed";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { timingSafeCompare } from "@/lib/api/timingSafeCompare";

// POST /api/seed — Seeds the database from static seed data; protected by SEED_SECRET bearer token and idempotent unless ?reset=true.
// Auth: requireAdminOrApiKey
// Errors: 401
export async function POST(request: Request) {
  const secret = process.env.SEED_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "SEED_SECRET environment variable is not set." },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!timingSafeCompare(token, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const reset = searchParams.get("reset") === "true";

  try {
    const db = await getDb();
    const logs: string[] = [];

    const result = await runSeed({
      preset: await getGameStatePresetOrDefault(db),
      db,
      reset,
      log: (msg) => logs.push(msg),
    });

    return NextResponse.json({ ...result, logs }, { status: 200 });
  } catch (error) {
    return handleRouteError(error);
  }
}
