import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { castImpeachmentVote } from "@/lib/impeachment/castImpeachmentVote";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const voteSchema = z.object({
  vote: z.enum(["aye", "nay", "abstain"]),
});

// POST /api/impeachments/[id]/vote — cast/change a vote on an active impeachment.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, voteSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { id } = await params;
    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json({ error: "No character" }, { status: 400 });
    }

    const result = await castImpeachmentVote(db, id, character, parsed.data.vote);
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
