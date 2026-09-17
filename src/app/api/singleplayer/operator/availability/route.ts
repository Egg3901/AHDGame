import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireSingleplayer } from "@/lib/api/requireSingleplayer";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import {
  getSingleplayerWorldAvailability,
  setSingleplayerWorldAvailability,
} from "@/lib/singleplayerOperator";

const bodySchema = z.object({ availability: z.enum(["open", "sealed"]) }).strict();

export async function GET(request: Request) {
  const denied = requireSingleplayer(request);
  if (denied) return denied;
  try {
    const mode = await getSingleplayerWorldAvailability(await getDb());
    return NextResponse.json({ availability: mode === "off" ? "open" : "sealed", mode });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  const denied = requireSingleplayer(request);
  if (denied) return denied;
  try {
    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const mode = await setSingleplayerWorldAvailability(await getDb(), parsed.data.availability);
    return NextResponse.json({ availability: mode === "off" ? "open" : "sealed", mode });
  } catch (error) {
    return handleRouteError(error);
  }
}
