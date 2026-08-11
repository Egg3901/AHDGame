import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { reactToNewsPost } from "@/lib/news/commands/newsCommands";

const reactSchema = z.object({
  reaction: z.enum(["agree", "disagree"]),
});

// POST /api/news/[id]/react — Add, change, or toggle a reaction (agree/disagree) on a news post.
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, reactSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { id } = await params;
    const db = await getDb();
    return NextResponse.json(
      await reactToNewsPost(db, {
        userId: auth.user.userId,
        postId: id,
        reaction: parsed.data.reaction,
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
