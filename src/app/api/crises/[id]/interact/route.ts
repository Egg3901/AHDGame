import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, isUnexpectedError } from "@/lib/api/errors";
import {
  submitCrisisDecision,
  resolveCharacterRoles,
  getCrisisInteraction,
} from "@/lib/crises/interactionEngine";
import { isCrisisInteractionEnabled, isCrisisAidBillsEnabled } from "@/lib/crises/featureFlag";
import { submitCrisisAidPledge } from "@/lib/crises/aidPledge";
import type { CountryId } from "@/lib/constants/countries";
import { ObjectId } from "mongodb";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    // Feature gate: reject if crisis interaction system is disabled
    const enabled = await isCrisisInteractionEnabled();
    if (!enabled) {
      return NextResponse.json({ error: "Crisis interactions are not enabled" }, { status: 403 });
    }

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid crisis interaction ID" }, { status: 400 });
    }

    const body = await _req.json();
    const { optionId } = body;

    const db = await getDb();
    const character = user.character;

    if (!character.countryId) {
      return NextResponse.json(
        { error: "Character has no country and cannot interact with crises" },
        { status: 400 }
      );
    }

    const characterRoles = await resolveCharacterRoles(db, character);

    // The route param is the crisis ID; resolve its interaction document.
    const interaction = await getCrisisInteraction(db, new ObjectId(id));
    if (!interaction) {
      return NextResponse.json({ error: "No active interaction for this crisis" }, { status: 404 });
    }

    // Aid nodes: route to the pledge command (pctGdp) or decline (decline: true).
    // Non-aid nodes fall through to the normal submitCrisisDecision path below.
    const currentNode = interaction.decisionTree.find(
      (n) => n.nodeId === interaction.currentNodeId
    );
    if (currentNode?.type === "aid") {
      if (!(await isCrisisAidBillsEnabled())) {
        return NextResponse.json({ error: "Aid bills are not enabled" }, { status: 403 });
      }
      // Decline: advance via the normal engine path using the provided optionId.
      if (body.decline === true) {
        if (!optionId) {
          return NextResponse.json({ error: "optionId required to decline aid" }, { status: 400 });
        }
        let declined;
        try {
          declined = await submitCrisisDecision(
            db,
            interaction._id,
            optionId,
            character._id,
            character.countryId,
            characterRoles
          );
        } catch (err) {
          if (isUnexpectedError(err)) {
            return handleRouteError(err, {
              request: _req,
              route: "/api/crises/[id]/interact",
              extra: { crisisId: id, optionId, decline: true },
            });
          }
          return NextResponse.json(
            { error: err instanceof Error ? err.message : "Decision failed" },
            { status: 400 }
          );
        }
        return NextResponse.json({
          success: true,
          interaction: declined.interaction,
          nextNode: declined.nextNode,
          appliedEffects: declined.appliedEffects,
        });
      }
      // Pledge: validate pctGdp and route to the aid-pledge command.
      const pctGdp = Number(body.pctGdp);
      if (!Number.isFinite(pctGdp) || pctGdp <= 0) {
        return NextResponse.json({ error: "pctGdp required for aid pledge" }, { status: 400 });
      }
      const pledge = await submitCrisisAidPledge(db, {
        interactionId: interaction._id,
        nodeId: currentNode.nodeId,
        pctGdp,
        characterId: character._id,
        characterName: character.name,
        senderCountryId: character.countryId as CountryId,
        characterParty: character.party ?? undefined,
        characterRoles,
      });
      return NextResponse.json({
        success: true,
        pledged: true,
        billId: pledge.billId.toString(),
        impact: pledge.impact,
      });
    }

    // Standard decision node: optionId is required.
    if (!optionId) {
      return NextResponse.json({ error: "optionId required" }, { status: 400 });
    }

    let result;
    try {
      result = await submitCrisisDecision(
        db,
        interaction._id,
        optionId,
        character._id,
        character.countryId,
        characterRoles
      );
    } catch (err) {
      // The engine's plain `Error`s are authored player-facing rejections
      // (invalid option, not authorized, insufficient funds, national
      // capacity, already responded). They must reach the player as a 400
      // with the reason, not as a 500 "Internal server error". Genuine
      // infra/programming faults keep the handleRouteError capture path.
      if (isUnexpectedError(err)) {
        return handleRouteError(err, {
          request: _req,
          route: "/api/crises/[id]/interact",
          extra: { crisisId: id, optionId },
        });
      }
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Decision failed" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      interaction: result.interaction,
      nextNode: result.nextNode,
      appliedEffects: result.appliedEffects,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
