import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { policyShiftSchema } from "@/lib/api/schemas/settings";
import type { Character } from "@/lib/db/types";

// POST /api/settings/policy — Shifts the authenticated character's economic or social policy position by one step
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 429
export async function POST(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, policyShiftSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { axis: axisKey, direction } = parsed.data;
    const ACTION_COST = 15;

    const db = await getDb();
    const policyField = `policies.${axisKey}`;
    const boundFilter =
      direction > 0 ? { [policyField]: { $lt: 5 } } : { [policyField]: { $gt: -5 } };

    // The deliberate shift is ±1 (whole integer) applied to a value already on
    // the 0.05 position grid, so the result stays on-grid — no snap needed here.
    const updatedCharacter = await db.collection<Character>("characters").findOneAndUpdate(
      { _id: user.character._id, actions: { $gte: ACTION_COST }, ...boundFilter },
      [
        {
          $set: {
            actions: { $subtract: ["$actions", ACTION_COST] },
            infamy: {
              $min: [100, { $max: [0, { $add: [{ $ifNull: ["$infamy", 0] }, 5] }] }],
            },
            [policyField]: { $add: [`$${policyField}`, direction] },
            politicalInfluence: {
              $floor: { $multiply: [{ $ifNull: ["$politicalInfluence", 0] }, 0.95] },
            },
            nationalInfluence: {
              $floor: { $multiply: [{ $ifNull: ["$nationalInfluence", 0] }, 0.95] },
            },
            updatedAt: new Date(),
          },
        },
      ],
      { returnDocument: "after" }
    );

    if (!updatedCharacter) {
      const freshCharacter = await db
        .collection<Character>("characters")
        .findOne({ _id: user.character._id }, { projection: { actions: 1, policies: 1 } });
      const currentPolicy = freshCharacter?.policies?.[axisKey] ?? user.character.policies[axisKey];
      if (direction > 0 ? currentPolicy >= 5 : currentPolicy <= -5) {
        return NextResponse.json({ error: "Policy cannot go beyond -5 or 5." }, { status: 400 });
      }
      return NextResponse.json(
        { error: `Not enough actions. You need ${ACTION_COST} actions.` },
        { status: 400 }
      );
    }

    try {
      const { awardAchievement } = await import("@/lib/achievements");
      await awardAchievement(new ObjectId(user.userId), "policy_shift", user.character._id);
    } catch (e) {
      console.error("Achievement check failed:", e);
    }

    return NextResponse.json({
      success: true,
      message: `Policy shifted successfully.`,
      stats: {
        policies: updatedCharacter.policies,
        actions: updatedCharacter.actions,
        infamy: updatedCharacter.infamy,
        politicalInfluence: updatedCharacter.politicalInfluence,
        nationalInfluence: updatedCharacter.nationalInfluence,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
