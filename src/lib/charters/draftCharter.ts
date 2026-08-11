import type { Db, ObjectId } from "mongodb";
import { ObjectId as ObjectIdCtor } from "mongodb";
import type {
  Character,
  FoundingCohortPick,
  PartyCharter,
  PartyCharterPlatform,
  PoliticalParty,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { clampPlatform } from "./overtonGuardrails";
import { computeCharterDeadline, computeCharterDeadlineTurn } from "./charterDeadlines";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import { adjacentStates } from "@/lib/constants/stateAdjacency";
import { politicalParties as usParties } from "@/lib/seeds/reference/politicalParties";
import { ukParties } from "@/lib/seeds/uk/ukParties";
import { deParties } from "@/lib/seeds/de/deParties";
import { jpParties } from "@/lib/seeds/jp/jpParties";

/**
 * Names + abbreviations reserved for preset-gated default parties (e.g.
 * "Ulster Unionist Party" / UUP, "Partei des Demokratischen Sozialismus"
 * / PDS, "Reform UK" / RUK). Even when the gated default isn't currently
 * seeded for the active preset, the name is held back so a player can't
 * mint a custom party that would collide with the default on a future
 * preset switch (which would otherwise create a duplicate-name row when
 * `ensureDefaultParties` runs).
 */
const PRESET_RESERVED_DEFAULTS: ReadonlyArray<{
  countryId: string;
  name: string;
  abbreviation: string;
}> = [...usParties, ...ukParties, ...deParties, ...jpParties]
  .filter((seed) => seed.validForPresets)
  .map((seed) => ({
    countryId: seed.countryId,
    name: seed.name,
    abbreviation: seed.abbreviation,
  }));

/**
 * Phase 6 — create a new charter draft.
 *
 * Input is the new third party's metadata + 3 founder characterIds (humans
 * only — each character must have an owning `userId`; NPPs live in a
 * separate collection and never qualify per D3). The draft starts in
 * `pending-signatures` — ready for the listed founders to sign / reject.
 * The character that matches `proposedBy` is treated as the proposer and
 * implicitly auto-signs at draft creation.
 *
 * Founder identity moved from `userId` to `characterId` so a single user
 * can hold multiple founder slots through different characters (multi-
 * character accounts, admin testing). The Phase 6 D3 unique-founder rule
 * is now a unique-character rule, which is strictly equal in production
 * (one character per user per country in normal play) and strictly more
 * permissive for multi-persona play.
 *
 * Idempotency: caller (the API route) is responsible for not double-
 * submitting. This command always creates a new charter row.
 *
 * See plan §"Phase 6 — Tasks" 6.2 and §D6.
 */
export interface DraftCharterInput {
  countryId: CountryId;
  proposedName: string;
  proposedAbbr: string;
  /** Exactly 3 unique founder characterIds. */
  foundersCharacterIds: ObjectId[];
  /** Initial platform; clamped to Overton bounds at insertion. */
  platform: PartyCharterPlatform;
  /** CharacterId of the player creating the draft. Must be in `foundersCharacterIds`. */
  proposedBy: ObjectId;
  /**
   * F4 founding-cohort picks set by the chair. Optional — absent
   * triggers legacy 5-in-home-state behavior at ratification. Each
   * pick's stateId is validated against
   * `[proposerHomeState, ...adjacentStates(country, proposerHomeState)]`
   * and rejected otherwise.
   */
  foundingCohort?: [FoundingCohortPick, FoundingCohortPick];
  now?: Date;
  /** Override the current game turn (tests). Defaults to gameState.currentTurn. */
  currentTurn?: number;
}

export type DraftCharterResult =
  | { ok: true; charterId: ObjectId }
  | {
      ok: false;
      reason:
        | "founders-not-3"
        | "founders-not-unique"
        | "proposer-not-founder"
        | "founder-not-found"
        | "founder-wrong-country"
        | "founder-not-human"
        | "founder-not-adjacent"
        | "name-taken"
        | "abbreviation-taken"
        | "cohort-state-not-adjacent";
    };

export async function draftCharter(input: DraftCharterInput, db: Db): Promise<DraftCharterResult> {
  const founders = input.foundersCharacterIds;
  if (founders.length !== 3) return { ok: false, reason: "founders-not-3" };
  const seen = new Set<string>();
  for (const cid of founders) {
    const key = cid.toString();
    if (seen.has(key)) return { ok: false, reason: "founders-not-unique" };
    seen.add(key);
  }
  if (!founders.some((c) => c.equals(input.proposedBy))) {
    return { ok: false, reason: "proposer-not-founder" };
  }

  // Phase 6 closeout — every founder character must exist, be owned by a
  // real `userId` (humans only), and belong to the charter's country.
  // Also load `homeState` so founder adjacency and the F4 founding-cohort
  // picks can be validated against the proposer's adjacency.
  const founderCharacters = await db
    .collection<Character>("characters")
    .find({ _id: { $in: founders } })
    .project<{
      _id: ObjectId;
      userId: ObjectId | null | undefined;
      countryId: string;
      homeState: string;
    }>({
      _id: 1,
      userId: 1,
      countryId: 1,
      homeState: 1,
    })
    .toArray();
  const foundIds = new Set(founderCharacters.map((c) => c._id.toString()));
  for (const cid of founders) {
    if (!foundIds.has(cid.toString())) return { ok: false, reason: "founder-not-found" };
  }
  if (founderCharacters.some((c) => !c.userId)) {
    return { ok: false, reason: "founder-not-human" };
  }
  if (founderCharacters.some((c) => c.countryId !== input.countryId)) {
    return { ok: false, reason: "founder-wrong-country" };
  }

  // Founder adjacency (2026-07-22): every co-founder must live in the
  // proposer's home state or a state adjacent to it — the party's founding
  // trio is geographically anchored the same way the F4 NPP cohort is.
  // Skipped when the proposer has no homeState (legacy seed data), matching
  // the cohort fallback below. A co-founder with no homeState cannot be
  // placed and is rejected.
  const proposer = founderCharacters.find((c) => c._id.equals(input.proposedBy));
  const proposerHomeState = proposer?.homeState || null;
  const allowedFounderStates = proposerHomeState
    ? new Set<string>([proposerHomeState, ...adjacentStates(input.countryId, proposerHomeState)])
    : null;
  if (allowedFounderStates) {
    for (const c of founderCharacters) {
      if (c._id.equals(input.proposedBy)) continue;
      if (!c.homeState || !allowedFounderStates.has(c.homeState)) {
        return { ok: false, reason: "founder-not-adjacent" };
      }
    }
  }

  // Phase 6 closeout fix F3 — uniqueness checks against existing parties
  // AND in-flight charters (any non-terminal status). Prevents two
  // simultaneous drafts from racing to ratify the same name.
  const nameRegex = new RegExp(`^${escapeRegex(input.proposedName)}$`, "i");
  const upperAbbr = input.proposedAbbr.toUpperCase();
  const livePartyConflict = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne(
      { countryId: input.countryId, $or: [{ name: nameRegex }, { abbreviation: upperAbbr }] },
      { projection: { name: 1, abbreviation: 1 } }
    );
  if (livePartyConflict) {
    if (livePartyConflict.abbreviation === upperAbbr) {
      return { ok: false, reason: "abbreviation-taken" };
    }
    return { ok: false, reason: "name-taken" };
  }
  const liveCharterConflict = await db.collection<PartyCharter>("partyCharters").findOne(
    {
      countryId: input.countryId,
      status: { $in: ["draft", "pending-signatures", "founder-replacement"] },
      $or: [{ proposedName: nameRegex }, { proposedAbbr: upperAbbr }],
    },
    { projection: { proposedName: 1, proposedAbbr: 1 } }
  );
  if (liveCharterConflict) {
    if (liveCharterConflict.proposedAbbr === upperAbbr) {
      return { ok: false, reason: "abbreviation-taken" };
    }
    return { ok: false, reason: "name-taken" };
  }

  // Reject names/abbreviations reserved for preset-gated default parties,
  // even when the gated default isn't currently seeded. Prevents the
  // duplicate-name collision that would otherwise occur on a preset switch
  // (when `ensureDefaultParties` re-introduces the gated default).
  const reservedConflict = PRESET_RESERVED_DEFAULTS.find(
    (r) =>
      r.countryId === input.countryId &&
      (r.name.toLowerCase() === input.proposedName.toLowerCase() ||
        r.abbreviation.toUpperCase() === upperAbbr)
  );
  if (reservedConflict) {
    if (reservedConflict.abbreviation.toUpperCase() === upperAbbr) {
      return { ok: false, reason: "abbreviation-taken" };
    }
    return { ok: false, reason: "name-taken" };
  }

  // F4 founding-cohort validation. Each pick's stateId must be either the
  // proposer's home state or an adjacent state (same allowed set as the
  // founder check above). Same-state double-up is allowed (two NPPs in one
  // state). Absent cohort → legacy 5-in-home-state path at ratification,
  // no validation needed. If the proposer has no homeState (legacy seed
  // data), enforcement is skipped — the cohort is stored as-is and
  // ratification applies whatever fallback is appropriate.
  if (input.foundingCohort && allowedFounderStates) {
    for (const pick of input.foundingCohort) {
      if (!allowedFounderStates.has(pick.stateId)) {
        return { ok: false, reason: "cohort-state-not-adjacent" };
      }
    }
  }

  const now = input.now ?? new Date();
  const expiresAt = computeCharterDeadline(now);
  // Turn-based mirror so expiry freezes on pause. Read from gameState when not
  // injected; null when unavailable (legacy/test) → server falls back to the Date.
  const currentTurn =
    input.currentTurn ??
    (
      await db
        .collection<{ _id: string; currentTurn?: number }>("gameState")
        .findOne({ _id: "current" })
    )?.currentTurn ??
    null;
  const expiresOnTurn = currentTurn != null ? computeCharterDeadlineTurn(currentTurn) : null;

  // Auto-sign the proposer's slot at draft creation. Other founders need
  // to explicitly sign / reject via the lifecycle commands.
  const signatures = founders.map((characterId) => {
    if (characterId.equals(input.proposedBy)) {
      return { characterId, signedAt: now };
    }
    return { characterId };
  });

  const charter: PartyCharter = {
    _id: new ObjectIdCtor(),
    countryId: input.countryId,
    partyId: null,
    proposedName: input.proposedName,
    proposedAbbr: input.proposedAbbr.toUpperCase(),
    foundersCharacterIds: founders,
    pendingFounderSlots: 0,
    platform: clampPlatform(input.platform),
    signatures,
    status: "pending-signatures",
    createdAt: now,
    expiresAt,
    expiresOnTurn,
    ...(input.foundingCohort ? { foundingCohort: input.foundingCohort } : {}),
    updatedAt: now,
  };

  await db.collection<PartyCharter>("partyCharters").insertOne(charter);

  // Notify each non-proposer founder that they've been invited. The
  // proposer is already auto-signed, so they don't need a nudge.
  // Notification is non-fatal — `createNotification` swallows errors.
  try {
    const { createNotification } = await import("@/lib/notifications");
    for (const c of founderCharacters) {
      if (c._id.equals(input.proposedBy)) continue;
      if (!c.userId) continue;
      await createNotification({
        userId: c.userId,
        type: "charter_invited",
        title: `You were named as a founder of ${input.proposedName}`,
        message: `Open the charter to sign or reject. All three founders must sign before the party is ratified.`,
        metadata: {
          charterId: charter._id.toString(),
          characterId: c._id.toString(),
          proposedAbbr: input.proposedAbbr.toUpperCase(),
          countryId: input.countryId,
          href: `/charters/${charter._id.toString()}`,
        },
      });
    }
  } catch {
    /* non-fatal */
  }

  return { ok: true, charterId: charter._id };
}
