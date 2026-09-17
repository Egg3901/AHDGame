// GET /api/admin/players/[userId]/identity-history — paged IP / fingerprint runs
// Auth: requireModerator (moderators see masked IPs; admins see raw)
// Query: ?track=ip|fingerprint (required), ?page (default 1)
// Errors: 400, 403
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { schemas } from "@/lib/api/validate";
import { loadIdentityHistory } from "@/lib/identityHistory/loadHistory";

interface RouteParams {
  params: Promise<{ userId: string }>;
}

const querySchema = z.object({
  track: z.enum(["ip", "fingerprint"]),
  // `.catch(1)` rather than a hard failure: a bad page number is a navigation
  // artefact, not an attack, and falling back to the first page is friendlier
  // than a 400. An unknown `track` DOES fail, because guessing a track would
  // silently show a moderator the wrong evidence.
  page: z.coerce.number().int().positive().catch(1),
  // Which surface is asking. The moderator panel hides network detail for
  // EVERY viewer, including admins, so the card cannot say "Network details
  // hidden" in one row and print the address in the next. Client-supplied, but
  // it can only ever ADD masking: a non-admin is masked whatever they send.
  context: z.enum(["admin", "moderator"]).catch("admin"),
});

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { userId: userIdParam } = await params;
    const parsedId = schemas.objectId.safeParse(userIdParam);
    if (!parsedId.success) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const parsedQuery = querySchema.safeParse({
      track: searchParams.get("track"),
      page: searchParams.get("page") ?? 1,
      context: searchParams.get("context") ?? "admin",
    });
    if (!parsedQuery.success) {
      return NextResponse.json({ error: "Invalid track" }, { status: 400 });
    }

    const db = await getDb();
    const result = await loadIdentityHistory(
      db,
      new ObjectId(parsedId.data),
      parsedQuery.data.track,
      parsedQuery.data.page,
      // Both conditions must hold. The role check is the security boundary and
      // is never influenced by the request; the context check is presentation,
      // and can only narrow what an admin sees so the moderator panel looks the
      // same no matter who opens it.
      {
        revealNetwork: auth.user.isAdmin === true && parsedQuery.data.context !== "moderator",
      }
    );

    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
