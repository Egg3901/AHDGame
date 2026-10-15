import { NextResponse } from "next/server";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { loadPublicSubsidiaryGroups } from "@/lib/corporations/groups/publicListing";
export async function GET() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    return NextResponse.json({ groups: await loadPublicSubsidiaryGroups(await getDb()) });
  } catch (error) {
    return handleRouteError(error);
  }
}
