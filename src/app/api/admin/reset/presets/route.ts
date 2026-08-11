import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { RESET_PRESETS } from "@/lib/constants/historicalSeats";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    return NextResponse.json({ presets: RESET_PRESETS });
  } catch (error) {
    return handleRouteError(error);
  }
}
