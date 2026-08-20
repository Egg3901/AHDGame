import { NextResponse } from "next/server";
import { z } from "zod";
import type { Filter } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getSettlementCrisesCollection } from "@/lib/db/collections";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";
import { getGameState } from "@/lib/gameState";
import { resolveGameYear } from "@/lib/era/era";
import {
  HUNDREDTHS,
  SETTLEMENT_INSTITUTIONS,
  SETTLEMENT_RULE_KEYS,
  getInstitution,
  settlementRulesFor,
} from "@/lib/constants/settlementCrisis";
import { buildGermanQuestion, openSettlementCrisisIfDue } from "@/lib/settlement/openCrisis";
import { recomputePosition } from "@/lib/settlement/position";

/**
 * Admin control surface for the German Question, mirroring
 * `/api/admin/crises/*`: force-open, force-resolve, set a position, flip a rule.
 *
 * The one thing this route deliberately does NOT do is enact an outcome. A
 * forced resolve writes the outcome and leaves `cooldownUntilTurn` null, which
 * is exactly the state the turn phase's actuation sweep looks for — so an
 * admin-forced reunification runs through the same merge, the same history
 * entries and the same guards as one the players earned. A second write path
 * into `mergeCountry` is the last thing this feature needs.
 */
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("open"),
    /** Ignore the era window and the re-open cooldown. */
    force: z.boolean().default(false),
  }),
  z.object({ action: z.literal("resolve"), outcome: z.enum(["incumbent", "challenger"]) }),
  z.object({
    action: z.literal("setPosition"),
    institutionId: z.enum(SETTLEMENT_INSTITUTIONS.map((i) => i.id) as [string, ...string[]]),
    /** Points toward the challenger, 0-100. Converted to hundredths here. */
    points: z.number().min(0).max(100),
  }),
  z.object({
    action: z.literal("setRule"),
    key: z.enum(SETTLEMENT_RULE_KEYS as unknown as [string, ...string[]]),
    value: z.boolean(),
  }),
]);

/** GET /api/admin/settlement — the live board, or null with the reason. */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gameState = await getGameState(db);
    const currentTurn = gameState?.currentTurn ?? 1;
    const crises = await getSettlementCrisesCollection(db);

    const live = await crises.findOne({
      status: { $in: ["open", "frozen"] },
    } as Filter<SettlementCrisisDoc>);
    const history = await crises
      .find({ status: "resolved" } as Filter<SettlementCrisisDoc>)
      .sort({ resolvedTurn: -1 })
      .limit(5)
      .toArray();

    return NextResponse.json({
      enabled: gameState?.settlementCrisisEnabled === true,
      currentTurn,
      year: resolveGameYear(gameState ?? {}),
      crisis: live
        ? {
            id: live._id.toString(),
            status: live.status,
            position: live.position,
            heat: live.ladder.heat,
            openedTurn: live.openedTurn,
            conflictId: live.conflictId,
            rules: settlementRulesFor(live),
            institutions: live.institutions.map((inst) => ({
              id: inst.id,
              name: getInstitution(inst.id)?.name ?? inst.id,
              weight: inst.weight,
              position: inst.position,
            })),
          }
        : null,
      history: history.map((h) => ({
        id: h._id.toString(),
        outcome: h.outcome,
        resolvedTurn: h.resolvedTurn,
        cooldownUntilTurn: h.cooldownUntilTurn,
      })),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/admin/settlement — one of the four admin actions. */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body = parsed.data;

    const db = await getDb();
    const gameState = await getGameState(db);
    const currentTurn = gameState?.currentTurn ?? 1;
    const crises = await getSettlementCrisesCollection(db);

    if (body.action === "open") {
      // Unforced goes through the same gate the turn phase uses, so an admin
      // pressing "open" gets the same answer the tick would give and the same
      // reason when it declines.
      if (!body.force) {
        const result = await openSettlementCrisisIfDue(db, {
          turn: currentTurn,
          year: resolveGameYear(gameState ?? {}),
        });
        return result.opened
          ? NextResponse.json({ success: true, crisisId: result.crisisId })
          : NextResponse.json({ error: result.reason }, { status: 409 });
      }
      // Forced still refuses to make a SECOND live crisis: two would both tick.
      // The unique partial index would reject it anyway; this is the readable
      // error rather than a duplicate-key 500.
      const live = await crises.findOne({
        status: { $in: ["open", "frozen"] },
      } as Filter<SettlementCrisisDoc>);
      if (live) {
        return NextResponse.json(
          { error: "A settlement crisis is already live." },
          { status: 409 }
        );
      }
      const inserted = await crises.insertOne(
        buildGermanQuestion(currentTurn) as SettlementCrisisDoc
      );
      return NextResponse.json({ success: true, crisisId: inserted.insertedId.toString() });
    }

    const live = await crises.findOne({
      status: { $in: ["open", "frozen"] },
    } as Filter<SettlementCrisisDoc>);
    if (!live)
      return NextResponse.json({ error: "No settlement crisis is live." }, { status: 404 });

    if (body.action === "setRule") {
      await crises.updateOne(
        { _id: live._id },
        { $set: { [`rules.${body.key}`]: body.value, updatedAt: new Date() } }
      );
      return NextResponse.json({ success: true });
    }

    if (body.action === "setPosition") {
      // Write the institution, then DERIVE the index from all four. Setting
      // `position` directly is the one thing that would let the masthead
      // disagree with the cards it is a mean of.
      const institutions = live.institutions.map((inst) =>
        inst.id === body.institutionId
          ? { ...inst, position: Math.round(body.points * HUNDREDTHS) }
          : inst
      );
      await crises.updateOne(
        { _id: live._id },
        {
          $set: { institutions, position: recomputePosition(institutions), updatedAt: new Date() },
        }
      );
      return NextResponse.json({ success: true, position: recomputePosition(institutions) });
    }

    // resolve — write the outcome and stop. Actuation is the turn phase's,
    // which is what keeps the forced path and the earned path identical.
    const claimed = await crises.updateOne(
      { _id: live._id, status: { $in: ["open", "frozen"] } },
      {
        $set: {
          status: "resolved",
          outcome: body.outcome,
          resolvedTurn: currentTurn,
          cooldownUntilTurn: null,
          updatedAt: new Date(),
        },
      }
    );
    if (claimed.matchedCount !== 1) {
      return NextResponse.json({ error: "The crisis closed before this landed." }, { status: 409 });
    }
    return NextResponse.json({
      success: true,
      outcome: body.outcome,
      note: "Actuation runs on the next turn tick.",
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
