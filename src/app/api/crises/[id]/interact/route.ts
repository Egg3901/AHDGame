import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
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
      return NextResponse.json({ error: "Crisis interactions are not enabled" }, { status: 403 });
    }

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid crisis interaction ID" }, { status: 400 });
    }

    const parsed = await parseJsonBody(_req, interactSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { optionId, decline } = parsed.data;

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
      if (decline === true) {
        if (!optionId) {
          return NextResponse.json({ error: "optionId required to decline aid" }, { status: 400 });
        }
        const declined = await submitCrisisDecision(
          db,
          interaction._id,
          optionId,
          character._id,
          character.countryId,
          characterRoles,
          character.homeState
        );
        return NextResponse.json({
          success: true,
          interaction: declined.interaction,
          nextNode: declined.nextNode,
          appliedEffects: declined.appliedEffects,
        });
      }
      // Pledge: route to the aid-pledge command (schema already enforces a
      // positive finite number).
      const pctGdp = parsed.data.pctGdp;
      if (pctGdp == null) {
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

    const result = await submitCrisisDecision(
      db,
      interaction._id,
      optionId,
      character._id,
      character.countryId,
      characterRoles,
      character.homeState
    );

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
