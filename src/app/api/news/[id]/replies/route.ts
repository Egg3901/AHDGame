import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { createNewsReply } from "@/lib/news/commands/newsCommands";
import { getNewsReplies } from "@/lib/news/queries/newsQueries";

const replySchema = z.object({
  content: z.string().min(1).max(500).trim(),
});

// GET /api/news/[id]/replies — List all replies for a news post, sorted oldest first.
// Auth: public
// Errors: 400
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await getDb();
    return NextResponse.json(await getNewsReplies(db, id));
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/news/[id]/replies — Post a reply to a news post, requiring an active character.
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, replySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { id } = await params;
    const db = await getDb();
    return NextResponse.json(
      await createNewsReply(db, {
        userId: auth.user.userId,
        postId: id,
        content: parsed.data.content,
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
