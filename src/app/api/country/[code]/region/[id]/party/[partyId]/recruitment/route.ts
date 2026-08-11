// src/app/api/state/[id]/party/[partyId]/recruitment/route.ts
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { calculateRecruitmentSlots } from "@/lib/npp/recruitment";
import {
  NPP_RECRUITMENT_AP_COST,
  nppActionPointCap,
  nppActionPointRegen,
  nppRecruitmentFundCost,
  nppTreasuryCurrency,
} from "@/lib/npp/actionPoints";
import { resolvePartyTier } from "@/lib/parties/partyTier";
import { generateUniqueNPPName } from "@/lib/npp/nameGenerator";
import { calculateQualityBonus } from "@/lib/npp/generator";
import { NPP_ECONOMY_DEFAULTS } from "@/lib/npp/economyDefaults";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { getStateLean } from "@/lib/utils/demographics";
import type { State, StatePartyOrg, NPP } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { getPartyNppControlStatus } from "@/lib/parties/antiAbuseGuards";
import { getGameTime } from "@/lib/time/gameTime";
import {
  recruitmentCooldownRemainingTurns,
  recruitmentCooldownSet,
  recruitmentCooldownReadyFilter,
  recruitmentCooldownUntilIso,
} from "@/lib/npp/recruitmentCooldown";

// GET /api/country/[code]/region/[id]/party/[partyId]/recruitment — Return NPP recruitment status and slot info for state leadership
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
// POST /api/country/[code]/region/[id]/party/[partyId]/recruitment — Recruit an NPP in the state using state party resources
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
/**
 * GET /api/state/[id]/party/[partyId]/recruitment
 * Returns recruitment status for state leadership.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string; partyId: string }> }
) {
  try {
    const { code, id, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    const auth = authResult.user;

    const db = await getDb();

    // Get state to determine country
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const partyIdStr = String(party.sequentialId);

    // Check if caller is state Chair/VC
    const statePartyOrg = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ stateId, partyId: partyIdStr });

    const charId = auth.character._id.toString();
    const isStateChair = statePartyOrg?.chairId?.toString() === charId;
    const isStateViceChair = statePartyOrg?.viceChairId?.toString() === charId;
    const isStateLeadership = isStateChair || isStateViceChair;

    if (!isStateLeadership && !auth.isAdmin) {
      return NextResponse.json({ error: "Not state leadership" }, { status: 403 });
    }

    // Count party NPPs
    const partyNPPCount = await db
      .collection<NPP>("npps")
      .countDocuments({ party: partyIdStr, retiredAt: null });

    const stateNPPCount = await db
      .collection<NPP>("npps")
      .countDocuments({ party: partyIdStr, homeState: stateId, retiredAt: null });

    const now = new Date();
    // Recruitment cooldown is measured in turns, so compare against the game
    // clock — a stalled or drifted real clock can't shorten/lengthen it.
    const gameTime = await getGameTime();
    const gameNow = gameTime.effectiveNow;
    const nppControl = await getPartyNppControlStatus({
      db,
      countryId,
      party,
      actor: auth.character,
      isAdmin: auth.isAdmin,
      now,
    });
    // State leadership uses its own per-state cooldown, independent of the
    // national party cooldown. Turn-first remaining (+ Date fallback in helper),
    // projected end instant from real time so the display doesn't drift.
    const remainingTurns = recruitmentCooldownRemainingTurns(
      statePartyOrg,
      gameTime.currentTurn,
      gameNow.getTime()
    );
    const cooldownRemaining = remainingTurns > 0 ? remainingTurns * 3600 : null;
    const cooldownUntil = recruitmentCooldownUntilIso(remainingTurns, Date.now());

    const stateOrg = statePartyOrg?.organization ?? 0;
    const maxSlots = calculateRecruitmentSlots(stateOrg);
    const availableSlots = Math.max(0, maxSlots - stateNPPCount);

    // NPP Recruitment spends a flat 5 Action Points from the state pool plus a
    // per-currency treasury cost. Legacy rows with an unset AP pool read as full.
    const apTier = resolvePartyTier(party);
    const recruitCost = NPP_RECRUITMENT_AP_COST;
    const recruitFund = nppRecruitmentFundCost(nppTreasuryCurrency(countryId));
    const stateTreasury = statePartyOrg?.treasury ?? 0;
    const availableAp = statePartyOrg?.nppActionPoints ?? nppActionPointCap("state", apTier);

    const canRecruit =
      !cooldownRemaining &&
      isStateLeadership &&
      nppControl.ok &&
      availableSlots > 0 &&
      availableAp >= recruitCost &&
      stateTreasury >= recruitFund;

    return NextResponse.json({
      cooldownUntil,
      cooldownRemaining,
      partyNPPCount,
      stateNPPCount,
      stateOrg,
      maxSlots,
      availableSlots,
      actionCost: recruitCost,
      fundCost: recruitFund,
      stateTreasury,
      nppActionPoints: availableAp,
      nppActionPointCap: nppActionPointCap("state", apTier),
      nppActionPointRegen: nppActionPointRegen("state", apTier),
      canRecruit,
      blockedReason: nppControl.ok ? null : nppControl.error,
      isStateLeadership,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/state/[id]/party/[partyId]/recruitment
 * Recruit an NPP using state party resources.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string; partyId: string }> }
) {
  try {
    const { code, id, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const auth = authResult.user;

    const db = await getDb();
    const now = new Date();
    // Recruitment cooldown is measured in turns; compare/write against the
    // game clock so the window can't drift under a stalled cron.
    const gameTime = await getGameTime();
    const gameNow = gameTime.effectiveNow;

    // Get state to determine country
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const partyIdStr = String(party.sequentialId);

    // Check if caller is state Chair/VC
    const statePartyOrg = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ stateId, partyId: partyIdStr });

    const charId = auth.character._id.toString();
    const isStateChair = statePartyOrg?.chairId?.toString() === charId;
    const isStateViceChair = statePartyOrg?.viceChairId?.toString() === charId;

    if (!isStateChair && !isStateViceChair && !auth.isAdmin) {
      return NextResponse.json({ error: "Not state leadership" }, { status: 403 });
    }

    const nppControl = await getPartyNppControlStatus({
      db,
      countryId,
      party,
      actor: auth.character,
      isAdmin: auth.isAdmin,
      now,
    });
    if (!nppControl.ok) {
      return NextResponse.json({ error: nppControl.error }, { status: 403 });
    }

    // Turn-first state-level cooldown (24 turns); helper falls back to Date.
    const cooldownRemainingTurns = recruitmentCooldownRemainingTurns(
      statePartyOrg,
      gameTime.currentTurn,
      gameNow.getTime()
    );
    if (cooldownRemainingTurns > 0) {
      return NextResponse.json(
        { error: `Recruitment on cooldown. Available in ${cooldownRemainingTurns} hours.` },
        { status: 400 }
      );
    }

    // Calculate slots
    const stateOrg = statePartyOrg?.organization ?? 0;
    const stateNPPCount = await db
      .collection<NPP>("npps")
      .countDocuments({ party: partyIdStr, homeState: stateId, retiredAt: null });

    const maxSlots = calculateRecruitmentSlots(stateOrg);
    if (stateNPPCount >= maxSlots) {
      return NextResponse.json(
        { error: `No recruitment slots available in ${state.name}. Max: ${maxSlots}` },
        { status: 400 }
      );
    }

    // NPP Recruitment spends a flat 5 Action Points from the state pool plus a
    // per-currency treasury cost. Legacy rows with an unset pool read as full.
    const recruitCost = NPP_RECRUITMENT_AP_COST;
    const recruitFund = nppRecruitmentFundCost(nppTreasuryCurrency(countryId));
    const stateTreasury = statePartyOrg?.treasury ?? 0;
    const availableAp =
      statePartyOrg?.nppActionPoints ?? nppActionPointCap("state", resolvePartyTier(party));
    if (availableAp < recruitCost) {
      return NextResponse.json(
        { error: `Insufficient state party actions. Need ${recruitCost}, have ${availableAp}` },
        { status: 400 }
      );
    }
    if (stateTreasury < recruitFund) {
      return NextResponse.json(
        {
          error: `Insufficient state party funds. Need $${recruitFund.toLocaleString()}, have $${stateTreasury.toLocaleString()}`,
        },
        { status: 400 }
      );
    }

    // Generate NPP
    const existingNPPs = await db
      .collection<NPP>("npps")
      .find({ retiredAt: null }, { projection: { name: 1 } })
      .toArray();
    const usedNames = new Set(existingNPPs.map((n) => n.name));
    const name = generateUniqueNPPName([...usedNames], 100, countryId);
    if (!name) {
      return NextResponse.json({ error: "Failed to generate unique name" }, { status: 500 });
    }

    const quality = calculateQualityBonus(stateOrg);
    const stateLean = getStateLean(state);
    const partyEcon = party.economicPosition ?? 0;
    const partySoc = party.socialPosition ?? 0;

    const blendEcon = partyEcon * 0.7 + stateLean * 0.3;
    const variance = Math.max(0.4, 1.5 - (quality + 20) / 25);
    const economic = Math.max(
      -5,
      Math.min(5, Math.round((blendEcon + (Math.random() * 2 - 1) * variance) * 10) / 10)
    );
    const social = Math.max(
      -5,
      Math.min(5, Math.round((partySoc + (Math.random() * 2 - 1) * variance) * 10) / 10)
    );

    const sequentialId = await getNextSequentialId(db, "npp");

    const npp: NPP = {
      _id: new ObjectId(),
      name,
      countryId,
      homeState: stateId,
      politicalInfluence: 10,
      favorability: Math.round(
        Math.max(20, Math.min(80, 50 + quality * 0.2 + (Math.random() * 20 - 10)))
      ),
      policies: { economic, social },
      party: partyIdStr,
      currentOffice: null,
      // Economy fields via the shared SSOT — recruited NPPs must spawn at donor
      // base 1 (with funds/AP initialized) just like generated/seeded ones.
      ...NPP_ECONOMY_DEFAULTS,
      personality: {
        loyalty: Math.round(
          Math.max(0, Math.min(100, 50 + quality * 0.3 + (Math.random() * 40 - 20)))
        ),
        ambition: Math.round(Math.max(0, Math.min(100, Math.random() * 60 + 20))),
        stubbornness: Math.round(
          Math.max(0, Math.min(100, 40 - quality * 0.15 + (Math.random() * 40 - 20)))
        ),
      },
      generatedAt: now,
      retiredAt: null,
      influenceState: { totalTimesInfluenced: 0 },
      sequentialId,
      createdAt: now,
      updatedAt: now,
    };

    // Cooldown stored turn-first (+ Date for display/legacy). Readiness filter
    // is turn-first too so the atomic deduct can't double-recruit.
    const cooldownSet = recruitmentCooldownSet(gameTime.currentTurn, gameNow.getTime());
    const cooldownReadyFilter = recruitmentCooldownReadyFilter(gameTime.currentTurn, gameNow);

    // Heal a never-initialized AP pool (paused / never-regenerated game) to the
    // tier cap so the atomic `$gte` deduct can match. Idempotent via `$exists:false`.
    if (statePartyOrg && statePartyOrg.nppActionPoints == null) {
      await db
        .collection<StatePartyOrg>("statePartyOrg")
        .updateOne(
          { stateId, partyId: partyIdStr, nppActionPoints: { $exists: false } },
          { $set: { nppActionPoints: availableAp } }
        );
    }

    await runWithOptionalTransaction(
      async (session) => {
        const deductResult = await db.collection<StatePartyOrg>("statePartyOrg").updateOne(
          {
            stateId,
            partyId: partyIdStr,
            nppActionPoints: { $gte: recruitCost },
            treasury: { $gte: recruitFund },
            ...cooldownReadyFilter,
          },
          {
            $inc: { nppActionPoints: -recruitCost, treasury: -recruitFund },
            $set: { ...cooldownSet, updatedAt: now },
          },
          { session }
        );

        if (deductResult.matchedCount === 0) {
          throw new Error("STATE_RECRUITMENT_CHANGED");
        }

        await db.collection<NPP>("npps").insertOne(npp, { session });
      },
      async () => {
        const deductResult = await db.collection<StatePartyOrg>("statePartyOrg").updateOne(
          {
            stateId,
            partyId: partyIdStr,
            nppActionPoints: { $gte: recruitCost },
            treasury: { $gte: recruitFund },
            ...cooldownReadyFilter,
          },
          {
            $inc: { nppActionPoints: -recruitCost, treasury: -recruitFund },
            $set: { ...cooldownSet, updatedAt: now },
          }
        );

        if (deductResult.matchedCount === 0) {
          throw new Error("STATE_RECRUITMENT_CHANGED");
        }

        try {
          await db.collection<NPP>("npps").insertOne(npp);
        } catch (error) {
          const rollbackUpdate: {
            $inc: { nppActionPoints: number; treasury: number };
            $set: {
              updatedAt: Date;
              nppRecruitmentCooldownUntil?: Date;
              nppRecruitmentCooldownUntilTurn?: number;
            };
            $unset?: Partial<{
              nppRecruitmentCooldownUntil: "";
              nppRecruitmentCooldownUntilTurn: "";
            }>;
          } = {
            $inc: { nppActionPoints: recruitCost, treasury: recruitFund },
            $set: { updatedAt: new Date() },
          };

          // Restore each pre-recruit cooldown field independently: $set the ones
          // that existed, $unset the ones that did not — so a rollback never
          // leaves a phantom turn/Date cooldown behind (e.g. a legacy org that
          // had only the Date field would otherwise keep the freshly-written turn).
          const rollbackUnset: Partial<{
            nppRecruitmentCooldownUntil: "";
            nppRecruitmentCooldownUntilTurn: "";
          }> = {};
          if (statePartyOrg?.nppRecruitmentCooldownUntil) {
            rollbackUpdate.$set.nppRecruitmentCooldownUntil =
              statePartyOrg.nppRecruitmentCooldownUntil;
          } else {
            rollbackUnset.nppRecruitmentCooldownUntil = "";
          }
          if (statePartyOrg?.nppRecruitmentCooldownUntilTurn != null) {
            rollbackUpdate.$set.nppRecruitmentCooldownUntilTurn =
              statePartyOrg.nppRecruitmentCooldownUntilTurn;
          } else {
            rollbackUnset.nppRecruitmentCooldownUntilTurn = "";
          }
          if (Object.keys(rollbackUnset).length > 0) {
            rollbackUpdate.$unset = rollbackUnset;
          }

          await db
            .collection<StatePartyOrg>("statePartyOrg")
            .updateOne({ stateId, partyId: partyIdStr }, rollbackUpdate);
          throw error;
        }
      }
    );

    console.log(
      `[NPP Recruitment] State leadership ${auth.character.name} recruited ${name} in ${state.name} for ${party.name}`
    );

    return NextResponse.json({
      success: true,
      npp: {
        id: npp._id.toString(),
        sequentialId: npp.sequentialId,
        name: npp.name,
        homeState: stateId,
      },
      cooldownUntil: cooldownSet.nppRecruitmentCooldownUntil.toISOString(),
      cost: { actionPoints: recruitCost, funds: recruitFund },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "STATE_RECRUITMENT_CHANGED") {
      return NextResponse.json(
        { error: "Recruitment resources or cooldown changed before the recruit completed." },
        { status: 409 }
      );
    }
    return handleRouteError(error);
  }
}
