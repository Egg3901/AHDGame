import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import {
  getCrisisInteraction,
  canCharacterInteract,
  resolveCharacterRoles,
  isMultiResponderNode,
} from "@/lib/crises/interactionEngine";
import {
  shouldShowCrisisOnActionsPage,
  sanitizeCrisisForActionsPage,
  compareActionsPageCrises,
} from "@/lib/crises/actionsPageCrises";
import type { Crisis, CrisisInteraction } from "@/lib/db/types/crisis";
import { isCrisisAidBillsEnabled, isCrisisInteractionEnabled } from "@/lib/crises/featureFlag";
import { conditionalJson } from "@/lib/api/conditionalJson";
import {
  globalResponseRoleFor,
  loadCampaignCapability,
  optionAvailabilityForGlobalResponder,
  optionsForGlobalResponder,
  visibleGlobalResponses,
} from "@/lib/livingConflict/globalResponse";
import type { CampaignRequirementResult } from "@/lib/livingConflict/campaign";
import type { CampaignCapabilitySnapshot } from "@/lib/db/types/livingConflictCampaign";

export interface ActiveCrisisForCharacter {
  crisis: Crisis;
  interaction: CrisisInteraction | null;
  currentNode: CrisisInteraction["decisionTree"][0] | null;
  canInteract: boolean;
  timeRemainingMinutes: number | null;
  hasContributed: boolean;
  /**
   * Per-option campaign eligibility for global-response crises, mirroring the
   * crisis detail page's `campaignBrief.optionAvailability`. Null when the
   * crisis is not a global response or the character's country has no role in
   * it. Without this the card offers options the command path must refuse.
   */
  optionAvailability: Record<string, CampaignRequirementResult> | null;
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

    // An interaction keeps the `aid` node type it was promoted to even after
    // crisisAidBillsEnabled is turned off, but the command path then refuses it
    // and the crisis page renders no controls. Do not advertise it as actionable.
    // Read at most once, and only if an aid node actually turns up: this feed is
    // polled by every player once a minute.
    let aidFlagOnce: Promise<boolean> | null = null;
    const aidBillsEnabled = (): Promise<boolean> => (aidFlagOnce ??= isCrisisAidBillsEnabled());

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

    // Every crisis in this response is answered by the same character, so the
    // capability snapshot is identical across all of them. Memoised per country
    // so it is loaded at most once: otherwise each open global response repeats
    // the same budget, approval and militaryUnits reads on a feed every player
    // polls once a minute.
    const capabilityByCountry = new Map<string, Promise<CampaignCapabilitySnapshot>>();
    const responderCapability = (country: string): Promise<CampaignCapabilitySnapshot> => {
      const pending = capabilityByCountry.get(country) ?? loadCampaignCapability(db, country);
      capabilityByCountry.set(country, pending);
      return pending;
    };

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

        const storedCurrentNode = interaction
          ? (interaction.decisionTree.find((n) => n.nodeId === interaction.currentNodeId) ?? null)
          : null;
        const currentNode =
          storedCurrentNode && crisis.globalResponse && countryId
            ? {
                ...storedCurrentNode,
                options: optionsForGlobalResponder(crisis, storedCurrentNode, countryId),
              }
            : storedCurrentNode;

        // Multi-responder (global choice) crises: each country's leader answers
        // once. A leader whose country already responded can no longer act, so
        // the prompt drops off their Actions page.
        const multiResponder = !!currentNode && isMultiResponderNode(crisis, currentNode);
        const alreadyResponded =
          multiResponder && countryId
            ? (interaction!.leaderResponses ?? []).some((r) => r.countryId === countryId)
            : false;

        const canInteract =
          currentNode && !interaction?.resolvedAt
            ? canCharacterInteract(currentNode, characterRoles) &&
              !alreadyResponded &&
              (currentNode.type !== "aid" || (await aidBillsEnabled())) &&
              (!crisis.globalResponse || !!globalResponseRoleFor(crisis, countryId))
            : false;

        const timeRemainingMinutes = interaction?.decisionDeadline
          ? Math.max(0, Math.ceil((interaction.decisionDeadline.getTime() - Date.now()) / 60_000))
          : null;

        const hasContributed = interaction
          ? interaction.contributors.some(
              (c) => c.characterId.toString() === character._id.toString()
            )
          : false;

        // Only worth loading when the card will actually render the buttons.
        const optionAvailability =
          canInteract && currentNode && crisis.globalResponse && countryId
            ? await optionAvailabilityForGlobalResponder(
                db,
                crisis,
                countryId,
                currentNode.options ?? [],
                await responderCapability(countryId)
              )
            : null;

        // Covert campaign choices are redacted from every government but their
        // author until they are exposed. The crisis page does this on its own
        // interaction read; this feed carries the same document and has to
        // agree, or the Actions poll becomes the cheaper way to read the ledger
        // the crisis page hides.
        // Fail closed on a character with no country: there is no viewer nation
        // to compare against, so nothing can be judged theirs to read. The
        // crisis page resolves that case to an empty list too.
        const visibleInteraction =
          interaction && interaction.leaderResponses?.length
            ? {
                ...interaction,
                leaderResponses: countryId
                  ? visibleGlobalResponses(interaction.leaderResponses, countryId)
                  : [],
              }
            : interaction;

        return {
          crisis,
          interaction: visibleInteraction,
          currentNode,
          canInteract,
          timeRemainingMinutes,
          hasContributed,
          optionAvailability,
        };
      })
    );

    const affecting = enriched
      .filter((e) => shouldShowCrisisOnActionsPage(e, isLocalCrisis(e.crisis)))
      .sort(compareActionsPageCrises)
      .map(sanitizeCrisisForActionsPage);

    // Per-character (filtered by country/home state) — ETag/304 keeps crisis
    // state live per poll while skipping the body when nothing changed.
    return conditionalJson(request, { crises: affecting });
  } catch (err) {
    return handleRouteError(err);
  }
}
