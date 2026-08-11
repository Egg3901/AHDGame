import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { recruitNPPSchema } from "@/lib/api/schemas/recruitment";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { calculateRecruitmentSlots } from "@/lib/npp/recruitment";
import {
  NPP_RECRUITMENT_AP_COST,
  nppActionPointCap,
  nppRecruitmentFundCost,
  nppTreasuryCurrency,
} from "@/lib/npp/actionPoints";
import { resolvePartyTier } from "@/lib/parties/partyTier";
import { generateUniqueNPPName } from "@/lib/npp/nameGenerator";
import { calculateQualityBonus } from "@/lib/npp/generator";
import { NPP_ECONOMY_DEFAULTS } from "@/lib/npp/economyDefaults";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { getStateLean } from "@/lib/utils/demographics";
import type { State, StatePartyOrg, NPP, PoliticalParty } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { getPartyNppControlStatus } from "@/lib/parties/antiAbuseGuards";
import { getGameTime } from "@/lib/time/gameTime";
import {
  recruitmentCooldownRemainingTurns,
  recruitmentCooldownSet,
  recruitmentCooldownReadyFilter,
} from "@/lib/npp/recruitmentCooldown";

// POST /api/country/[code]/parties/[id]/recruitment/recruit — Recruit an NPP into the party in a specified state
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
/**
 * POST /api/parties/[id]/recruitment/recruit
 * Recruit an NPP in a specified state.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    const auth = authResult.user;

    const rateLimit = checkRateLimit(authResult.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, recruitNPPSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { stateId } = parsed.data;

    const db = await getDb();
    const now = new Date();
    // Recruitment cooldown is turn-based (see recruitmentCooldown helper); we
    // read currentTurn from the game clock so a paused or drifted real clock
    // can't shorten or lengthen the cooldown window.
    const gameTime = await getGameTime();
    const gameNow = gameTime.effectiveNow;

    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const partyIdStr = String(party.sequentialId);
    const charId = auth.character._id.toString();
    const isChair = party.chairId?.toString() === charId;
    const isViceChair = party.viceChairId?.toString() === charId;

    if (!isChair && !isViceChair && !auth.isAdmin) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
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

    // Turn-first cooldown (24 turns); helper falls back to the legacy Date.
    const remainingTurns = recruitmentCooldownRemainingTurns(
      party,
      gameTime.currentTurn,
      gameNow.getTime()
    );
    if (remainingTurns > 0) {
      return NextResponse.json(
        { error: `Recruitment on cooldown. Available in ${remainingTurns} hours.` },
        { status: 400 }
      );
    }

    // Verify state exists and is in correct country
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    // National leadership can recruit in any state, including those with active
    // State/Regional Chair/VC. Only the per-state slot cap (below) and party
    // resources gate this — letting national chairs back-fill states that are
    // led by an inactive or recently-installed local chair, or where players
    // are already present, was the original missing capability.
    const statePartyOrg = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ stateId, partyId: partyIdStr });

    // Calculate slots and cost
    const stateOrg = statePartyOrg?.organization ?? 0;
    const currentNPPs = await db
      .collection<NPP>("npps")
      .countDocuments({ party: partyIdStr, homeState: stateId, retiredAt: null });

    const maxSlots = calculateRecruitmentSlots(stateOrg);
    if (currentNPPs >= maxSlots) {
      return NextResponse.json(
        { error: `No recruitment slots available in ${state.name}. Max: ${maxSlots}` },
        { status: 400 }
      );
    }

    // NPP Recruitment spends a flat 5 Action Points plus a per-currency treasury
    // cost. Legacy rows with an unset AP pool read as full (= tier cap).
    const recruitCost = NPP_RECRUITMENT_AP_COST;
    const recruitFund = nppRecruitmentFundCost(nppTreasuryCurrency(countryId));
    const availableAp =
      party.nppActionPoints ?? nppActionPointCap("national", resolvePartyTier(party));
    if (availableAp < recruitCost) {
      return NextResponse.json(
        { error: `Insufficient actions. Need ${recruitCost}, have ${availableAp}` },
        { status: 400 }
      );
    }
    if ((party.treasury ?? 0) < recruitFund) {
      return NextResponse.json(
        {
          error: `Insufficient funds. Need $${recruitFund.toLocaleString()}, have $${(party.treasury ?? 0).toLocaleString()}`,
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

    // Cooldown stored turn-first (+ Date for display/legacy). The readiness
    // filter is turn-first too so the atomic deduct can't double-recruit.
    const cooldownSet = recruitmentCooldownSet(gameTime.currentTurn, gameNow.getTime());
    const cooldownReadyFilter = recruitmentCooldownReadyFilter(gameTime.currentTurn, gameNow);

    // Heal a never-initialized AP pool (paused / never-regenerated game) to the
    // tier cap so the atomic `$gte` deduct can match. Idempotent via `$exists:false`.
    if (party.nppActionPoints == null) {
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne(
          { _id: party._id, nppActionPoints: { $exists: false } },
          { $set: { nppActionPoints: availableAp } }
        );
    }

    await runWithOptionalTransaction(
      async (session) => {
        const deductResult = await db.collection<PoliticalParty>("politicalParties").updateOne(
          {
            _id: party._id,
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
          throw new Error("NATIONAL_RECRUITMENT_CHANGED");
        }

        await db.collection<NPP>("npps").insertOne(npp, { session });
      },
      async () => {
        const deductResult = await db.collection<PoliticalParty>("politicalParties").updateOne(
          {
            _id: party._id,
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
          throw new Error("NATIONAL_RECRUITMENT_CHANGED");
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
          // leaves a phantom turn/Date cooldown behind (e.g. a legacy party that
          // had only the Date field would otherwise keep the freshly-written turn).
          const rollbackUnset: Partial<{
            nppRecruitmentCooldownUntil: "";
            nppRecruitmentCooldownUntilTurn: "";
          }> = {};
          if (party.nppRecruitmentCooldownUntil) {
            rollbackUpdate.$set.nppRecruitmentCooldownUntil = party.nppRecruitmentCooldownUntil;
          } else {
            rollbackUnset.nppRecruitmentCooldownUntil = "";
          }
          if (party.nppRecruitmentCooldownUntilTurn != null) {
            rollbackUpdate.$set.nppRecruitmentCooldownUntilTurn =
              party.nppRecruitmentCooldownUntilTurn;
          } else {
            rollbackUnset.nppRecruitmentCooldownUntilTurn = "";
          }
          if (Object.keys(rollbackUnset).length > 0) {
            rollbackUpdate.$unset = rollbackUnset;
          }

          await db
            .collection<PoliticalParty>("politicalParties")
            .updateOne({ _id: party._id }, rollbackUpdate);
          throw error;
        }
      }
    );

    console.log(
      `[NPP Recruitment] ${auth.character.name} recruited ${name} in ${state.name} for ${party.name}`
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
    if (error instanceof Error && error.message === "NATIONAL_RECRUITMENT_CHANGED") {
      return NextResponse.json(
        { error: "Recruitment resources or cooldown changed before the recruit completed." },
        { status: 409 }
      );
    }
    return handleRouteError(error);
  }
}
