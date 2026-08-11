/**
 * Constitutional convention state machine.
 *
 * Three phases driven by the regime-escalation per-turn loop:
 *   1. `announced` — leader publicly declares the convention. Sets
 *      `conventionInProgress: true` (freezes Stage-4 dwell), parks a
 *      48-turn `draftDeadlineTurn`, applies +15 popular / -10 intra.
 *   2. `draft` — locked once `submitConventionDraft` runs. Carries the
 *      chosen `targetSystem` (must be in `collapseTargetAllowlist`),
 *      `legacyReservation` (0..35), and `electionDelayTurns` ∈ {12,24,48}.
 *      When `draftDeadlineTurn` elapses, the tick driver advances to
 *      `ratification` automatically.
 *   3. `ratification` — at `draftDeadlineTurn + electionDelayTurns` the
 *      tick driver fires `triggerSystemConversion` with `path: "voluntary"`.
 *      The conversion flips governmentType and parks the snap-election
 *      marker for the election engine.
 *
 * Stage-4 forced conversion is handled separately in
 * `systemConversion.checkForcedConversion`. The two paths share the
 * conversion implementation but the convention path is gated on a
 * player-initiated `announceConvention`.
 */
import type { Db, ObjectId } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId, type GovernmentType } from "@/lib/constants/countries";
import { getRegimeEscalationCollection } from "@/lib/db/collections/regimeEscalation";
import { adjustLeaderConfidence } from "@/lib/turn/rulingPartyConfidence";
import { adjustPopularLegitimacy } from "@/lib/turn/popularLegitimacy";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";
import { ensureInitialEscalationState } from "@/lib/turn/regimeEscalationTurn";
import { triggerSystemConversion } from "./systemConversion";

const DRAFT_PHASE_TURNS = 48;
const VALID_ELECTION_DELAYS = [12, 24, 48] as const;
type ValidElectionDelay = (typeof VALID_ELECTION_DELAYS)[number];

const ANNOUNCE_POPULAR_BUMP = 15;
const ANNOUNCE_INTRA_COST = -10;

/**
 * Player-initiated announcement of a constitutional convention.
 *
 * Pre-conditions:
 *   - The country has an escalation state row (typically self-healed
 *     on first read by the per-turn driver).
 *   - The country is not already in `collapse` stage — once the regime
 *     is collapsing, the only path out is Stage-4's
 *     `acceptPeacefully` / `resist` decisions or a Stage-4 forced
 *     conversion. Layering a voluntary convention on top would race
 *     `checkForcedConversion` and produce an undefined outcome.
 *   - No convention is already in progress.
 */
export async function announceConvention(
  db: Db,
  countryId: CountryId,
  leaderCharacterId: ObjectId,
  currentTurn: number
): Promise<void> {
  const cfg = COUNTRY_CONFIGS[countryId];
  if (!cfg) throw new Error(`announceConvention: unknown country ${countryId}`);

  const coll = getRegimeEscalationCollection(db);
  // Self-heal the escalation doc when missing — a fresh game where no
  // per-turn driver has run for this country won't have one yet, but
  // we still want the player-initiated announce to work. Same pattern
  // the per-turn driver uses on first tick.
  let state = await coll.findOne({ _id: countryId });
  if (!state) {
    state = await ensureInitialEscalationState(db, countryId, currentTurn);
  }
  if (state.currentStage === "collapse") {
    throw new Error("Cannot announce convention during collapse stage");
  }
  if (state.convention) {
    throw new Error("Convention already in progress");
  }

  await coll.findOneAndUpdate(
    { _id: countryId },
    {
      $set: {
        convention: {
          phase: "announced",
          announcedAtTurn: currentTurn,
          draftDeadlineTurn: currentTurn + DRAFT_PHASE_TURNS,
          legacyReservation: cfg.legacyReservationDefault ?? 20,
          electionDelayTurns: cfg.electionDelayDefault ?? 24,
        },
        conventionInProgress: true,
        updatedAt: new Date(),
      },
    }
  );

  await adjustPopularLegitimacy(
    db,
    countryId,
    leaderCharacterId,
    ANNOUNCE_POPULAR_BUMP,
    "Announced Constitutional Convention",
    currentTurn
  );
  await adjustLeaderConfidence(
    db,
    countryId,
    leaderCharacterId,
    ANNOUNCE_INTRA_COST,
    "Announced Constitutional Convention",
    currentTurn
  );

  await recordCountryEvent(db, {
    countryId,
    turn: currentTurn,
    eventType: "regime_escalation",
    title: `Leader announces a Constitutional Convention in ${countryId}`,
    details: {
      subtype: "convention",
      phase: "announced",
      draftDeadlineTurn: currentTurn + DRAFT_PHASE_TURNS,
    },
  }).catch((err) => console.error(`${countryId} convention announce history failed:`, err));
}

export interface ConventionDraftInput {
  targetSystem: GovernmentType;
  legacyReservation: number;
  electionDelayTurns: ValidElectionDelay;
}

/**
 * Lock the convention's target system + reservation + delay, advancing
 * phase from `announced` to `draft`.
 *
 * Validation:
 *   - `targetSystem` must be in `collapseTargetAllowlist`, with
 *     `collapseTargetSystem` accepted as a fallback when the allowlist
 *     is omitted on the config.
 *   - `legacyReservation` must land in 0..35 (design's negotiated range).
 *   - `electionDelayTurns` must be one of 12, 24, 48 — design's
 *     UI-exposed picker values.
 */
export async function submitConventionDraft(
  db: Db,
  countryId: CountryId,
  draft: ConventionDraftInput,
  currentTurn: number
): Promise<void> {
  const cfg = COUNTRY_CONFIGS[countryId];
  if (!cfg) throw new Error(`submitConventionDraft: unknown country ${countryId}`);

  const allowlist =
    cfg.collapseTargetAllowlist ?? (cfg.collapseTargetSystem ? [cfg.collapseTargetSystem] : []);
  if (!allowlist.includes(draft.targetSystem)) {
    throw new Error(`targetSystem "${draft.targetSystem}" not in ${countryId} allowlist`);
  }
  if (draft.legacyReservation < 0 || draft.legacyReservation > 35) {
    throw new Error("legacyReservation must be between 0 and 35");
  }
  if (!VALID_ELECTION_DELAYS.includes(draft.electionDelayTurns)) {
    throw new Error("electionDelayTurns must be 12, 24, or 48");
  }

  const coll = getRegimeEscalationCollection(db);
  const state = await coll.findOne({ _id: countryId });
  if (!state?.convention) {
    throw new Error("submitConventionDraft: no convention in progress");
  }
  if (state.convention.phase !== "announced") {
    throw new Error(
      `submitConventionDraft: convention is in phase "${state.convention.phase}", not "announced"`
    );
  }

  await coll.findOneAndUpdate(
    { _id: countryId },
    {
      $set: {
        "convention.phase": "draft",
        "convention.targetSystem": draft.targetSystem,
        "convention.legacyReservation": draft.legacyReservation,
        "convention.electionDelayTurns": draft.electionDelayTurns,
        updatedAt: new Date(),
      },
    }
  );

  await recordCountryEvent(db, {
    countryId,
    turn: currentTurn,
    eventType: "regime_escalation",
    title: `Constitutional Convention draft submitted in ${countryId}`,
    details: {
      subtype: "convention",
      phase: "draft",
      targetSystem: draft.targetSystem,
      legacyReservation: draft.legacyReservation,
      electionDelayTurns: draft.electionDelayTurns,
    },
  }).catch((err) => console.error(`${countryId} convention draft history failed:`, err));
}

/**
 * Per-turn convention auto-transitions. Called from
 * `processRegimeEscalationTurn` (before the dwell update so the
 * conventionInProgress flag is correct for this tick).
 *
 *   - `draft` → `ratification` when `draftDeadlineTurn` is reached.
 *   - `ratification` → conversion when
 *     `draftDeadlineTurn + electionDelayTurns` is reached. The
 *     `targetSystem` must be set (was set in `submitConventionDraft`);
 *     if the draft was never submitted, the convention is silently
 *     dropped at the deadline (no conversion fires) so an abandoned
 *     announce doesn't accidentally collapse the regime.
 *   - `announced` is the player's window to submit a draft. The tick
 *     leaves it alone — if no draft arrives by `draftDeadlineTurn`,
 *     the convention is cleared and `conventionInProgress` is reset.
 */
export async function tickConventionPhase(
  db: Db,
  countryId: CountryId,
  currentTurn: number
): Promise<void> {
  const coll = getRegimeEscalationCollection(db);
  const state = await coll.findOne({ _id: countryId });
  if (!state?.convention) return;
  const conv = state.convention;

  // Announced + deadline passed without a draft → abandon the convention.
  if (conv.phase === "announced" && currentTurn >= conv.draftDeadlineTurn) {
    await coll.findOneAndUpdate(
      { _id: countryId },
      {
        $unset: { convention: "" },
        $set: { conventionInProgress: false, updatedAt: new Date() },
      }
    );
    await recordCountryEvent(db, {
      countryId,
      turn: currentTurn,
      eventType: "regime_escalation",
      title: `Constitutional Convention in ${countryId} dissolves without a draft`,
      details: { subtype: "convention", phase: "abandoned" },
    }).catch((err) => console.error(`${countryId} convention abandon history failed:`, err));
    return;
  }

  // Draft phase expired → ratification.
  if (conv.phase === "draft" && currentTurn >= conv.draftDeadlineTurn) {
    await coll.findOneAndUpdate(
      { _id: countryId },
      { $set: { "convention.phase": "ratification", updatedAt: new Date() } }
    );
    return;
  }

  // Ratification → conversion fires at the negotiated election turn.
  if (conv.phase === "ratification") {
    const electionTurn = conv.draftDeadlineTurn + conv.electionDelayTurns;
    if (currentTurn < electionTurn) return;
    if (!conv.targetSystem) {
      // Defensive: shouldn't happen because draft submission requires
      // targetSystem, but if somehow we reach ratification without one
      // (e.g. degenerate manual write), drop the convention without
      // conversion to avoid a bad cast.
      await coll.findOneAndUpdate(
        { _id: countryId },
        { $unset: { convention: "" }, $set: { conventionInProgress: false, updatedAt: new Date() } }
      );
      return;
    }
    await triggerSystemConversion(db, countryId, currentTurn, {
      targetSystem: conv.targetSystem,
      legacyReservation: conv.legacyReservation,
      path: "voluntary",
      electionAtTurn: currentTurn,
    });
    // Clear the convention now that the conversion has fired.
    await coll.findOneAndUpdate(
      { _id: countryId },
      {
        $unset: { convention: "" },
        $set: { conventionInProgress: false, updatedAt: new Date() },
      }
    );
  }
}
