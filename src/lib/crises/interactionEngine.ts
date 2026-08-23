import { ObjectId, type Db } from "mongodb";
import type {
  Crisis,
  CrisisEffect,
  CrisisInteraction,
  CrisisDecisionNode,
} from "@/lib/db/types/crisis";
import type { FederalBudget, ElectedOfficial } from "@/lib/db/types";
import {
  getCountryConfig,
  getHeadOfStateOfficeType,
  type CountryId,
} from "@/lib/constants/countries";
import { logWireEvent } from "@/lib/wireEvent";
import { applyCrisisEffects } from "./applyEffects";
import { runCrisisOptionAction, type CrisisActionResult } from "./optionActions";
import { spendFromTreasury } from "@/lib/budget/treasurySpend";
import { isCrisisAidBillsEnabled } from "./featureFlag";
import { AID_MAX_PCT_GDP, AID_DEFAULT_PCT_GDP } from "@/lib/constants/crises";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { getGameState } from "@/lib/gameState";
import {
  globalResponseRoleFor,
  optionsForGlobalResponder,
  resolveGlobalResponse,
  spendGlobalResponseCost,
} from "@/lib/livingConflict/globalResponse";

/** Read a country's national treasury balance (the unified fiscal cash position). */
async function getTreasuryBalance(db: Db, countryId: string): Promise<number> {
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ countryId: countryId as FederalBudget["countryId"] });
  return budget?.treasuryBalance ?? 0;
}

/** Debit `amount` (country-local) from the national treasury. Treasury may go negative. */
async function debitTreasury(db: Db, countryId: string, amount: number): Promise<void> {
  await db
    .collection<FederalBudget>("federalBudget")
    .updateOne(
      { countryId: countryId as FederalBudget["countryId"] },
      { $inc: { treasuryBalance: -amount }, $set: { updatedAt: new Date() } }
    );
}

/**
 * Derive the interaction roles a character holds from their seated office.
 *
 * Shared by every crisis route so the "can this character see the decision"
 * check (active-for-character) and the "can this character submit the decision"
 * check (interact) agree. Office type strings are the canonical `OfficeType`
 * discriminants from `@/lib/db/types/character`.
 */
export function deriveCharacterRoles(office?: { type?: string } | null): string[] {
  const roles = ["any"];
  const type = office?.type;
  // Heads of government / executive decision-makers who can resolve crises.
  // Keep this aligned with the isExecutive head-of-government keys in
  // COUNTRY_CONFIGS (president, primeMinister, chancellor, taoiseach, premier, …).
  if (
    type === "president" ||
    type === "primeMinister" ||
    type === "chancellor" ||
    type === "taoiseach" ||
    type === "premier"
  ) {
    roles.push("headOfState");
  }
  if (
    type === "usCabinet" ||
    type === "ukCabinet" ||
    type === "deCabinet" ||
    type === "parliamentaryCabinet"
  ) {
    roles.push("cabinet");
  }
  if (type === "governor" || type === "ministerPresident") {
    roles.push("stateGovernor");
  }
  return roles;
}

/**
 * Like `deriveCharacterRoles` but also grants `headOfState` to executives whose
 * `currentOffice` is not a head-of-state office type:
 *
 *  - Parliamentary PMs, whose `currentOffice` is their legislative seat
 *    (e.g. `shugiin`), not a `primeMinister` type.
 *  - Ceremonial / office-seated heads of state whose head-of-state role stacks
 *    on top of a primary seat via an `electedOfficials` row rather than
 *    `currentOffice` — e.g. the CN President of the PRC (the CCP chair, seated
 *    by `partyChairHeadOfState`, whose `currentOffice` stays their NPC/party seat) or
 *    the IE Uachtarán. This mirrors the executive route's canonical head-of-state
 *    resolution (`electedOfficials` keyed by the `isHeadOfState` officeType) so
 *    the "who can resolve this crisis" check agrees with who the game shows as
 *    head of state.
 */
export async function resolveCharacterRoles(
  db: Db,
  character: { _id: ObjectId; currentOffice?: { type?: string } | null; countryId?: string }
): Promise<string[]> {
  const roles = deriveCharacterRoles(character.currentOffice);
  if (!roles.includes("headOfState") && character.countryId) {
    const govFormation = await getGovernmentFormationsCollection(db).findOne({
      _id: character.countryId,
      status: "formed",
    });
    if (govFormation?.pmCharacterId?.equals(character._id)) {
      roles.push("headOfState");
    }
  }
  if (!roles.includes("headOfState") && character.countryId) {
    const hosOfficeType = getHeadOfStateOfficeType(
      getCountryConfig(character.countryId as CountryId)
    );
    if (hosOfficeType) {
      const hosRow = await db.collection<ElectedOfficial>("electedOfficials").findOne({
        countryId: character.countryId as CountryId,
        officeType: hosOfficeType,
        characterId: character._id,
      });
      if (hosRow) {
        roles.push("headOfState");
      }
    }
  }
  return roles;
}

/**
 * Resolve a crisis's scope to the affected state IDs and parent countries.
 * Mirrors `resolveScope` in crisisTurn.ts but also returns the deduplicated
 * country list needed for approval effects.
 */
async function resolveCrisisScope(
  db: Db,
  crisis: Crisis
): Promise<{ targetStateIds: string[]; affectedCountries: string[] }> {
  const allStates = await db
    .collection("states")
    .find({})
    .project({ _id: 1, countryId: 1 })
    .toArray();

  const statesByCountry = new Map<string, string[]>();
  const countryByState = new Map<string, string>();
  for (const state of allStates) {
    const existing = statesByCountry.get(state.countryId) ?? [];
    existing.push(state._id);
    statesByCountry.set(state.countryId, existing);
    countryByState.set(state._id, state.countryId);
  }

  if (crisis.scope === "global") {
    return {
      targetStateIds: allStates.map((s) => s._id),
      affectedCountries: [...statesByCountry.keys()],
    };
  }
  if (crisis.scope === "country") {
    return {
      targetStateIds: crisis.countryIds.flatMap((cId) => statesByCountry.get(cId) ?? []),
      affectedCountries: crisis.countryIds,
    };
  }
  // region scope: regionIds are state IDs; derive their parent countries
  const countries = new Set<string>();
  for (const stateId of crisis.regionIds) {
    const countryId = countryByState.get(stateId);
    if (countryId) countries.add(countryId);
  }
  return { targetStateIds: crisis.regionIds, affectedCountries: [...countries] };
}

/** Apply a list of effects against a crisis's resolved scope. No-op for empty lists. */
export async function applyEffectsForCrisis(
  db: Db,
  crisisId: ObjectId,
  effects: CrisisEffect[]
): Promise<void> {
  if (effects.length === 0) return;
  const crisis = await db.collection<Crisis>("crises").findOne({ _id: crisisId });
  if (!crisis) return;
  const { targetStateIds, affectedCountries } = await resolveCrisisScope(db, crisis);

  // Resolve affected characters for stat effects
  const hasStatEffects = effects.some((e) => e.targetType === "stat");
  let affectedCharacterIds: ObjectId[] | undefined;
  if (hasStatEffects) {
    affectedCharacterIds = await resolveAffectedCharacters(
      db,
      crisis,
      targetStateIds,
      affectedCountries
    );
  }

  await applyCrisisEffects(db, effects, targetStateIds, affectedCountries, affectedCharacterIds);
}

/**
 * A multi-responder node is a `choice` node on a global crisis: every affected
 * country's head of state answers for their own nation, so the interaction
 * collects one response per country instead of resolving on the first decision.
 * Country- and region-scoped crises remain single-responder (the first eligible
 * leader's choice resolves the interaction); `aid` and `collective` nodes have
 * their own multi-contributor flows and are not treated as multi-responder here.
 */
export function isMultiResponderNode(
  crisis: Pick<Crisis, "scope" | "countryIds">,
  node: CrisisDecisionNode
): boolean {
  if (node.type !== "choice") return false;
  if (crisis.scope === "global") return true;
  // A country-scoped crisis addressed to MORE THAN ONE nation is also answered
  // per country: the chained Vietnam rungs put the same question to both
  // superpowers, and neither leader's choice may resolve the other's. Ordinary
  // country crises carry exactly one countryId and are untouched by this.
  return crisis.scope === "country" && (crisis.countryIds?.length ?? 0) > 1;
}

/**
 * Apply a list of effects scoped to a SINGLE country (its states + characters),
 * regardless of the crisis's broader scope. Used for per-leader responses so one
 * nation's choice only touches that nation, never the whole globe.
 */
export async function applyEffectsForCountry(
  db: Db,
  countryId: string,
  effects: CrisisEffect[]
): Promise<void> {
  if (effects.length === 0) return;
  const states = await db
    .collection<{ _id: string }>("states")
    .find({ countryId }, { projection: { _id: 1 } })
    .toArray();
  const targetStateIds = states.map((s) => s._id);

  let affectedCharacterIds: ObjectId[] | undefined;
  if (effects.some((e) => e.targetType === "stat")) {
    const chars = await db
      .collection<{ _id: ObjectId }>("characters")
      .find({ "currentOffice.countryId": countryId, retiredAt: null }, { projection: { _id: 1 } })
      .toArray();
    affectedCharacterIds = chars.map((c) => c._id);
  }

  await applyCrisisEffects(db, effects, targetStateIds, [countryId], affectedCharacterIds);
}

/**
 * Resolve which characters are affected by a crisis for stat-loss purposes.
 * - Global: all characters
 * - Country: characters whose currentOffice country matches
 * - Region: characters whose currentOffice stateId matches a regionId
 */
async function resolveAffectedCharacters(
  db: Db,
  crisis: Crisis,
  targetStateIds: string[],
  affectedCountries: string[]
): Promise<ObjectId[]> {
  const filter: Record<string, unknown> = { retiredAt: null };

  if (crisis.scope === "global") {
    // All active characters
  } else if (crisis.scope === "country") {
    filter["currentOffice.countryId"] = { $in: affectedCountries };
  } else if (crisis.scope === "region") {
    filter["currentOffice.stateId"] = { $in: targetStateIds };
  }

  const chars = await db
    .collection<{ _id: ObjectId }>("characters")
    .find(filter, { projection: { _id: 1 } })
    .toArray();

  return chars.map((c) => c._id);
}

/**
 * Finalize a terminal node: apply its outcome effects and emit the outcome wire
 * event. Called whenever an interaction reaches a `terminal` node (via a player
 * decision or an auto-resolution).
 */
async function finalizeTerminalNode(
  db: Db,
  interaction: CrisisInteraction,
  terminalNode: CrisisDecisionNode
): Promise<void> {
  if (terminalNode.outcomeEffects?.length) {
    await applyEffectsForCrisis(db, interaction.crisisId, terminalNode.outcomeEffects);
  }
  await logWireEvent("crisis_outcome", terminalNode.outcomeMessage ?? "Crisis resolved.", {
    href: `/world/crises/${interaction.crisisId.toString()}`,
  });
}

/**
 * Create a CrisisInteraction document when a crisis with interactionDefinition is activated.
 * Called by crisisTurn.ts when a crisis starts and by the admin route at creation time.
 */
export async function createCrisisInteraction(
  db: Db,
  crisis: Crisis
): Promise<CrisisInteraction | null> {
  if (!crisis.interactionDefinition) return null;

  // Guard against double-creation (admin inline + turn processor, or re-runs).
  const existing = await db
    .collection<CrisisInteraction>("crisisInteractions")
    .findOne({ crisisId: crisis._id });
  if (existing) return existing;

  // ── Aid-node transform (flag-gated) ──────────────────────────────────────
  // When crisisAidBillsEnabled is ON, any choice node with an `aid_contribute`
  // option is transformed into an `aid` node so the panel renders the slider
  // flow and the decline path routes through submitCrisisDecision.
  // The template tree is NEVER mutated — we deep-clone before modifying.
  const aidEnabled = await isCrisisAidBillsEnabled();
  let workingTree: CrisisDecisionNode[];
  if (aidEnabled) {
    workingTree = JSON.parse(
      JSON.stringify(crisis.interactionDefinition.decisionTree)
    ) as CrisisDecisionNode[];
    for (const node of workingTree) {
      if (node.type === "choice" && node.options?.some((o) => o.optionId === "aid_contribute")) {
        // Promote to aid node
        node.type = "aid";
        node.requiredRoles = ["headOfState"];
        node.aidMaxPctGdp = AID_MAX_PCT_GDP;
        node.aidDefaultPctGdp = AID_DEFAULT_PCT_GDP;

        // Reorder options: the no-aid/skip option must be first so the panel's
        // "Decline" button and auto-resolve both default to it.
        const skipIdx = node.options!.findIndex((o) => o.optionId === "aid_skip");
        if (skipIdx > 0) {
          const [skipOption] = node.options!.splice(skipIdx, 1);
          node.options!.unshift(skipOption);
        } else if (skipIdx === -1) {
          // Fall back: move the non-aid_contribute option (first non-contribute) to front
          const fallbackIdx = node.options!.findIndex((o) => o.optionId !== "aid_contribute");
          if (fallbackIdx > 0) {
            const [fallbackOption] = node.options!.splice(fallbackIdx, 1);
            node.options!.unshift(fallbackOption);
          }
        }
      }
    }
  } else {
    workingTree = crisis.interactionDefinition.decisionTree;
  }
  // ─────────────────────────────────────────────────────────────────────────

  const now = new Date();
  const firstNode = workingTree[0];
  const deadline = firstNode?.timeLimitMinutes
    ? new Date(now.getTime() + firstNode.timeLimitMinutes * 60_000)
    : null;

  const interaction: CrisisInteraction = {
    _id: new ObjectId(),
    crisisId: crisis._id,
    decisionTree: workingTree,
    currentNodeId: firstNode?.nodeId ?? null,
    collectiveTarget: firstNode?.collectiveTarget ?? null,
    collectiveCurrent: 0,
    contributors: [],
    decisionDeadline: deadline,
    autoResolveOnExpiry: crisis.interactionDefinition.autoResolveOnExpiry,
    resolvedAt: null,
    resolutionPath: [],
    resolutionOutcome: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection<CrisisInteraction>("crisisInteractions").insertOne(interaction);
  return interaction;
}

/**
 * Get the active CrisisInteraction for a crisis, or null if none exists.
 */
export async function getCrisisInteraction(
  db: Db,
  crisisId: ObjectId
): Promise<CrisisInteraction | null> {
  return db.collection<CrisisInteraction>("crisisInteractions").findOne({ crisisId });
}

/**
 * Check if a character has the required role to interact with a node.
 */
export function canCharacterInteract(node: CrisisDecisionNode, characterRoles: string[]): boolean {
  if (node.requiredRoles.includes("any")) return true;
  return node.requiredRoles.some((role) => characterRoles.includes(role));
}

function deadlineForNode(node: CrisisDecisionNode | null): Date | null {
  if (node?.timeLimitMinutes) {
    return new Date(Date.now() + node.timeLimitMinutes * 60_000);
  }
  return null;
}

/**
 * Submit a decision choice for a crisis interaction.
 * Returns the updated interaction and the next node (null once resolved).
 */
export async function submitCrisisDecision(
  db: Db,
  interactionId: ObjectId,
  optionId: string,
  characterId: ObjectId,
  countryId: string,
  characterRoles: string[] = ["any"]
): Promise<{
  interaction: CrisisInteraction;
  nextNode: CrisisDecisionNode | null;
  appliedEffects: CrisisEffect[];
}> {
  const interaction = await db
    .collection<CrisisInteraction>("crisisInteractions")
    .findOne({ _id: interactionId });

  if (!interaction) throw new Error("Crisis interaction not found");
  if (interaction.resolvedAt) throw new Error("Crisis already resolved");

  const currentNode = interaction.decisionTree.find((n) => n.nodeId === interaction.currentNodeId);
  if (!currentNode) throw new Error("No active decision node");

  if (!canCharacterInteract(currentNode, characterRoles)) {
    throw new Error("You are not authorized to make this decision");
  }

  const crisis = await db.collection<Crisis>("crises").findOne({ _id: interaction.crisisId });

  // ── Multi-responder (global) choice nodes: each country's head of state
  //    answers for their own nation. The chosen option's effects are applied
  //    scoped to the responder's country, the response is recorded, and the
  //    interaction stays open on the same node so other leaders can still
  //    respond — it does not resolve on a single decision. ──
  if (crisis && isMultiResponderNode(crisis, currentNode)) {
    const responseOptions = crisis.globalResponse
      ? optionsForGlobalResponder(crisis, currentNode, countryId)
      : (currentNode.options ?? []);
    const option = responseOptions.find((o) => o.optionId === optionId);
    if (!option) throw new Error("Invalid option");

    const already = (interaction.leaderResponses ?? []).some((r) => r.countryId === countryId);
    if (already) throw new Error("Your country has already responded to this crisis");

    if (option.requiredBudget) {
      const treasury = await getTreasuryBalance(db, countryId);
      if (treasury < option.requiredBudget) {
        throw new Error(
          `Insufficient funds. Required: ${option.requiredBudget}, Available: ${treasury}`
        );
      }
    }

    const character = await db
      .collection<{ name?: string }>("characters")
      .findOne({ _id: characterId }, { projection: { name: 1 } });

    const response = {
      countryId,
      characterId,
      characterName: character?.name ?? "Unknown leader",
      nodeId: currentNode.nodeId,
      optionId,
      optionLabel: option.label,
      responseRole: globalResponseRoleFor(crisis, countryId) ?? undefined,
      effects: option.effects,
      responseScores: option.responseScores,
      respondedAt: new Date(),
    };
    interaction.updatedAt = new Date();

    // Claim the country's one response before any money or effects move. The
    // guarded write makes a double-click or concurrent request idempotent.
    const claimed = await db.collection<CrisisInteraction>("crisisInteractions").updateOne(
      {
        _id: interactionId,
        resolvedAt: null,
        "leaderResponses.countryId": { $ne: countryId },
      },
      {
        $push: { leaderResponses: response },
        $set: { updatedAt: interaction.updatedAt },
      }
    );
    if (claimed.modifiedCount === 0) {
      throw new Error("Your country has already responded to this crisis");
    }
    interaction.leaderResponses = [...(interaction.leaderResponses ?? []), response];

    if (option.requiredBudget) {
      await debitTreasury(db, countryId, option.requiredBudget);
    }
    await spendGlobalResponseCost(db, countryId, option);

    if (option.effects.length > 0) {
      await applyEffectsForCountry(db, countryId, option.effects);
    }

    // Multi-responder options get the same real-subsystem action hook as
    // single-responder ones. Without this a per-country choice could only ever
    // nudge metrics, which is precisely the cosmetic-crisis problem the hook
    // exists to solve.
    if (option.action) {
      const gameState = await getGameState(db);
      await runCrisisOptionAction({
        db,
        crisis,
        interaction,
        option,
        characterId,
        countryId,
        currentTurn: gameState?.currentTurn ?? crisis.startTurn,
      });
    }

    return { interaction, nextNode: currentNode, appliedEffects: option.effects };
  }

  // ── Collective nodes: contributions accumulate in place; the node resolves
  //    on its deadline via autoResolveCrisisInteraction, not on each submit. ──
  if (currentNode.type === "collective") {
    const option = currentNode.options?.find((o) => o.optionId === optionId);
    if (!option) throw new Error("Invalid option");

    if (option.collectiveContribution && option.collectiveContribution > 0) {
      const already = interaction.contributors.some(
        (c) => c.characterId.toString() === characterId.toString()
      );
      if (already) throw new Error("You have already contributed to this crisis");

      const treasury = await getTreasuryBalance(db, countryId);
      if (treasury < option.collectiveContribution) {
        throw new Error(
          `Insufficient treasury funds. Required: ${option.collectiveContribution}, Available: ${treasury}`
        );
      }
      await spendFromTreasury(db, countryId, option.collectiveContribution, {
        resyncDerived: true,
      });

      interaction.contributors.push({
        countryId,
        amount: option.collectiveContribution,
        characterId,
        contributedAt: new Date(),
      });
      interaction.collectiveCurrent += option.collectiveContribution;
    }

    if (option.effects.length > 0) {
      await applyEffectsForCrisis(db, interaction.crisisId, option.effects);
    }

    interaction.resolutionPath.push(optionId);
    interaction.updatedAt = new Date();

    await db.collection<CrisisInteraction>("crisisInteractions").updateOne(
      { _id: interactionId },
      {
        $set: {
          collectiveCurrent: interaction.collectiveCurrent,
          contributors: interaction.contributors,
          resolutionPath: interaction.resolutionPath,
          updatedAt: interaction.updatedAt,
        },
      }
    );

    return { interaction, nextNode: currentNode, appliedEffects: option.effects };
  }

  // ── Choice / Aid nodes: select a predefined option ──
  // Aid nodes share the same option-selection and advancement logic as choice
  // nodes. The "Decline / No Aid" path routes here; the pledge path uses a
  // separate command and never calls submitCrisisDecision.
  let appliedEffects: CrisisEffect[] = [];
  let nextNodeId: string | null = null;

  if (currentNode.type === "choice" || currentNode.type === "aid") {
    const option = currentNode.options?.find((o) => o.optionId === optionId);
    if (!option) throw new Error("Invalid option");

    if (option.requiredBudget) {
      const treasury = await getTreasuryBalance(db, countryId);
      if (treasury < option.requiredBudget) {
        throw new Error(
          `Insufficient funds. Required: ${option.requiredBudget}, Available: ${treasury}`
        );
      }
      await debitTreasury(db, countryId, option.requiredBudget);
    }

    if (option.requiredApproval) {
      const approvalDoc = await db
        .collection("governmentApprovals")
        .findOne({ _id: countryId as unknown as import("mongodb").ObjectId });
      const approval = (approvalDoc?.approvalRating as number | undefined) ?? 0;
      if (approval < option.requiredApproval) {
        throw new Error(
          `Insufficient approval. Required: ${option.requiredApproval}, Current: ${approval}`
        );
      }
    }

    appliedEffects = option.effects;
    nextNodeId = option.nextNodeId;
    interaction.resolutionPath.push(optionId);
  } else {
    throw new Error("Current node does not accept choices");
  }

  if (appliedEffects.length > 0) {
    await applyEffectsForCrisis(db, interaction.crisisId, appliedEffects);
  }

  // ── Real-subsystem action hook. Runs after flat effects, before navigation,
  //    so a choice can file a bill / issue a taking / spawn a court case in
  //    addition to nudging metrics. Best-effort (see runCrisisOptionAction). ──
  //    A handler may also redirect the navigation (see `CrisisActionResult`):
  //    a retryable action decides for itself whether the attempt succeeded,
  //    which one static `nextNodeId` on the option cannot express.
  let actionResult: CrisisActionResult = {};
  const chosenOption = currentNode.options?.find((o) => o.optionId === optionId);
  if (crisis && chosenOption?.action) {
    const gameState = await getGameState(db);
    actionResult = await runCrisisOptionAction({
      db,
      crisis,
      interaction,
      option: chosenOption,
      characterId,
      countryId,
      currentTurn: gameState?.currentTurn ?? crisis.startTurn,
    });
  }

  // ── Navigate. Landing on a terminal node applies its outcome and resolves. ──
  //    An action hook that returned its own `nextNodeId` wins: the option's
  //    static target is the "the attempt did not change anything" case, and the
  //    handler names the node when it did.
  const resolvedNextNodeId = actionResult.nextNodeId ?? nextNodeId;
  const nextNode = resolvedNextNodeId
    ? (interaction.decisionTree.find((n) => n.nodeId === resolvedNextNodeId) ?? null)
    : null;

  if (nextNode && nextNode.type !== "terminal") {
    interaction.currentNodeId = nextNode.nodeId;
    interaction.decisionDeadline = deadlineForNode(nextNode);
    // Collective targets live on the collective node, which may not be the
    // tree's first node, so capture it as the interaction enters that node.
    if (nextNode.type === "collective") {
      interaction.collectiveTarget = nextNode.collectiveTarget ?? null;
    }
  } else {
    if (nextNode) {
      await finalizeTerminalNode(db, interaction, nextNode);
      interaction.resolutionPath.push(nextNode.nodeId);
    }
    interaction.currentNodeId = null;
    interaction.decisionDeadline = null;
    interaction.resolvedAt = new Date();
    interaction.resolutionOutcome = "success";
  }

  interaction.updatedAt = new Date();

  await db.collection<CrisisInteraction>("crisisInteractions").updateOne(
    { _id: interactionId },
    {
      $set: {
        currentNodeId: interaction.currentNodeId,
        collectiveTarget: interaction.collectiveTarget,
        decisionDeadline: interaction.decisionDeadline,
        resolvedAt: interaction.resolvedAt,
        resolutionPath: interaction.resolutionPath,
        resolutionOutcome: interaction.resolutionOutcome,
        updatedAt: interaction.updatedAt,
      },
    }
  );

  return { interaction, nextNode: interaction.resolvedAt ? null : nextNode, appliedEffects };
}

/**
 * Auto-resolve a crisis interaction when the deadline expires.
 * Picks the default option ("decline" if available, otherwise the first) and
 * advances along its path, finalizing any terminal node it reaches.
 */
export async function autoResolveCrisisInteraction(db: Db, interactionId: ObjectId): Promise<void> {
  const interaction = await db
    .collection<CrisisInteraction>("crisisInteractions")
    .findOne({ _id: interactionId });

  if (!interaction || interaction.resolvedAt) return;

  const currentNode = interaction.decisionTree.find((n) => n.nodeId === interaction.currentNodeId);
  if (!currentNode) return;

  // Multi-responder (global) nodes self-serve per country: each leader already
  // applied their own effects, and non-responders simply took no action. Closing
  // the interaction must NOT apply a global default — that would re-hit every
  // country, including those that already chose. Just mark it resolved.
  const crisis = await db.collection<Crisis>("crises").findOne({ _id: interaction.crisisId });
  if (crisis && isMultiResponderNode(crisis, currentNode)) {
    if (crisis.globalResponse) {
      await resolveGlobalResponse(db, crisis._id);
      return;
    }
    await db.collection<CrisisInteraction>("crisisInteractions").updateOne(
      { _id: interactionId },
      {
        $set: {
          currentNodeId: null,
          decisionDeadline: null,
          resolvedAt: new Date(),
          resolutionOutcome: "completed",
          updatedAt: new Date(),
        },
      }
    );
    return;
  }

  const defaultOption =
    currentNode.options?.find((o) => o.optionId === "decline") ?? currentNode.options?.[0];

  const resolutionPath = [...interaction.resolutionPath];

  if (defaultOption?.effects.length) {
    await applyEffectsForCrisis(db, interaction.crisisId, defaultOption.effects);
  }
  if (defaultOption) {
    resolutionPath.push(defaultOption.optionId);
  }

  const nextNodeId = defaultOption?.nextNodeId ?? null;
  const nextNode = nextNodeId
    ? (interaction.decisionTree.find((n) => n.nodeId === nextNodeId) ?? null)
    : null;

  // Advance to a non-terminal successor; otherwise finalize and resolve as auto.
  if (nextNode && nextNode.type !== "terminal") {
    await db.collection<CrisisInteraction>("crisisInteractions").updateOne(
      { _id: interactionId },
      {
        $set: {
          currentNodeId: nextNode.nodeId,
          decisionDeadline: deadlineForNode(nextNode),
          resolutionPath,
          updatedAt: new Date(),
        },
      }
    );
    return;
  }

  if (nextNode) {
    await finalizeTerminalNode(db, interaction, nextNode);
    resolutionPath.push(nextNode.nodeId);
  }

  await db.collection<CrisisInteraction>("crisisInteractions").updateOne(
    { _id: interactionId },
    {
      $set: {
        currentNodeId: null,
        decisionDeadline: null,
        resolvedAt: new Date(),
        resolutionOutcome: "auto",
        resolutionPath,
        updatedAt: new Date(),
      },
    }
  );
}

/**
 * Calculate crisis duration reduction based on collective contributions.
 * Returns the number of turns to reduce.
 */
export function calculateCollectiveReduction(
  interaction: CrisisInteraction,
  baseDuration: number
): number {
  if (!interaction.collectiveTarget || interaction.collectiveTarget <= 0) return 0;

  const ratio = Math.min(1, interaction.collectiveCurrent / interaction.collectiveTarget);
  // Full funding = 50% duration reduction
  return Math.floor(baseDuration * ratio * 0.5);
}

/**
 * Get all active crisis interactions that need auto-resolution.
 * Called by the cron/turn processor.
 */
export async function getExpiredInteractions(db: Db): Promise<CrisisInteraction[]> {
  return db
    .collection<CrisisInteraction>("crisisInteractions")
    .find({
      resolvedAt: null,
      decisionDeadline: { $lt: new Date() },
      autoResolveOnExpiry: true,
    })
    .toArray();
}
