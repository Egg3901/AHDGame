import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { claimCharacterActivation } from "@/lib/analytics/characterActivation";
import { handleRouteError, errorResponse } from "@/lib/api/errors";

const schema = z.object({
  characterId: z.string().regex(/^[a-f0-9]{24}$/i),
  consent: z.literal(true),
});

export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const db = await getDb();
    const character = await db
      .collection("characters")
      .findOne(
        { _id: new ObjectId(parsed.data.characterId), userId: new ObjectId(auth.user.userId) },
        { projection: { _id: 1 } }
      );
    if (!character) return errorResponse(404, "Character unavailable");
    return NextResponse.json({
      activation: await claimCharacterActivation(db, parsed.data.characterId),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
