import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Character, GameConfig, NPP } from "@/lib/db/types";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { CongressLeader, LeadershipRole } from "@/lib/db/types/leadership";
import type { PoliticalParty } from "@/lib/db/types/party";
import {
  applyPoliticalInfluenceDecay,
  calculateFavorabilityAboveThresholdPenalty,
  calculateInfamyFavorabilityDrain,
  calculateNationalInfluenceGain,
  NPP_POLITICAL_INFLUENCE_FLOOR,
} from "@shared/constants/formulas";
import { energyActionLimits, applyTurnDrift } from "@/lib/stats/statDrift";
import { applyDebateDecay } from "@/lib/stats/debateDecay";
import { STAT_MIN } from "@/lib/stats/statsConstants";
import {
  CABINET_OFFICE_TYPES,
  cabinetOfficeTypeForCountry,
  resolveOfficeActionBonus,
} from "@/lib/actions/officeActionBonus";
import {
  resolveOfficeActionBonusForType,
  resolveOfficeNiBonus,
} from "@/lib/actions/officeBonusRegistry";
import type { CountryId } from "@/lib/constants/countries";
import type { SupremeCourtSeat } from "@/lib/db/types/scotus";
import { JUSTICE_NI_BONUS_PER_TURN } from "@/lib/constants/justiceActions";
import { logger } from "../observability/logger";
const MIN_BASE_ACTIONS_PER_TURN = 4;
/*
 * Fallback if `gameConfig.chairActionBonus` is missing on legacy configs.
 * The per-country config in `countries.ts` sets each centralBankChair office
 * to 3 — keep this in sync if that changes.
 */
const DEFAULT_CHAIR_ACTION_BONUS = 3;
/*
 * Hoarding penalty: when a character sits above 100 unspent actions they lose
 * 4 per turn, effectively capping long-term stockpiling at ~150 equilibrium
 * (4 base + hoard penalty cancels at 100 + 4/4 * 50 = 150).
 * This prevents players from banking actions across months and then spending
 * them all in a single burst to dominate an election cycle.
 */
const ACTION_HOARD_PENALTY = 4;

/**
 * Refresh actions and apply stat updates for all characters each turn.
 * - Actions: base + office bonus + chair bonus (stacked), capped at 200;
 *   hoarding penalty if > 100
 * - Political influence: decays at a lower 0.75% slope per turn (Campaign to maintain)
 * - National influence: passively accrues +state influence / 100 per turn (uncapped)
 * - Infamy: 5% decay per turn
 * - Favorability: above-threshold penalty (stable at 60% or below)
 */
export async function processActionRefresh(
  characters: Character[],
  config: GameConfig | null,
  now: Date
): Promise<void> {
  const db = await getDb();
  const baseActionsPerTurn = Math.max(config?.baseActionsPerTurn ?? 0, MIN_BASE_ACTIONS_PER_TURN);
  const chairActionBonus = config?.chairActionBonus ?? DEFAULT_CHAIR_ACTION_BONUS;

  /*
   * Central bank chair is a standalone role that stacks on top of any elected
   * office the character also holds (e.g. a sitting Councillor who is also
   * BoJ chair earns the sangiin bonus + chair bonus). The role lives on the
   * `centralBanks` document, not on `character.currentOffice`, so we load
   * chair ids up-front rather than keying off currentOffice.type.
   */
  const chairRows = await db
    .collection<CentralBank>("centralBanks")
    .find({ chairCharacterId: { $ne: null } }, { projection: { chairCharacterId: 1 } })
    .toArray();
  const chairCharacterIds = new Set(
    chairRows
      .map((b) => b.chairCharacterId)
      .filter((id): id is ObjectId => id != null)
      .map((id) => id.toString())
  );

  /*
   * Justice is a standalone role (#3598), stored on `supremeCourtSeats`, not
   * on `character.currentOffice` — same reasoning as the central bank chair
   * above: it stacks on top of any elected office the character also holds.
   * Only player-held seats (justiceCharacterId set) draw the NI bonus; NPP-
   * or historical-roster-held seats have no controlling player to benefit.
   */
  const justiceSeatRows = await db
    .collection<SupremeCourtSeat>("supremeCourtSeats")
    .find({ justiceCharacterId: { $ne: null } }, { projection: { justiceCharacterId: 1 } })
    .toArray();
  const seatedJusticeCharacterIds = new Set(
    justiceSeatRows
      .map((s) => s.justiceCharacterId)
      .filter((id): id is ObjectId => id != null)
      .map((id) => id.toString())
  );

  // ── Position-based NI bonuses ────────────────────────────────────────────
  // Tiers: 2.5 (executive head), 2.0 (VP / top leaders / party chair),
  //        1.5 (deputy leaders / party vc/treasurer), 1.0 (rank-and-file legislators)
  // Office tiers live in `resolveOfficeNiBonus`, which falls back to the
  // per-country office registry so non-US legislators are not silently zeroed.
  const CONGRESS_LEADER_NI_BONUS: Partial<Record<LeadershipRole, number>> = {
    majority_leader_senate: 2.0,
    speaker_of_the_house: 2.0,
    president_pro_tempore: 2.0,
    minority_leader_senate: 1.5,
    majority_leader_house: 1.5,
    minority_leader_house: 1.5,
  };

  const congressLeaderRows = await db
    .collection<CongressLeader>("congressLeaders")
    .find({ characterId: { $ne: null } }, { projection: { characterId: 1, role: 1 } })
    .toArray();
  const leaderRoleByCharId = new Map<string, LeadershipRole>();
  for (const row of congressLeaderRows) {
    if (row.characterId) leaderRoleByCharId.set(row.characterId.toString(), row.role);
  }

  const partyChairIds = new Set<string>();
  const partySubChairIds = new Set<string>();
  const partyRows = await db
    .collection<PoliticalParty>("politicalParties")
    .find(
      {
        $or: [
          { chairId: { $ne: null } },
          { viceChairId: { $ne: null } },
          { treasurerId: { $ne: null } },
        ],
      },
      { projection: { chairId: 1, viceChairId: 1, treasurerId: 1 } }
    )
    .toArray();
  for (const p of partyRows) {
    if (p.chairId) partyChairIds.add(p.chairId.toString());
    if (p.viceChairId) partySubChairIds.add(p.viceChairId.toString());
    if (p.treasurerId) partySubChairIds.add(p.treasurerId.toString());
  }

  /*
   * Cabinet membership lives in the unified `cabinetMembers` collection (the
   * SSOT across US/UK/parliamentary families), not on `character.currentOffice`.
   * The cabinet action bonus STACKS on the holder's legislative seat — but
   * appointment overwrites `currentOffice` with a cabinet office key, so the
   * seat itself is recovered from `electedOfficials`. Mirrors how the central
   * bank chair bonus stacks on top of an elected-office bonus.
   */
  const cabinetRows = await db
    .collection<{ characterId: ObjectId; countryId: string }>("cabinetMembers")
    .find({}, { projection: { characterId: 1, countryId: 1 } })
    .toArray();
  const cabinetCountryByCharId = new Map<string, CountryId>();
  for (const m of cabinetRows) {
    if (m.characterId)
      cabinetCountryByCharId.set(m.characterId.toString(), m.countryId as CountryId);
  }

  // Recover the underlying legislative seat only for the cabinet ministers whose
  // currentOffice was overwritten to a cabinet key (others keep their real seat).
  const cabinetSeatCharIds = characters
    .filter((c) => c.currentOffice && CABINET_OFFICE_TYPES.has(c.currentOffice.type))
    .map((c) => c._id);
  const electedRows =
    cabinetSeatCharIds.length > 0
      ? await db
          .collection<{ characterId: ObjectId; officeType: string; countryId?: CountryId }>(
            "electedOfficials"
          )
          .find(
            { characterId: { $in: cabinetSeatCharIds } },
            { projection: { characterId: 1, officeType: 1, countryId: 1 } }
          )
          .toArray()
      : [];
  // Keep the highest-bonus seat per character (handles multiple/duplicate seats).
  const seatTypeByCharId = new Map<string, string>();
  for (const row of electedRows) {
    const id = row.characterId.toString();
    const bonus = resolveOfficeActionBonusForType(
      row.officeType,
      config?.officeActionBonus,
      row.countryId
    );
    const prev = seatTypeByCharId.get(id);
    const prevBonus = prev
      ? resolveOfficeActionBonusForType(prev, config?.officeActionBonus, row.countryId)
      : -1;
    if (bonus > prevBonus) seatTypeByCharId.set(id, row.officeType);
  }

  const ops: {
    updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, unknown> } };
  }[] = [];

  for (const character of characters) {
    const charIdStrForOffice = character._id.toString();
    const cabinetCountry = cabinetCountryByCharId.get(charIdStrForOffice);
    let actionRefresh =
      baseActionsPerTurn +
      resolveOfficeActionBonus({
        currentOfficeType: character.currentOffice?.type,
        electedSeatOfficeType: seatTypeByCharId.get(charIdStrForOffice),
        isCabinetMember: cabinetCountry != null,
        cabinetOfficeType: cabinetCountry ? cabinetOfficeTypeForCountry(cabinetCountry) : undefined,
        officeActionBonus: config?.officeActionBonus,
        countryId: character.countryId,
      });
    if (chairCharacterIds.has(character._id.toString())) {
      actionRefresh += chairActionBonus;
    }
    if (typeof actionRefresh !== "number" || isNaN(actionRefresh)) {
      logger.error("Turn", `Invalid actionRefresh for character ${character._id}`);
      continue;
    }

    // Energy raises the per-character action cap and hoard threshold. Unmigrated
    // characters (no Energy stat) fall back to the baseline 200/100 via STAT_MIN.
    const { cap: energyCap, threshold: energyThreshold } = energyActionLimits(
      character.stats?.energy ?? STAT_MIN
    );
    const penalty = character.actions > energyThreshold ? ACTION_HOARD_PENALTY : 0;
    const newActions = Math.min(
      energyCap,
      Math.max(0, character.actions - penalty + actionRefresh)
    );

    const currentInfluence = character.politicalInfluence ?? 0;
    /*
     * Political influence decays at 0.75% per turn, requiring
     * active campaigning to maintain. At equilibrium, continuous campaign actions
     * offset this decay. A character who stops campaigning loses all influence
     * more gradually than before, reducing pure maintenance tax.
     */
    const newInfluence = applyPoliticalInfluenceDecay(currentInfluence);

    const currentNational = character.nationalInfluence ?? 0;
    /*
     * National influence accrues passively at the same rate political influence
     * decays (+state influence / 100 per turn). This models how state-level
     * visibility slowly builds national name recognition — a high-influence
     * politician in their home state gradually becomes known nationally.
     * National influence is never decayed; it represents accumulated reputation.
     */
    const charIdStr = character._id.toString();
    let positionNiBonus = 0;
    if (character.currentOffice) {
      positionNiBonus = Math.max(
        positionNiBonus,
        resolveOfficeNiBonus(character.currentOffice.type, character.countryId)
      );
    }
    const leaderRole = leaderRoleByCharId.get(charIdStr);
    if (leaderRole) {
      positionNiBonus = Math.max(positionNiBonus, CONGRESS_LEADER_NI_BONUS[leaderRole] ?? 0);
    }
    if (partyChairIds.has(charIdStr)) {
      positionNiBonus = Math.max(positionNiBonus, 2.0);
    } else if (partySubChairIds.has(charIdStr)) {
      positionNiBonus = Math.max(positionNiBonus, 1.5);
    }
    if (seatedJusticeCharacterIds.has(charIdStr)) {
      positionNiBonus = Math.max(positionNiBonus, JUSTICE_NI_BONUS_PER_TURN);
    }

    const nationalGain = calculateNationalInfluenceGain(currentInfluence) + positionNiBonus;
    const newNational = currentNational + nationalGain;

    const currentInfamy = character.infamy ?? 0;
    /*
     * Infamy decays 5% per turn (multiplied by 0.95), equivalent to a half-life
     * of ~14 turns (just under 3.5 game months). This models the news cycle —
     * scandals fade over time unless the character does something else notorious.
     */
    const newInfamy = Math.max(0, currentInfamy * 0.95);

    const currentFavorability = character.favorability ?? 50;
    const favPenalty = calculateFavorabilityAboveThresholdPenalty(currentFavorability);
    /*
     * Infamy drain — the advertised "(infamy − 20) × 0.05 favorability per
     * turn" from the profile pages and stats wiki, now actually applied.
     * Uses the pre-decay infamy (the value the player sees this turn) and
     * clamps to the same 0..100 favorability bounds as the above-threshold
     * penalty.
     */
    const infamyDrain = calculateInfamyFavorabilityDrain(currentInfamy);
    const newFavorability = Math.min(
      100,
      Math.max(0, currentFavorability - favPenalty - infamyDrain)
    );

    const setFields: Record<string, unknown> = {
      actions: newActions,
      politicalInfluence: newInfluence,
      nationalInfluence: newNational,
      infamy: newInfamy,
      favorability: newFavorability,
      updatedAt: now,
    };

    // Stat drift — only for characters that have allocated stats. Generic-drift
    // stats flush use-growth XP (no idle decay — stats are permanent unless lost
    // through crisis events). Debate decays on its own real-time 72h clock via the
    // anchor.
    if (character.stats) {
      const drifted = applyTurnDrift(character.stats, character.statXp);
      const debate = applyDebateDecay(drifted.stats.debate, character.debateDecayAnchor, now);
      drifted.stats.debate = debate.debate;
      setFields.stats = drifted.stats;
      setFields.statXp = drifted.statXp;
      setFields.debateDecayAnchor = debate.anchor;
    }

    ops.push({
      updateOne: {
        filter: { _id: character._id },
        update: { $set: setFields },
      },
    });
  }

  if (ops.length > 0) {
    await db.collection("characters").bulkWrite(ops);
  }

  // NPP stat decay mirrors player decay and keeps both stats in the 0-100 range.
  const nppCursor = db
    .collection<NPP>("npps")
    .find(
      { retiredAt: null, $or: [{ politicalInfluence: { $gt: 0 } }, { favorability: { $gt: 30 } }] },
      { projection: { _id: 1, politicalInfluence: 1, favorability: 1 } }
    );

  const nppOps: {
    updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, number> } };
  }[] = [];

  for await (const npp of nppCursor) {
    const currentInfluence = npp.politicalInfluence ?? 0;
    // NPPs floor at their seed value (10); the decay rate matches players, but
    // their weaker replenishment means the floor keeps them from bleeding to 0.
    const newInfluence = applyPoliticalInfluenceDecay(
      currentInfluence,
      NPP_POLITICAL_INFLUENCE_FLOOR
    );

    const currentFavorability = npp.favorability ?? 50;
    const favPenalty = calculateFavorabilityAboveThresholdPenalty(currentFavorability);
    const newFavorability = Math.min(100, Math.max(0, currentFavorability - favPenalty));

    nppOps.push({
      updateOne: {
        filter: { _id: npp._id },
        update: {
          $set: {
            politicalInfluence: newInfluence,
            favorability: newFavorability,
          },
        },
      },
    });
  }

  if (nppOps.length > 0) {
    await db.collection("npps").bulkWrite(nppOps);
  }
}
