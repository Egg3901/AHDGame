import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { reactToBillDiscussion } from "@/lib/legislature/discussions/discussionCommands";

const reactSchema = z.object({ reaction: z.enum(["agree", "disagree"]) });

// POST /api/congress/bills/[id]/discussions/[postId]/react — Toggle a reaction.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 404, 429
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 60, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, reactSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { postId } = await params;
    const db = await getDb();
    return NextResponse.json(
      await reactToBillDiscussion(db, {
        discussionId: postId,
        userId: auth.user.userId,
        reaction: parsed.data.reaction,
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
