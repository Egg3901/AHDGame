import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireSingleplayer } from "@/lib/api/requireSingleplayer";
import { singleplayerStatus } from "@/lib/singleplayerServer";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = requireSingleplayer(request);
  if (denied) return denied;
  return NextResponse.json(await singleplayerStatus(await getDb()));
}
