import { NextResponse } from "next/server";
import type { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";

/**
 * Gate a National Corporation operational route to its seated CEO. Returns a 403
 * NextResponse when `characterId` is not the seated CEO, else `null` (authorized).
 * Spec P6g §6.
 */
export function requireSeatedCeo(corp: Corporation, characterId: ObjectId): NextResponse | null {
  if (corp.ceoVacant || corp.ceoId == null || corp.ceoId.toString() !== characterId.toString()) {
    return NextResponse.json(
      { error: "Only the seated CEO of this National Corporation may take this action." },
      { status: 403 }
    );
  }
  return null;
}
