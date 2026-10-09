import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { closeFieldOffice } from "@/lib/campaigns/fieldOffices/commands";

interface RouteParams {
  params: Promise<{ id: string; officeId: string }>;
}

// DELETE /api/campaigns/[id]/field-offices/[officeId] - Close a field office. No refund.
// Auth: requireAuthWithCharacter (campaign manager or nominee)
// Errors: 400, 401, 403, 404, 429
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { id, officeId } = await params;
    if (!ObjectId.isValid(id) || !ObjectId.isValid(officeId)) {
      return errorResponse(400, "Invalid ID");
    }
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    await closeFieldOffice({
      db,
      campaignId: new ObjectId(id),
      officeId: new ObjectId(officeId),
      user: auth.user,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
