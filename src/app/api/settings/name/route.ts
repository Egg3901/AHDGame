import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { characterNameSchema } from "@/lib/api/schemas/settings";
import { propagateCharacterNameChange } from "@/lib/propagateNameChange";

// POST /api/settings/name — Changes the authenticated character's name subject to a 24-hour cooldown
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 429
export async function POST(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, characterNameSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const trimmedName = parsed.data.name;

    // Check cooldown (24 hours)
    if (user.character.lastNameChange) {
      const lastChange = new Date(user.character.lastNameChange);
      const now = new Date();
      const diffMs = now.getTime() - lastChange.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      if (diffHours < 24) {
        const remainingHours = Math.ceil(24 - diffHours);
        return NextResponse.json(
          { error: `You can change your name again in ${remainingHours} hours` },
          { status: 403 }
        );
      }
    }

    const db = await getDb();

    const characterId = user.character._id;

    // Update character name and timestamp
    await db.collection("characters").updateOne(
      { _id: characterId },
      {
        $set: {
          name: trimmedName,
          lastNameChange: new Date(),
        },
      }
    );

    // Propagate name to all denormalized collections (non-blocking — fire and forget)
    propagateCharacterNameChange(db, characterId, trimmedName).catch((err) =>
      console.error("[NameChange] Propagation error:", err)
    );

    return NextResponse.json({
      success: true,
      message: "Name changed successfully",
      name: trimmedName,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
