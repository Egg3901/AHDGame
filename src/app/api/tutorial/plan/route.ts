import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import type { Character } from "@/lib/db/types";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import {
  TUTORIAL_CHAPTER_IDS,
  TUTORIAL_EXPERIENCES,
  TUTORIAL_INTERESTS,
  normalizeInterests,
  resolveTutorialPlan,
} from "@/lib/onboarding/tutorialPlan";

/**
 * The player's guided-tour plan and their place in it.
 *
 * GET  — the resolved plan (stored, or migrated from the legacy track), whether
 *        they have answered the welcome flow yet, and the server-side resume
 *        point. The coach and the /tutorial hub both read this.
 * PUT  — write the plan, the resume point, or a finished chapter. All three
 *        fields are independent so the coach can save progress on every step
 *        without resending the plan.
 *
 * Progress is stored server-side so switching device does not restart the tour.
 * The coach keeps a localStorage copy as the offline fast path; on load the
 * server value wins.
 */

const planBodySchema = z
  .object({
    experience: z.enum(TUTORIAL_EXPERIENCES).optional(),
    interests: z.array(z.enum(TUTORIAL_INTERESTS)).optional(),
    progress: z
      .object({
        chapterId: z.enum(TUTORIAL_CHAPTER_IDS),
        stepId: z.string().min(1).max(64),
      })
      .nullable()
      .optional(),
    completedChapter: z.enum(TUTORIAL_CHAPTER_IDS).optional(),
  })
  // `experience` and `interests` are written together or not at all: a plan
  // with one half updated is not a plan anyone chose.
  .refine((body) => (body.experience === undefined) === (body.interests === undefined), {
    message: "experience and interests must be sent together",
  });

export async function GET() {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const { character } = auth.user;

    return NextResponse.json({
      plan: resolveTutorialPlan(character),
      /** False until the player answers the welcome flow. */
      chosen: character.tutorial?.chosenAt !== undefined,
      progress: character.tutorial?.progress ?? null,
      completedChapters: character.tutorial?.completedChapters ?? [],
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const { character } = auth.user;

    // Generous: the coach writes a resume point on every step change.
    const rateLimit = checkRateLimit(`tutorial-plan:${auth.user.userId}`, 120, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, planBodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body = parsed.data;

    const set: Record<string, unknown> = {};
    const addToSet: Record<string, unknown> = {};
    const unset: Record<string, unknown> = {};

    if (body.experience !== undefined && body.interests !== undefined) {
      // Skipping is the one experience that legitimately carries no interests.
      const interests = body.experience === "skip" ? [] : normalizeInterests(body.interests);
      if (body.experience !== "skip" && interests.length === 0) {
        return NextResponse.json(
          { error: "Choose at least one thing you want to do" },
          { status: 400 }
        );
      }
      set["tutorial.experience"] = body.experience;
      set["tutorial.interests"] = interests;
      set["tutorial.chosenAt"] = new Date();
    }

    if (body.progress !== undefined) {
      if (body.progress === null) {
        unset["tutorial.progress"] = "";
      } else {
        set["tutorial.progress"] = { ...body.progress, updatedAt: new Date() };
      }
    }

    if (body.completedChapter !== undefined) {
      addToSet["tutorial.completedChapters"] = body.completedChapter;
    }

    if (
      Object.keys(set).length === 0 &&
      Object.keys(addToSet).length === 0 &&
      Object.keys(unset).length === 0
    ) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const db = await getDb();
    await db.collection<Character>("characters").updateOne({ _id: character._id }, {
      ...(Object.keys(set).length ? { $set: { ...set, updatedAt: new Date() } } : {}),
      ...(Object.keys(addToSet).length ? { $addToSet: addToSet } : {}),
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
    } as never);

    const updated = await db
      .collection<Character>("characters")
      .findOne({ _id: character._id }, { projection: { tutorial: 1, tutorialTrack: 1 } });

    return NextResponse.json({
      success: true,
      plan: resolveTutorialPlan(updated ?? character),
      chosen: updated?.tutorial?.chosenAt !== undefined,
      progress: updated?.tutorial?.progress ?? null,
      completedChapters: updated?.tutorial?.completedChapters ?? [],
    });
  } catch (error) {
    return handleRouteError(error, { request, route: "/api/tutorial/plan PUT" });
  }
}
