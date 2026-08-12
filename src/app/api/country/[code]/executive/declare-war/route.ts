// POST /api/country/[code]/executive/declare-war
// The executive introduces a declaration of war; the chambers then ratify it at a
// two-thirds bar (see billPassRule). Auth: head of government or defence seat.
// Errors: 400, 401, 403, 404, 409.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { z } from "zod";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import { validateDeclareWar } from "@/lib/military/validateDeclareWar";
import { warGoalLabel, type WarGoal } from "@/lib/military/warGoals";
import type { Bill } from "@/lib/db/types/legislation";
import type { Character } from "@/lib/db/types";
import { BILL_PROPOSE_ACTION_COST } from "@shared/constants/legislation";

const bodySchema = z.object({
  targetCountry: z.string().min(2).max(3),
  warGoal: z.string().min(1),
});

/** Matches the cabinet-bill voting window; a declaration is not a rush job. */
const VOTE_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * A declaration is its own executive act, not a "cabinet bill".
 *
 * It deliberately does NOT reuse the cabinet-bills route: that route is gated behind
 * `cabinetBillsEnabled`, which is set for Japan alone, so routing declarations
 * through it would have meant only Japan could declare war. It equally cannot use
 * the ordinary bill-proposal path, which requires a seated legislator and would have
 * locked out every presidential executive.
 */
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const { character } = auth.user;

    const db = await getDb();
    const gs = await (
      await getGameStateCollection(db)
    ).findOne({ _id: "current" }, { projection: { conflictsEnabled: 1, currentTurn: 1 } });
    if (!gs?.conflictsEnabled) {
      return NextResponse.json({ error: "Conflicts subsystem disabled" }, { status: 404 });
    }

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const targetCountry = parsed.data.targetCountry.toUpperCase();

    // Only the executive takes the country to war; the chambers then ratify.
    //
    // Resolved through the shared helper because it branches on the RUNTIME
    // government type. `governmentFormations.pmCharacterId` is the PARLIAMENTARY
    // path only — a presidential leader is a row in `electedOfficials` with
    // officeType "president". Reading pmCharacterId directly locked the US
    // President out of declaring war entirely, leaving only the defence seat: the
    // exact failure this spec set out to avoid.
    const hog = await getHeadOfGovernmentCharacterId(db, countryId);
    const isHog = !!hog && hog.toString() === character._id.toString();
    const defenceSeat = DEFENSE_POSITION_BY_COUNTRY[countryId];
    const isDefence =
      !!defenceSeat &&
      !!(await db
        .collection("cabinetMembers")
        .findOne({ countryId, positionId: defenceSeat, characterId: character._id }));
    if (!auth.user.isAdmin && !isHog && !isDefence) {
      return NextResponse.json(
        { error: "Only the head of government or the defence minister may declare war." },
        { status: 403 }
      );
    }

    const currentTurn = gs.currentTurn ?? 0;
    const check = await validateDeclareWar(
      db,
      { targetCountry, warGoal: parsed.data.warGoal },
      countryId,
      currentTurn
    );
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    // One live declaration at a time, so a chamber is never asked to ratify two
    // wars against the same country at once.
    const existing = await db.collection<Bill>("bills").findOne({
      countryId,
      status: { $in: ["proposed", "active", "passed_origin", "active_other", "active_both"] },
      "provisions.type": "declare_war",
      "provisions.targetCountry": targetCountry,
    });
    if (existing) {
      return NextResponse.json(
        { error: "A declaration against that country is already before the legislature." },
        { status: 409 }
      );
    }

    // The same stake any other bill proposal puts up, charged only once every check
    // above has passed so a refused declaration is free. `billEnactment` refunds it
    // from `proposalActionCost` if the chambers actually pass the thing.
    const actionCost = BILL_PROPOSE_ACTION_COST;
    if (!auth.user.isAdmin) {
      // Re-read rather than trusting `auth.user.character`, which is a snapshot taken
      // at the top of the request and may have been spent down since.
      const fresh = await db
        .collection<Character>("characters")
        .findOne({ _id: character._id }, { projection: { actions: 1 } });
      const currentActions = fresh?.actions ?? 0;
      if (currentActions < actionCost) {
        return NextResponse.json(
          {
            error: `Proposing a bill costs ${actionCost} action points (you have ${currentActions}).`,
          },
          { status: 400 }
        );
      }
      // Conditional $inc, not read-then-write: two declarations submitted at once
      // would both clear the check above and both spend the same points.
      const spend = await db
        .collection<Character>("characters")
        .updateOne(
          { _id: character._id, actions: { $gte: actionCost } },
          { $inc: { actions: -actionCost }, $set: { updatedAt: new Date() } }
        );
      if (spend.modifiedCount === 0) {
        return NextResponse.json(
          { error: "Your actions changed. Please try again." },
          { status: 409 }
        );
      }
    }

    const config = getCountryConfig(countryId);
    const now = new Date();
    const goal = parsed.data.warGoal as WarGoal;
    const targetName = COUNTRY_CONFIGS[targetCountry as CountryId]?.name ?? targetCountry;

    const bill: Omit<Bill, "_id"> = {
      title: `Declaration of War against ${targetName}`,
      summary: `A declaration of war against ${targetName}. Stated aim: ${warGoalLabel(goal)}.`,
      fullText: "",
      category: "foreign_policy",
      provisions: [
        { type: "declare_war", targetCountry: targetCountry as CountryId, warGoal: goal },
      ],
      originChamber: config.legislature.lowerChamber.key,
      currentChamber: config.legislature.lowerChamber.key,
      countryId,
      status: "active",
      effectDirection: 0,
      sponsorId: character._id,
      sponsorName: character.name,
      sponsorParty: character.party?.toString(),
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      votingStartedAt: now,
      votingEndsAt: new Date(now.getTime() + VOTE_DURATION_MS),
      proposedAt: now,
      // Stamped so the cooldown counts turns rather than inferring them from a date.
      proposedTurn: currentTurn,
      // What `billEnactment` refunds on passage. Omitted for admins, who paid nothing.
      ...(!auth.user.isAdmin ? { proposalActionCost: actionCost } : {}),
      createdAt: now,
      updatedAt: now,
    } as Omit<Bill, "_id">;

    // Hand the points back if the insert fails — the points were spent to file a bill
    // that now does not exist, and nothing downstream would ever refund them.
    let result;
    try {
      result = await db.collection<Bill>("bills").insertOne(bill as Bill);
    } catch (error) {
      if (!auth.user.isAdmin) {
        await db
          .collection<Character>("characters")
          .updateOne(
            { _id: character._id },
            { $inc: { actions: actionCost }, $set: { updatedAt: new Date() } }
          );
      }
      throw error;
    }
    return NextResponse.json({
      success: true,
      billId: result.insertedId.toString(),
      votingEndsAt: bill.votingEndsAt,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
