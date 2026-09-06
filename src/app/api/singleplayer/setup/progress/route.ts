import { NextResponse } from "next/server";
import { requireSingleplayer } from "@/lib/api/requireSingleplayer";
import { readSingleplayerSetupProgress } from "@/lib/singleplayer/setupProgress";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = requireSingleplayer(request);
  if (denied) return denied;
  return NextResponse.json(readSingleplayerSetupProgress(), {
    headers: { "Cache-Control": "no-store" },
  });
}
