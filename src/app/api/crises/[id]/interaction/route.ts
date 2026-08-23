import { NextResponse } from "next/server";
import { conditionalJson } from "@/lib/api/conditionalJson";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import {
  getCrisisInteraction,
  canCharacterInteract,
  resolveCharacterRoles,
  isMultiResponderNode,
} from "@/lib/crises/interactionEngine";
import { isCrisisInteractionEnabled, isCrisisAidBillsEnabled } from "@/lib/crises/featureFlag";
import type { Crisis, CrisisInteraction } from "@/lib/db/types/crisis";
import type { FederalBudget } from "@/lib/db/types/budget";
import { ObjectId } from "mongodb";
import {
  campaignBriefForGlobalResponder,
  globalResponseRoleFor,
  optionsForGlobalResponder,
  visibleGlobalResponses,
} from "@/lib/livingConflict/globalResponse";
import { getGameState } from "@/lib/gameState";

/**
 * GET /api/crises/[id]/interaction
 * Returns the crisis detail + the current character's interaction state.
 * Auth: requireAuthWithCharacter
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const user = auth.user;
    const character = user.character;

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid crisis ID" }, { status: 400 });
    }

    const db = await getDb();
    const crisis = await db.collection<Crisis>("crises").findOne({ _id: new ObjectId(id) });
    if (!crisis) {
      return NextResponse.json({ error: "Crisis not found" }, { status: 404 });
    }

    const characterRoles = await resolveCharacterRoles(db, character);

    // Respect the crisis-interaction feature flag so the detail-page decision
    // panel hides in lockstep with the /actions dashboard card when the system
    // is toggled off (both surfaces gate on the same flag).
    const interactionEnabled = await isCrisisInteractionEnabled();

    // Get interaction if exists (and the system is enabled)
    let interaction: CrisisInteraction | null = null;
    if (interactionEnabled && crisis.interactionDefinition) {
      interaction = await getCrisisInteraction(db, new ObjectId(id));
    }

    const visibleDecisionTree = interactionEnabled
      ? crisis.interactionDefinition?.decisionTree
      : undefined;

    const activeNode = interaction
      ? (interaction.decisionTree.find((n) => n.nodeId === interaction.currentNodeId) ??
        interaction.decisionTree[0])
      : null;

    // Multi-responder (global choice) crises: each country's leader answers once
    // for their own nation. A leader whose country already responded can no longer
    // interact, even though the interaction stays open for the rest.
    const multiResponder =
      !!interaction && !!activeNode && isMultiResponderNode(crisis, activeNode);
    const alreadyResponded =
      multiResponder && !!character.countryId
        ? (interaction!.leaderResponses ?? []).some((r) => r.countryId === character.countryId)
        : false;

    const canInteract =
      crisis.interactionDefinition && interaction && activeNode && !interaction.resolvedAt
        ? canCharacterInteract(activeNode, characterRoles) &&
          !alreadyResponded &&
          (!crisis.globalResponse || !!globalResponseRoleFor(crisis, character.countryId))
        : false;

    const responseRole = character.countryId
      ? globalResponseRoleFor(crisis, character.countryId)
      : null;
    const serializedTree = interaction?.decisionTree.map((node) =>
      node.nodeId === interaction.currentNodeId && crisis.globalResponse && character.countryId
        ? { ...node, options: optionsForGlobalResponder(crisis, node, character.countryId) }
        : node
    );
    const campaignBrief =
      interaction && activeNode && crisis.globalResponse && character.countryId
        ? await campaignBriefForGlobalResponder(
            db,
            crisis,
            character.countryId,
            (await getGameState(db))?.currentTurn ?? crisis.startTurn,
            optionsForGlobalResponder(crisis, activeNode, character.countryId)
          )
        : null;
    const visibleLeaderResponses = character.countryId
      ? visibleGlobalResponses(interaction?.leaderResponses ?? [], character.countryId)
      : [];

    // Aid context: expose sender fiscal fields for the slider UI when the current
    // node is an aid node and the aid-bills feature flag is on.
    let aidContext: {
      senderGdp: number;
      senderTreasuryBalance: number;
      senderCurrencyCode: string;
      alreadyPledged: boolean;
    } | null = null;

    const currentNode = interaction?.decisionTree.find(
      (n) => n.nodeId === interaction.currentNodeId
    );
    if (currentNode?.type === "aid" && (await isCrisisAidBillsEnabled()) && character.countryId) {
      const budget = await db
        .collection<FederalBudget>("federalBudget")
        .findOne({ countryId: character.countryId });
      const senderGdp =
        budget?.gdpSmoothed && budget.gdpSmoothed > 0 ? budget.gdpSmoothed : (budget?.gdp ?? 0);
      const pledged = await db
        .collection("crisisAidCommitments")
        .findOne({ crisisId: new ObjectId(id), senderCountryId: character.countryId });
      aidContext = {
        senderGdp,
        senderTreasuryBalance: budget?.treasuryBalance ?? 0,
        senderCurrencyCode: budget?.currencyCode ?? "USD",
        alreadyPledged: !!pledged,
      };
    }

    // Per-character interaction state — private ETag/304 only, never shared.
    return conditionalJson(request, {
      crisis: {
        ...crisis,
        _id: crisis._id.toString(),
      },
      interaction: interaction
        ? {
            ...interaction,
            decisionTree: serializedTree,
            _id: interaction._id.toString(),
            crisisId: interaction.crisisId.toString(),
            leaderResponses: visibleLeaderResponses.map((r) => ({
              ...r,
              characterId: r.characterId.toString(),
            })),
          }
        : null,
      canInteract,
      multiResponder,
      alreadyResponded,
      characterRoles,
      responseRole,
      campaignBrief,
      visibleDecisionTree,
      aidContext,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
