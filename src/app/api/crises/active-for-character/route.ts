import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import {
  getCrisisInteraction,
  canCharacterInteract,
  resolveCharacterRoles,
} from "@/lib/crises/interactionEngine";
import {
  shouldShowCrisisOnActionsPage,
  sanitizeCrisisForActionsPage,
} from "@/lib/crises/actionsPageCrises";
import type { Crisis, CrisisInteraction } from "@/lib/db/types/crisis";
import { isCrisisInteractionEnabled } from "@/lib/crises/featureFlag";
import { conditionalJson } from "@/lib/api/conditionalJson";

export interface ActiveCrisisForCharacter {
  crisis: Crisis;
  interaction: CrisisInteraction | null;
  currentNode: CrisisInteraction["decisionTree"][0] | null;
  canInteract: boolean;
  timeRemainingMinutes: number | null;
  hasContributed: boolean;
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    // Feature gate: return empty if crisis interaction system is disabled
    const enabled = await isCrisisInteractionEnabled();
    if (!enabled) {
      return NextResponse.json({ crises: [] });
    }

    const db = await getDb();

    const character = user.character;
    const countryId = character.countryId;
    const stateId = character.homeState;

    const characterRoles = await resolveCharacterRoles(db, character);

    // Find active crises that affect this character, plus any crisis with a
    // collective-fund node — those are contributable by national leaders
    // worldwide, not just the directly-affected region/country.
    const orClauses: Record<string, unknown>[] = [{ scope: "global" }];
    if (countryId) {
      orClauses.push({ scope: "country", countryIds: countryId });
      orClauses.push({ scope: "region", regionIds: stateId });
    }
    orClauses.push({ "interactionDefinition.decisionTree.type": "collective" });
    const filter: Record<string, unknown> = { status: "active", $or: orClauses };

    const crises = await db.collection<Crisis>("crises").find(filter).toArray();

    // A crisis is "local" to this character when its scope reaches them directly.
    const isLocalCrisis = (crisis: Crisis): boolean => {
      if (crisis.scope === "global") return true;
      if (crisis.scope === "country") return !!countryId && crisis.countryIds.includes(countryId);
      return !!stateId && crisis.regionIds.includes(stateId);
    };

    // Enrich with interaction data
    const enriched: ActiveCrisisForCharacter[] = await Promise.all(
      crises.map(async (crisis: Crisis) => {
        const interaction = crisis.interactionDefinition
          ? await getCrisisInteraction(db, crisis._id)
          : null;

        const currentNode = interaction
          ? (interaction.decisionTree.find((n) => n.nodeId === interaction.currentNodeId) ?? null)
          : null;

        // Multi-responder (global choice) crises: each country's leader answers
        // once. A leader whose country already responded can no longer act, so
        // the prompt drops off their Actions page.
        const multiResponder =
          crisis.scope === "global" && currentNode?.type === "choice" && !!interaction;
        const alreadyResponded =
          multiResponder && countryId
            ? (interaction!.leaderResponses ?? []).some((r) => r.countryId === countryId)
            : false;

        const canInteract =
          currentNode && !interaction?.resolvedAt
            ? canCharacterInteract(currentNode, characterRoles) && !alreadyResponded
            : false;

        const timeRemainingMinutes = interaction?.decisionDeadline
          ? Math.max(0, Math.ceil((interaction.decisionDeadline.getTime() - Date.now()) / 60_000))
          : null;

        const hasContributed = interaction
          ? interaction.contributors.some(
              (c) => c.characterId.toString() === character._id.toString()
            )
          : false;

        return {
          crisis,
          interaction,
          currentNode,
          canInteract,
          timeRemainingMinutes,
          hasContributed,
        };
      })
    );

    const affecting = enriched
      .filter((e) => shouldShowCrisisOnActionsPage(e, isLocalCrisis(e.crisis)))
      .map(sanitizeCrisisForActionsPage);

    // Per-character (filtered by country/home state) — ETag/304 keeps crisis
    // state live per poll while skipping the body when nothing changed.
    return conditionalJson(request, { crises: affecting });
  } catch (err) {
    return handleRouteError(err);
  }
}
