import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { createNotification } from "@/lib/notifications";
import type { Character } from "@/lib/db/types";

const schema = z.object({
  body: z.string().min(1).max(1000),
});

const SHAREHOLDER_ADDRESS_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const { character } = auth.user;

    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    // Must be CEO
    if (!corporation.ceoId.equals(character._id)) {
      return NextResponse.json(
        { error: "Only the CEO can send a shareholder address" },
        { status: 403 }
      );
    }

    // Cooldown check
    if (corporation.lastShareholderAddressAt) {
      const elapsed = Date.now() - corporation.lastShareholderAddressAt.getTime();
      if (elapsed < SHAREHOLDER_ADDRESS_COOLDOWN_MS) {
        const retryAfterSeconds = Math.ceil((SHAREHOLDER_ADDRESS_COOLDOWN_MS - elapsed) / 1000);
        return rateLimitResponse(retryAfterSeconds);
      }
    }

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { body } = parsed.data;

    // Update cooldown
    await db
      .collection("corporations")
      .updateOne({ _id: corporation._id }, { $set: { lastShareholderAddressAt: new Date() } });

    // Batch-look up shareholders with shares > 0
    const shareholderCharIds = corporation.shareholders
      .filter((s) => s.shares > 0 && s.characterId !== undefined)
      .map((s) => s.characterId as ObjectId);

    if (shareholderCharIds.length === 0) {
      return NextResponse.json({ success: true, notified: 0 });
    }

    const shareholderCharacters = await db
      .collection<Character>("characters")
      .find({ _id: { $in: shareholderCharIds } }, { projection: { _id: 1, userId: 1 } })
      .toArray();

    const title = `${corporation.name} — Shareholder Address`;

    await Promise.all(
      shareholderCharacters.map((c) =>
        createNotification({
          userId: c.userId as ObjectId,
          type: "system",
          title,
          message: body,
        })
      )
    );

    return NextResponse.json({ success: true, notified: shareholderCharacters.length });
  } catch (error) {
    return handleRouteError(error);
  }
}
