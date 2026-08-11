// POST /api/country/[code]/executive/cabinet/[positionId]/military/recruit
// Auth: requireAuth — must be the defense cabinet holder or admin. Costs 1 ministerial action.
// Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import {
  DEFENSE_POSITION_BY_COUNTRY,
  getBranches,
  getUnitTypesForYear,
} from "@/lib/constants/military";
import { resolveGameYear } from "@/lib/era/era";
import { unitPurchasePrice } from "@/lib/military/procurement";
import { ensureManpowerPool, drawManpower, returnManpower } from "@/lib/military/manpowerPool";
import {
  debitAppropriation,
  creditAppropriation,
  getDefenseAppropriation,
} from "@/lib/db/collections/defenseAppropriation";
import { getNationalArsenal, drawLots, returnLots } from "@/lib/db/collections/nationalArsenal";
import { lotsRequired, equipUnit } from "@/lib/military/arsenal";
import { ensureFederalBudget } from "@/lib/turn/ensureFederalBudget";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/** Turns before a newly-recruited unit reaches operational readiness. */
const BUILD_TURNS = 6;
/** Major naval formations take longer. */
const CARRIER_BUILD_TURNS = 10;

const recruitSchema = z.object({
  branchId: z.string(),
  type: z.string(),
  name: z.string().min(1).max(80),
});

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (DEFENSE_POSITION_BY_COUNTRY[countryId] !== positionId) {
      return NextResponse.json({ error: "Not a defense cabinet position" }, { status: 404 });
    }

    const parsed = await parseJsonBody(request, recruitSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    // Live year gates which branches/archetypes exist (e.g. Bundeswehr 1955,
    // USSF 2019). Prefer gameState.currentYear over the immutable seed year.
    const gameState = await getGameState();
    const liveYear = gameState ? resolveGameYear(gameState) : null;
    const currentTurn = gameState?.currentTurn ?? 1;

    const branch = getBranches(countryId, liveYear).find((b) => b.id === parsed.data.branchId);
    if (!branch) {
      return NextResponse.json(
        {
          error: liveYear != null ? `Branch is not available in ${liveYear}` : "Invalid branch",
        },
        { status: 400 }
      );
    }
    const archetype = getUnitTypesForYear(branch.domain, liveYear).find(
      (t) => t.type === parsed.data.type
    );
    if (!archetype) {
      return NextResponse.json(
        {
          error:
            liveYear != null
              ? `Unit type is not available in ${liveYear}`
              : "Invalid unit type for this branch",
        },
        { status: 400 }
      );
    }

    const db = await getDb();
    const membersCol = getCabinetMembersCollection(db);
    const member = await membersCol.findOne({ countryId, positionId });

    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return NextResponse.json(
        { error: "Only the defence minister may recruit units." },
        { status: 403 }
      );
    }

    // Backfill legacy members missing the action fields (mirrors the order route).
    if (member && member.ministerialActions == null) {
      await membersCol.updateOne({ _id: member._id }, { $set: { ministerialActions: 2 } });
      member.ministerialActions = 2;
    }
    const actions = member?.ministerialActions ?? 2;
    if (actions < 1) {
      return NextResponse.json({ error: "No ministerial actions remaining" }, { status: 400 });
    }

    const region = await db.collection("states").findOne({ countryId }, { projection: { _id: 1 } });
    if (!region) {
      return NextResponse.json(
        { error: "No region available to station the unit" },
        { status: 400 }
      );
    }

    const spend = await membersCol.updateOne(
      { _id: member!._id, ministerialActions: { $gte: 1 } },
      { $inc: { ministerialActions: -1 } }
    );
    if (spend.modifiedCount === 0) {
      return NextResponse.json({ error: "No ministerial actions remaining" }, { status: 409 });
    }

    const refundAction = () =>
      membersCol.updateOne({ _id: member!._id }, { $inc: { ministerialActions: 1 } });

    // Budget existence is checked FIRST, before any resource moves. It is a
    // read/heal, not a spend, so it has no ordering constraint with manpower —
    // and checking it here means a budget-less country never draws 12,000 men
    // only to hand them straight back. One less rollback path to get wrong.
    //
    // `moveTreasury` does NOT upsert, so without a budget doc the charge would
    // silently vanish and the unit would be free. `ensureFederalBudget` returns
    // null when no seed exists for this (preset, country) — refuse rather than gift.
    const healedBudget = await ensureFederalBudget(
      db,
      countryId,
      gameState?.preset ?? DEFAULT_SEED_PRESET
    );

    // Non-null is NOT sufficient. `ensureFederalBudget` looks the doc up by
    // `_id: getNationalBudgetId(countryId)` (ensureFederalBudget.ts:65), but
    // `moveTreasury` reads and writes by `{ countryId }` (treasurySpend.ts:27-29,
    // 52-55). A doc whose countryId field disagrees with its _id — the exact
    // corruption `findFederalBudgetCountryMismatches` exists to detect — would
    // pass a null check and then absorb a zero-match updateOne, producing the
    // free unit this guard exists to prevent. Require the key both sides use.
    if (!healedBudget || healedBudget.countryId !== countryId) {
      await refundAction();
      return NextResponse.json(
        { error: "This country has no usable national budget — procurement is unavailable" },
        { status: 409 }
      );
    }

    // Manpower is the hard block. A new unit is raised at full establishment, so
    // it costs full establishment. Heal a missing pool first — otherwise a newly
    // enabled country reads pool 0 and can never recruit.
    const { pool: poolBefore } = await ensureManpowerPool(db, countryId);

    // An ordinary shortfall is a 400; 409 is reserved for losing the atomic
    // guard to a concurrent order, which is retryable rather than malformed.
    if (poolBefore < archetype.personnel) {
      await refundAction();
      return NextResponse.json(
        {
          error:
            `Insufficient manpower — ${archetype.personnel.toLocaleString("en-US")} required, ` +
            `${poolBefore.toLocaleString("en-US")} available`,
        },
        { status: 400 }
      );
    }

    if (!(await drawManpower(db, countryId, archetype.personnel))) {
      await refundAction();
      return NextResponse.json(
        { error: "Manpower was drawn by another order — try again" },
        { status: 409 }
      );
    }

    // Price is a share of the healed budget's own gdp — ANCHORED, so a growing economy
    // outruns its procurement costs instead of cancelling against them — which lands it in
    // the same units as the appropriation with no conversion.
    //
    // A non-positive or missing gdp returns null and MUST refuse — that is the value that
    // would otherwise make units free (the role a 0 exchange rate played in the abandoned
    // FX design).
    const price = unitPurchasePrice(
      archetype,
      countryId,
      healedBudget.gdp,
      healedBudget.militaryPriceBaselineGdp
    );
    if (price == null) {
      await returnManpower(db, countryId, archetype.personnel);
      await refundAction();
      return NextResponse.json(
        { error: "This country has no usable GDP figure — procurement is unavailable" },
        { status: 409 }
      );
    }

    // Paid from the DEFENCE APPROPRIATION, not the treasury: the enacted defence line has
    // already left `treasuryBalance` via `processTreasuryTurn`, so a treasury debit here
    // would bill the country twice for the same unit.
    //
    // Hard refusal, no overdraft. The overdraft exists for upkeep — an obligation already
    // incurred — whereas a new order must fit inside the balance. This is what replaces the
    // old unlimited borrow against the national treasury.
    if (!(await debitAppropriation(db, countryId, price))) {
      await returnManpower(db, countryId, archetype.personnel);
      await refundAction();
      const { balance } = await getDefenseAppropriation(db, countryId);
      return NextResponse.json(
        {
          error:
            `Defence appropriation is short — ${price.toLocaleString("en-US")} required, ` +
            `${Math.max(0, balance).toLocaleString("en-US")} available`,
        },
        { status: 409 }
      );
    }

    // Issue materiel from the national arsenal. A short store is NOT a refusal: the unit is
    // raised either way and arrives under-equipped, then the per-turn refit brings it up to
    // standard as deliveries land. Scarcity degrades quality and speed; it never presents a
    // dead button.
    const neededLots = lotsRequired(archetype);
    const arsenal = await getNationalArsenal(db, countryId);
    const drawnLots = await drawLots(db, countryId, branch.domain, neededLots);
    const issued = equipUnit(drawnLots, neededLots, arsenal.grade[branch.domain] ?? 0);

    try {
      const buildDuration =
        archetype.type === "Carrier Strike Group" ? CARRIER_BUILD_TURNS : BUILD_TURNS;
      await getMilitaryUnitsCollection(db).insertOne({
        _id: new ObjectId(),
        countryId,
        branchId: branch.id,
        domain: branch.domain,
        name: parsed.data.name.trim(),
        type: archetype.type,
        icon: archetype.icon,
        posture: "standard",
        // Both now come from what the country's industry could actually supply, rather than
        // the hardcoded `1` / `{1,1,1}` that made `equipment` a field nothing could move.
        techTier: issued.techTier,
        personnel: archetype.personnel,
        readiness: 70,
        basePower: archetype.power,
        upkeepBase: archetype.upkeep,
        vet: 1,
        xp: 0,
        equipment: issued.equipment,
        drill: null,
        theaterId: "reserve",
        assignedGeneralId: null,
        createdTurn: currentTurn,
        readyAtTurn: currentTurn + buildDuration,
      });
    } catch (error) {
      // Unwind in the reverse order of acquisition. The lots go back first because they are
      // the only resource here that another order could take in the meantime.
      await returnLots(db, countryId, branch.domain, drawnLots);
      await creditAppropriation(db, countryId, price);
      await returnManpower(db, countryId, archetype.personnel);
      await refundAction();
      throw error;
    }

    const { balance: appropriationRemaining } = await getDefenseAppropriation(db, countryId);
    return NextResponse.json({
      success: true,
      actionsRemaining: actions - 1,
      price,
      appropriationRemaining,
      // Derived from poolBefore — re-reading would repeat the stance and
      // population queries for a value already known.
      manpowerRemaining: poolBefore - archetype.personnel,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
