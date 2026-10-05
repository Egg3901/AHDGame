import { visibleGlobalResponses } from "@/lib/livingConflict/globalResponse";
import { crisisDecisionRegion } from "@/lib/crises/rules/authorization";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import {
  submitCrisisDecision,
  resolveCharacterRoles,
  getCrisisInteraction,
} from "@/lib/crises/interactionEngine";
import { isCrisisInteractionEnabled, isCrisisAidBillsEnabled } from "@/lib/crises/featureFlag";
import { submitCrisisAidPledge } from "@/lib/crises/aidPledge";
import type { CountryId } from "@/lib/constants/countries";
import { ObjectId } from "mongodb";

const interactSchema = z.object({
  optionId: z.string().optional(),
  decline: z.boolean().optional(),
  pctGdp: z.number().positive().optional(),
});

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    // Feature gate: reject if crisis interaction system is disabled
    const enabled = await isCrisisInteractionEnabled();
    if (!enabled) {
      return errorResponse(403, "Crisis interactions are not enabled");
    }

    if (!ObjectId.isValid(id)) {
      return errorResponse(400, "Invalid crisis interaction ID");
    }

    const parsed = await parseJsonBody(_req, interactSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const { optionId, decline } = parsed.data;

    const db = await getDb();
    const character = user.character;

    if (!character.countryId) {
      return errorResponse(400, "Character has no country and cannot interact with crises");
    }

    const characterRoles = await resolveCharacterRoles(db, character);

    // The route param is the crisis ID; resolve its interaction document.
    const interaction = await getCrisisInteraction(db, new ObjectId(id));
    if (!interaction) {
      return errorResponse(404, "No active interaction for this crisis");
    }

    // Aid nodes: route to the pledge command (pctGdp) or decline (decline: true).
    // Non-aid nodes fall through to the normal submitCrisisDecision path below.
    const currentNode = interaction.decisionTree.find(
      (n) => n.nodeId === interaction.currentNodeId
    );
    if (currentNode?.type === "aid") {
      if (!(await isCrisisAidBillsEnabled())) {
        return errorResponse(403, "Aid bills are not enabled");
      }
      // Decline: advance via the normal engine path using the provided optionId.
      if (decline === true) {
        if (!optionId) {
          return errorResponse(400, "optionId required to decline aid");
        }
        const declined = await submitCrisisDecision(
          db,
          interaction._id,
          optionId,
          character._id,
          character.countryId,
          characterRoles,
          crisisDecisionRegion(character)
        );
        return NextResponse.json({
          success: true,
          interaction: {
            ...declined.interaction,
            leaderResponses: visibleGlobalResponses(
              declined.interaction.leaderResponses ?? [],
              character.countryId
            ),
          },
          nextNode: declined.nextNode,
          appliedEffects: declined.appliedEffects,
        });
      }
      // Pledge: route to the aid-pledge command (schema already enforces a
      // positive finite number).
      const pctGdp = parsed.data.pctGdp;
      if (pctGdp == null) {
        return errorResponse(400, "pctGdp required for aid pledge");
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
      return errorResponse(400, "optionId required");
    }

    const result = await submitCrisisDecision(
      db,
      interaction._id,
      optionId,
      character._id,
      character.countryId,
      characterRoles,
      crisisDecisionRegion(character)
    );

    return NextResponse.json({
      success: true,
      interaction: {
        ...result.interaction,
        leaderResponses: visibleGlobalResponses(
          result.interaction.leaderResponses ?? [],
          character.countryId
        ),
      },
      nextNode: result.nextNode,
      appliedEffects: result.appliedEffects,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
