import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { badRequest, forbidden, handleRouteError, notFound } from "@/lib/api/errors";
import { getGameTime } from "@/lib/time/gameTime";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import type { CoalitionLeadershipGoalKey, CoalitionPriority } from "@/lib/db/types/coalition";
import {
  COALITION_LEADERSHIP_GOAL_OPTIONS,
  COALITION_POLICY_THEME_OPTIONS,
  MAX_ACTIVE_COALITION_PRIORITIES,
  normalizeCoalitionPriorities,
  shouldActivatePriority,
} from "@/lib/coalitions/priorities";
import {
  buildCoalitionPriorityPayload,
  loadCoalitionPriorityContext,
  parseCoalitionCountry,
  resolveCoalitionPriorityViewer,
} from "@/lib/coalitions/priorityApi";

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/);

const baseSchema = {
  visibility: z.enum(["public", "internal"]),
  stance: z.enum(["support", "oppose"]),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(280),
};

const createPrioritySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("policy_theme"),
    policyThemeKey: z.enum(
      COALITION_POLICY_THEME_OPTIONS.map((option) => option.key) as [string, ...string[]]
    ),
    ...baseSchema,
  }),
  z.object({
    type: z.literal("bill"),
    billId: objectIdString,
    ...baseSchema,
  }),
  z.object({
    type: z.literal("leadership_goal"),
    leadershipGoalKey: z.enum(
      COALITION_LEADERSHIP_GOAL_OPTIONS.map((option) => option.key) as [string, ...string[]]
    ),
    targetName: z.string().trim().min(1).max(80).optional().default(""),
    expiresAt: z.string().datetime(),
    ...baseSchema,
  }),
]);

// GET /api/country/[code]/coalitions/[id]/priorities â€” Returns coalition priorities with mixed public/internal visibility.
// Auth: public (optional auth via getAuthUserWithCharacter)
// Errors: 400, 404
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = parseCoalitionCountry(code);
    if (!countryId) {
      throw badRequest("Invalid country code.");
    }

    const sequentialId = Number.parseInt(id, 10);
    if (!Number.isFinite(sequentialId)) {
      throw badRequest("Coalition ID must be a number.");
    }

    const db = await getDb();
    const context = await loadCoalitionPriorityContext(db, countryId, sequentialId);
    if (!context) {
      throw notFound("Coalition not found.");
    }

    const viewerAuth = await getAuthUserWithCharacter().catch(() => null);
    const viewer = resolveCoalitionPriorityViewer(viewerAuth, context);
    const now = new Date();
    const gameTimeForList = await getGameTime();
    const { payload, normalizedPriorities, changed } = buildCoalitionPriorityPayload(
      context,
      viewer,
      now,
      gameTimeForList.currentTurn
    );

    if (changed) {
      await db
        .collection("coalitions")
        .updateOne(
          { _id: context.coalition._id },
          { $set: { priorities: normalizedPriorities, updatedAt: now } }
        );
    }

    return NextResponse.json(payload);
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/country/[code]/coalitions/[id]/priorities â€” Coalition chair proposes a new coalition priority.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { code, id } = await params;
    const countryId = parseCoalitionCountry(code);
    if (!countryId) {
      throw badRequest("Invalid country code.");
    }

    const sequentialId = Number.parseInt(id, 10);
    if (!Number.isFinite(sequentialId)) {
      throw badRequest("Coalition ID must be a number.");
    }

    const parsed = await parseJsonBody(request, createPrioritySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const context = await loadCoalitionPriorityContext(db, countryId, sequentialId);
    if (!context) {
      throw notFound("Coalition not found.");
    }

    const viewer = resolveCoalitionPriorityViewer(auth.user, context);
    if (!viewer.canPropose || !viewer.characterObjectId) {
      throw forbidden("Only the coalition chair can propose priorities.");
    }

    const now = new Date();
    const gameTime = await getGameTime();
    const normalized = normalizeCoalitionPriorities(
      context.coalition,
      context.billsById,
      now,
      gameTime.currentTurn
    );
    const existingPriorities = normalized.priorities;
    const activePriorityCount = existingPriorities.filter(
      (priority) => priority.status === "active"
    ).length;

    // For leadership-goal priorities the caller passes an absolute ISO expiry.
    // Convert that to the equivalent game-clock turn so the server-side expiry
    // check uses the game clock (durable against drift) — see
    // docs/plans/archive/2026-05/2026-05-20-clock-mismatch-design.md.
    const leadershipExpiresAt =
      parsed.data.type === "leadership_goal" ? new Date(parsed.data.expiresAt) : null;
    const leadershipExpiresOnTurn = leadershipExpiresAt
      ? gameTime.currentTurn +
        Math.max(
          0,
          Math.round(
            (leadershipExpiresAt.getTime() - gameTime.effectiveNow.getTime()) / MS_PER_TURN
          )
        )
      : null;

    const nextPriority: CoalitionPriority = {
      id: new ObjectId().toString(),
      type: parsed.data.type,
      visibility: parsed.data.visibility,
      status: "proposed",
      stance: parsed.data.stance,
      title: parsed.data.title,
      description: parsed.data.description,
      policyThemeKey: parsed.data.type === "policy_theme" ? parsed.data.policyThemeKey : null,
      billId: parsed.data.type === "bill" ? new ObjectId(parsed.data.billId) : null,
      billTitle: null,
      leadershipGoalKey:
        parsed.data.type === "leadership_goal"
          ? (parsed.data.leadershipGoalKey as CoalitionLeadershipGoalKey)
          : null,
      targetName: parsed.data.type === "leadership_goal" ? parsed.data.targetName || null : null,
      expiresAt: leadershipExpiresAt,
      expiresOnTurn: leadershipExpiresOnTurn,
      votes: [
        {
          partyId: context.coalition.chairPartyId,
          chairCharacterId: auth.user.character._id,
          vote: "support",
          votedAt: now,
        },
      ],
      createdBy: auth.user.character._id,
      createdAt: now,
      updatedAt: now,
      activatedAt: null,
      resolvedAt: null,
      resolvedBy: null,
    };

    if (parsed.data.type === "bill") {
      const bill = context.billsById.get(parsed.data.billId);
      if (!bill) {
        throw badRequest("Bill priorities must target a currently active bill.");
      }
      nextPriority.billTitle = bill.title;
    }

    if (
      nextPriority.type === "leadership_goal" &&
      (!nextPriority.expiresAt || nextPriority.expiresAt.getTime() <= now.getTime())
    ) {
      throw badRequest("Leadership goals need a future expiration time.");
    }

    if (shouldActivatePriority(nextPriority, context.memberParties.length)) {
      if (activePriorityCount >= MAX_ACTIVE_COALITION_PRIORITIES) {
        throw badRequest("Archive an active coalition priority before adding another.");
      }
      nextPriority.status = "active";
      nextPriority.activatedAt = now;
    }

    const priorities = [...existingPriorities, nextPriority];
    await db
      .collection("coalitions")
      .updateOne({ _id: context.coalition._id }, { $set: { priorities, updatedAt: now } });

    return NextResponse.json({
      success: true,
      message:
        nextPriority.status === "active"
          ? "Coalition priority activated."
          : "Coalition priority proposed.",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
