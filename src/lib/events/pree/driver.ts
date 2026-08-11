import type { Db } from "mongodb";
import type { Character } from "@/lib/db/types/character";
import "@/lib/events/pree/index";
import type { EventDefinition } from "@/lib/db/types/events";
import { processLotteryAnnuities } from "./annuity";
import { getEventCooldownLedgerCollection } from "@/lib/db/collections/eventCooldownLedger";
import { getEventDefinitionsCollection } from "@/lib/db/collections/eventDefinitions";
import { getEventInstancesCollection } from "@/lib/db/collections/eventInstances";
import { isPlayerRandomEventsEnabled } from "@/lib/events/featureFlag";
import {
  ActiveEventConflictError,
  computeExpiresAtRealtimeMs,
  computeExpiresAtTurn,
  offerEvent,
} from "@/lib/events/substrate/offer";
import { getEventHandler } from "@/lib/events/substrate/registry";
import { pickWeightedIndex, seededRoll } from "@/lib/events/substrate/rng";
import { sweepExpired } from "@/lib/events/substrate/sweep";
import type { ResolveEventHooks } from "@/lib/events/substrate/types";
import { isCharacterEligibleForOffer } from "@/lib/events/substrate/cooldown";
import { filterEligibleTemplates } from "./weighting";
import type { CharacterEventContext } from "./eligibility";
import { matchesEligibility } from "./eligibility";
import {
  broadcastMatchesCharacter,
  findDueBroadcast,
  loadBroadcastLedger,
  markBroadcastFired,
  supersedePendingEventForBroadcast,
} from "./broadcast";
import { notifyPlayerEventOffered, notifyPlayerEventResolved } from "./notifications";
import { processDebateChallenges } from "@/lib/debate/processDebateChallenges";
import { sweepExpiredDebates } from "@/lib/debate/debateSessionLifecycle";
import { makeSeededRng } from "@/lib/events/substrate/rng";
import { isRpgStatsEnabled } from "@/lib/stats/featureFlag";

/** Eligibility maps are loaded per chunk to bound query sizes; all player characters are processed. */
const CHARACTER_CHUNK_SIZE = 200;

export interface PlayerRandomEventsTurnResult {
  swept: number;
  offered: number;
  skippedOffers: number;
}

interface CharacterEligibilityMaps {
  inElection: Set<string>;
  holdsOffice: Set<string>;
  isCeo: Set<string>;
  /** CEO character ID → ownership fraction (0–1) */
  ceoOwnershipFraction: Map<string, number>;
}

async function loadApprovedDefinitions(db: Db): Promise<EventDefinition[]> {
  return getEventDefinitionsCollection(db).find({ status: "approved" }).toArray();
}

async function loadEligibilityMaps(
  db: Db,
  characterIds: Character["_id"][]
): Promise<CharacterEligibilityMaps> {
  if (characterIds.length === 0) {
    return {
      inElection: new Set(),
      holdsOffice: new Set(),
      isCeo: new Set(),
      ceoOwnershipFraction: new Map(),
    };
  }

  const [candidacies, officials, ceoCorps] = await Promise.all([
    db
      .collection("electionCandidates")
      .find({ characterId: { $in: characterIds }, status: "active" })
      .project({ characterId: 1 })
      .toArray(),
    db
      .collection("electedOfficials")
      .find({ characterId: { $in: characterIds } })
      .project({ characterId: 1 })
      .toArray(),
    db
      .collection("corporations")
      .find({ ceoId: { $in: characterIds } })
      .project({ ceoId: 1, totalShares: 1, shareholders: 1 })
      .toArray(),
  ]);

  const ceoOwnershipFraction = new Map<string, number>();
  for (const corp of ceoCorps) {
    const ceoIdStr = (corp.ceoId as { toString(): string }).toString();
    const totalShares: number = (corp.totalShares as number) ?? 0;
    if (totalShares <= 0) continue;
    const shareholders =
      (corp.shareholders as Array<{ characterId?: { toString(): string }; shares: number }>) ?? [];
    const ceoEntry = shareholders.find((s) => s.characterId?.toString() === ceoIdStr);
    const ceoShares: number = ceoEntry?.shares ?? 0;
    ceoOwnershipFraction.set(ceoIdStr, ceoShares / totalShares);
  }

  return {
    inElection: new Set(
      candidacies.map((c) => (c.characterId as { toString(): string }).toString())
    ),
    holdsOffice: new Set(
      officials.map((o) => (o.characterId as { toString(): string }).toString())
    ),
    isCeo: new Set(ceoCorps.map((c) => (c.ceoId as { toString(): string }).toString())),
    ceoOwnershipFraction,
  };
}

function buildCharacterContext(
  character: Character,
  maps: CharacterEligibilityMaps
): CharacterEventContext {
  const id = character._id.toString();
  const isInElection = maps.inElection.has(id);
  const holdsOffice = maps.holdsOffice.has(id);
  return {
    characterId: character._id,
    countryId: character.countryId,
    isInElection,
    isPolitician: holdsOffice || isInElection,
    isCeo: maps.isCeo.has(id),
    ceoOwnershipFraction: maps.ceoOwnershipFraction.get(id),
  };
}

function buildResolveHooks(
  userIdByCharacterId: Map<string, Character["userId"]>
): ResolveEventHooks {
  return {
    onResolved: async (instance, ctx) => {
      const userId = userIdByCharacterId.get(instance.scopeId.toString());
      if (!userId) {
        return;
      }
      await notifyPlayerEventResolved(userId, instance, ctx);
    },
  };
}

/**
 * Sweep expired instances, notifying each instance's owner. Loads the
 * owning characters before sweeping so timeout notifications always have a
 * userId to target (turn phase and cron share this path).
 */
async function sweepExpiredWithNotifications(
  db: Db,
  currentTurn: number
): Promise<ReturnType<typeof sweepExpired>> {
  const userIdByCharacterId = new Map<string, Character["userId"]>();
  const resolveHooks = buildResolveHooks(userIdByCharacterId);

  const pending = await getEventInstancesCollection(db)
    .find({
      status: "pending",
      $or: [
        { expiresAtRealtimeMs: { $lte: Date.now() } },
        { expiresAtTurn: { $lte: currentTurn } },
      ],
    })
    .toArray();

  if (pending.length > 0) {
    const chars = await db
      .collection<Character>("characters")
      .find({ _id: { $in: pending.map((p) => p.scopeId) } })
      .project({ _id: 1, userId: 1 })
      .toArray();
    for (const c of chars) {
      userIdByCharacterId.set(c._id.toString(), c.userId);
    }
  }

  return sweepExpired(db, currentTurn, Date.now(), resolveHooks);
}

/**
 * Per-turn PREE driver: sweep expired instances, then optionally offer one
 * event per eligible character when the feature flag is on.
 */
export async function processPlayerRandomEventsTurn(
  db: Db,
  currentTurn: number,
  preloaded?: {
    playerRandomEventsEnabled?: boolean;
    rpgStatsEnabled?: boolean;
    /** In-game year for era gating (minYear/maxYear on definitions). Omit = no era filtering. */
    currentYear?: number;
  }
): Promise<PlayerRandomEventsTurnResult> {
  await processLotteryAnnuities(db);
  const sweepResult = await sweepExpiredWithNotifications(db, currentTurn);

  const offersEnabled = await isPlayerRandomEventsEnabled(preloaded);
  if (!offersEnabled) {
    return { swept: sweepResult.swept.length, offered: 0, skippedOffers: 0 };
  }

  // Election debates: roll challenges and resolve overdue debates before offering
  // normal events. Participants are excluded from the offer loop so a debate can
  // never collide with a standard random event (the "supersede" rule). Gated
  // behind the RPG-stats flag.
  const debateParticipants = (await isRpgStatsEnabled(preloaded))
    ? (await processDebateChallenges(db, currentTurn, new Date())).participantCharacterIds
    : new Set<string>();

  const definitions = await loadApprovedDefinitions(db);
  if (definitions.length === 0) {
    return { swept: sweepResult.swept.length, offered: 0, skippedOffers: 0 };
  }

  // Broadcast events (moon landing, Wall falls, …): when the in-game year
  // enters a broadcast definition's window, it is offered to EVERY matching
  // character this turn instead of the per-character weighted pick. Fires at
  // most once per world; at most one broadcast per turn.
  let broadcastDef: EventDefinition | null = null;
  if (preloaded?.currentYear != null) {
    const broadcastLedger = await loadBroadcastLedger(db);
    broadcastDef = findDueBroadcast(definitions, broadcastLedger, preloaded.currentYear);
    if (broadcastDef) {
      await markBroadcastFired(db, broadcastDef.kind, currentTurn);
    }
  }

  let offered = 0;
  let skippedOffers = 0;

  // Walk every player character in chunks — a hard cap here would silently
  // exclude everyone past the cap from ever receiving events.
  const cursor = db
    .collection<Character>("characters")
    .find({ userId: { $exists: true } })
    .batchSize(CHARACTER_CHUNK_SIZE);

  let chunk: Character[] = [];
  const processChunk = async () => {
    if (chunk.length === 0) {
      return;
    }
    const maps = await loadEligibilityMaps(
      db,
      chunk.map((c) => c._id)
    );
    for (const character of chunk) {
      // A character locked into an election debate this pass doesn't also get a
      // standard event (debate supersedes).
      if (debateParticipants.has(character._id.toString())) {
        skippedOffers++;
        continue;
      }
      const result = await offerEventToCharacter(
        db,
        character,
        currentTurn,
        definitions,
        maps,
        preloaded?.currentYear,
        broadcastDef
      );
      if (result === "offered") {
        offered++;
      } else {
        skippedOffers++;
      }
    }
    chunk = [];
  };

  for await (const character of cursor) {
    chunk.push(character);
    if (chunk.length >= CHARACTER_CHUNK_SIZE) {
      await processChunk();
    }
  }
  await processChunk();

  return { swept: sweepResult.swept.length, offered, skippedOffers };
}

async function offerEventToCharacter(
  db: Db,
  character: Character,
  currentTurn: number,
  definitions: EventDefinition[],
  maps: CharacterEligibilityMaps,
  currentYear?: number,
  broadcastDef?: EventDefinition | null
): Promise<"offered" | "skipped"> {
  const pendingInstance = await getEventInstancesCollection(db).findOne({
    scope: "character",
    scopeId: character._id,
    status: "pending",
  });

  const ledger = await getEventCooldownLedgerCollection(db).findOne({
    scope: "character",
    scopeId: character._id,
  });

  const characterCtx = buildCharacterContext(character, maps);

  // A firing broadcast supersedes the normal flow for every character it
  // reaches (country match + eligibility), and bypasses the global spacing
  // cooldown — a once-per-world moment shouldn't skip people for recently
  // having had an event. A pending event doesn't block it either: it is
  // superseded (auto-resolved on its default option) so the moment lands.
  const useBroadcast =
    broadcastDef != null &&
    broadcastMatchesCharacter(broadcastDef, characterCtx) &&
    matchesEligibility(characterCtx, broadcastDef.eligibility) &&
    !(
      broadcastDef.excludeEligibility &&
      broadcastDef.excludeEligibility.length > 0 &&
      matchesEligibility(characterCtx, broadcastDef.excludeEligibility)
    );

  if (pendingInstance) {
    if (!useBroadcast) {
      return "skipped";
    }
    const cleared = await supersedePendingEventForBroadcast(db, pendingInstance, currentTurn);
    if (!cleared) {
      return "skipped";
    }
  }

  if (!useBroadcast && !isCharacterEligibleForOffer(ledger, currentTurn)) {
    return "skipped";
  }

  let pickedDefinition: EventDefinition;
  if (useBroadcast) {
    pickedDefinition = broadcastDef;
  } else {
    const eligible = filterEligibleTemplates(
      definitions,
      characterCtx,
      ledger,
      currentTurn,
      currentYear
    );
    if (eligible.length === 0) {
      return "skipped";
    }
    const offerRoll = seededRoll(character._id.toHexString(), currentTurn, "pree", "offer");
    pickedDefinition = eligible[pickWeightedIndex(eligible, offerRoll)].definition;
  }

  const handler = getEventHandler(pickedDefinition.kind);
  if (!handler) {
    return "skipped";
  }

  const outcomeRoll = seededRoll(
    character._id.toHexString(),
    currentTurn,
    pickedDefinition.kind,
    "outcome"
  );
  const rawPayload = handler.buildPayload
    ? await handler.buildPayload({ db, character, currentTurn, definition: pickedDefinition })
    : {};

  if (rawPayload === null) {
    return "skipped";
  }
  const payload = rawPayload;

  let instance;
  try {
    instance = await offerEvent(db, {
      kind: pickedDefinition.kind,
      scope: "character",
      scopeId: character._id,
      definitionVersion: pickedDefinition.version,
      roll: outcomeRoll,
      payload,
      offeredAtTurn: currentTurn,
      expiresAtRealtimeMs: computeExpiresAtRealtimeMs(),
      // Turn-based companion window. Without it a headless run never expires
      // anything (24h wall-clock never elapses across a fast sim), so the first
      // offer holds the character's only pending slot for the whole run.
      expiresAtTurn: computeExpiresAtTurn(currentTurn),
    });
  } catch (error) {
    // Lost a race for the pending slot (e.g. a superseded event resolved
    // concurrently, or another producer offered first) — skip, not fatal.
    if (error instanceof ActiveEventConflictError) {
      return "skipped";
    }
    throw error;
  }

  await notifyPlayerEventOffered(character.userId, pickedDefinition, instance);
  return "offered";
}

/** Realtime sweep for cron — resolves expired instances without offering new events. */
export async function sweepPlayerRandomEventsRealtime(
  db: Db,
  currentTurn: number
): Promise<number> {
  const result = await sweepExpiredWithNotifications(db, currentTurn);
  // Also auto-resolve debates whose strategy-pick deadline has passed.
  await sweepExpiredDebates(db, new Date(), makeSeededRng(`debate-sweep-rt:${currentTurn}`));
  return result.swept.length;
}
