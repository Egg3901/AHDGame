// POST /api/country/[code]/executive/cabinet/[positionId]/military/[unitId]/upgrade
// Auth: defense holder or admin. Costs 1 ministerial action AND a debit against the
// defence appropriation (NOT the treasury) priced off the unit's build cost.
// Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { DEFENSE_POSITION_BY_COUNTRY, getUnitArchetype } from "@/lib/constants/military";
import { unitUpgradePrice } from "@/lib/military/procurement";
import {
  debitAppropriation,
  creditAppropriation,
  getDefenseAppropriation,
} from "@/lib/db/collections/defenseAppropriation";
import { ensureFederalBudget } from "@/lib/turn/ensureFederalBudget";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { getGameState } from "@/lib/gameState";

interface RouteParams {
  params: Promise<{ code: string; positionId: string; unitId: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId, unitId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (DEFENSE_POSITION_BY_COUNTRY[countryId] !== positionId) {
      return NextResponse.json({ error: "Not a defense cabinet position" }, { status: 404 });
    }
    if (!ObjectId.isValid(unitId)) {
      return NextResponse.json({ error: "Invalid unit id" }, { status: 400 });
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
        { error: "Only the defence minister may upgrade units." },
        { status: 403 }
      );
    }

    const unitsCol = getMilitaryUnitsCollection(db);
    const unit = await unitsCol.findOne({ _id: new ObjectId(unitId), countryId });
    if (!unit) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }
    // Range-check rather than `>= 3`: a legacy doc with a missing or non-numeric tier
    // would slip past that, reach pricing as NaN, and be refused with an unrelated
    // "no usable GDP" message. Fail closed here, and say what is actually wrong.
    if (!Number.isInteger(unit.techTier) || unit.techTier < 0 || unit.techTier > 3) {
      return NextResponse.json({ error: "This unit has no valid tech tier" }, { status: 409 });
    }
    if (unit.techTier >= 3) {
      return NextResponse.json({ error: "Unit is already cutting-edge" }, { status: 400 });
    }

    if (member && member.ministerialActions == null) {
      await membersCol.updateOne({ _id: member._id }, { $set: { ministerialActions: 2 } });
      member.ministerialActions = 2;
    }
    if ((member?.ministerialActions ?? 2) < 1) {
      return NextResponse.json({ error: "No ministerial actions remaining" }, { status: 400 });
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

    // Modernising is a purchase, not a free reclassification. Priced off the unit's own
    // build cost through the same GDP-share model recruiting uses, so the two are
    // quoted in one unit and a player can compare upgrading against building new.
    //
    // Budget is resolved BEFORE anything moves: `moveTreasury` does not upsert, so
    // without a usable doc the charge would silently vanish and the upgrade would be
    // free — which is the defect this route is being changed to fix.
    const gameState = await getGameState();
    const healedBudget = await ensureFederalBudget(
      db,
      countryId,
      gameState?.preset ?? DEFAULT_SEED_PRESET
    );
    // Non-null is not sufficient — `ensureFederalBudget` looks up by `_id` while
    // `moveTreasury` reads and writes by `{ countryId }`. A doc whose fields disagree
    // would pass a null check and then absorb a zero-match update.
    if (!healedBudget || healedBudget.countryId !== countryId) {
      await refundAction();
      return NextResponse.json(
        { error: "This country has no usable national budget — modernisation is unavailable" },
        { status: 409 }
      );
    }

    const nextTier = (unit.techTier + 1) as 1 | 2 | 3;
    const archetype = getUnitArchetype(unit.domain, unit.type);
    if (!archetype) {
      await refundAction();
      return NextResponse.json(
        { error: "This unit's type is not in the procurement catalogue" },
        { status: 409 }
      );
    }
    const price = unitUpgradePrice(
      archetype,
      countryId,
      healedBudget.gdp,
      nextTier,
      healedBudget.militaryPriceBaselineGdp
    );
    if (price == null) {
      await refundAction();
      return NextResponse.json(
        { error: "This country has no usable GDP figure — modernisation is unavailable" },
        { status: 409 }
      );
    }

    // Paid from the defence appropriation, not the treasury — the enacted defence line has
    // already left `treasuryBalance` via `processTreasuryTurn`. Hard refusal with no
    // overdraft: that is reserved for upkeep, an obligation already incurred.
    if (!(await debitAppropriation(db, countryId, price))) {
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

    try {
      await unitsCol.updateOne({ _id: unit._id, countryId }, { $set: { techTier: nextTier } });
    } catch (error) {
      await creditAppropriation(db, countryId, price);
      await refundAction();
      throw error;
    }

    const { balance: appropriationRemaining } = await getDefenseAppropriation(db, countryId);
    return NextResponse.json({ success: true, techTier: nextTier, price, appropriationRemaining });
  } catch (error) {
    return handleRouteError(error);
  }
}
