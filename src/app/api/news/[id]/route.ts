import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { editNewsPost } from "@/lib/news/commands/newsCommands";

const editPostSchema = z.object({
  title: z.string().max(100).trim().optional(),
  content: z.string().min(1).max(1000).trim(),
  imageUrl: z.string().max(2048).optional(),
});

// PATCH /api/news/[id] — Edit your own top-level post (title, content, imageUrl); stamps `editedAt`.
// Auth: requireBasicAuth (author-only, enforced in editNewsPost)
// Errors: 400, 401, 403, 404, 429
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, editPostSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { id } = await params;
    const db = await getDb();
    return NextResponse.json(
      await editNewsPost(db, {
        userId: auth.user.userId,
        postId: id,
        ...parsed.data,
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
