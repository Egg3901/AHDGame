import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { COUNTRY_CONFIGS, getOfficeTypeConfig, type CountryId } from "@/lib/constants/countries";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { Character, Union } from "@/lib/db/types";
import {
  undergroundHeat,
  undergroundStrength,
  isUnionExposed,
  RAID_ACTION_COST,
  RAID_COOLDOWN_TURNS,
  RAID_HEAT_THRESHOLD,
  resolveUndergroundRaid,
} from "@/lib/unions/underground";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("posture"), posture: z.enum(["tolerant", "normal", "crackdown"]) }),
  z.object({ action: z.literal("investigate"), unionId: z.string() }),
  z.object({ action: z.literal("raid"), unionId: z.string() }),
]);

function heatBracket(heat: number): "low" | "elevated" | "high" {
  if (heat >= 70) return "high";
  if (heat >= 30) return "elevated";
  return "low";
}

interface Context {
  params: Promise<{ code: string }>;
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    const character = auth.user.character;
    const office = character.currentOffice?.type;
    const officeConfig = office ? getOfficeTypeConfig(countryId, office) : null;
    if (
      character.countryId !== countryId ||
      !officeConfig?.isExecutive ||
      officeConfig.isSubNational
    ) {
      return NextResponse.json(
        { error: "Only the country's executive may enforce a union ban." },
        { status: 403 }
      );
    }
    const db = await getDb();
    const budget = await db.collection<FederalBudget>("federalBudget").findOne(
      { _id: getNationalBudgetId(countryId) },
      {
        projection: {
          unionsBanned: 1,
          unionEnforcementPosture: 1,
          unionEnforcementPostureChangedTurn: 1,
        },
      }
    );
    if (!budget?.unionsBanned) {
      return NextResponse.json(
        { error: "Union enforcement is available only during an active ban." },
        { status: 409 }
      );
    }
    const turn = await getCurrentTurn(db);
    return NextResponse.json({
      posture: budget.unionEnforcementPosture ?? "normal",
      canChangePosture: budget.unionEnforcementPostureChangedTurn !== turn,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const rate = checkRateLimit(`union-enforcement:${auth.user.userId}`, 12, 60000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    const character = auth.user.character;
    const office = character.currentOffice?.type;
    const officeConfig = office ? getOfficeTypeConfig(countryId, office) : null;
    if (
      character.countryId !== countryId ||
      !officeConfig?.isExecutive ||
      officeConfig.isSubNational
    ) {
      return NextResponse.json(
        { error: "Only the country's executive may enforce a union ban." },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const budgetId = getNationalBudgetId(countryId);
    const budgets = db.collection<FederalBudget>("federalBudget");
    const budget = await budgets.findOne({ _id: budgetId }, { projection: { unionsBanned: 1 } });
    if (!budget?.unionsBanned) {
      return NextResponse.json(
        { error: "Union enforcement is available only during an active ban." },
        { status: 409 }
      );
    }

    const turn = await getCurrentTurn(db);
    const now = new Date();
    if (parsed.data.action === "posture") {
      const result = await budgets.updateOne(
        { _id: budgetId, unionsBanned: true, unionEnforcementPostureChangedTurn: { $ne: turn } },
        {
          $set: {
            unionEnforcementPosture: parsed.data.posture,
            unionEnforcementPostureChangedTurn: turn,
            updatedAt: now,
          },
        }
      );
      if (!result.modifiedCount) {
        return NextResponse.json(
          { error: "The posture already changed this turn, or the ban ended." },
          { status: 409 }
        );
      }
      return NextResponse.json({ posture: parsed.data.posture, changedTurn: turn });
    }

    if (!ObjectId.isValid(parsed.data.unionId)) {
      return NextResponse.json({ error: "Invalid union ID" }, { status: 400 });
    }
    const union = await db.collection<Union>("unions").findOne({
      _id: new ObjectId(parsed.data.unionId),
      countryId,
    });
    if (!union) return NextResponse.json({ error: "Union not found" }, { status: 404 });

    if (parsed.data.action === "raid") {
      if (
        !union.suspended ||
        (!isUnionExposed(union, turn) && undergroundHeat(union) < RAID_HEAT_THRESHOLD) ||
        (typeof union.lastUndergroundRaidTurn === "number" &&
          turn < union.lastUndergroundRaidTurn + RAID_COOLDOWN_TURNS)
      ) {
        return NextResponse.json(
          { error: "This cell is not eligible for a raid." },
          { status: 409 }
        );
      }
      const loss = Math.min(undergroundStrength(union), 10);
      const spent = await db
        .collection<Character>("characters")
        .updateOne(
          { _id: character._id, actions: { $gte: RAID_ACTION_COST } },
          { $inc: { actions: -RAID_ACTION_COST }, $set: { updatedAt: now } }
        );
      if (!spent.modifiedCount) {
        return NextResponse.json({ error: "Raid requires two action points." }, { status: 409 });
      }
      const outcome = resolveUndergroundRaid(
        undergroundStrength(union),
        Math.floor(Math.random() * 100) + 1
      );
      const changed = await db.collection<Union>("unions").updateOne(
        {
          _id: union._id,
          countryId,
          suspended: true,
          undergroundStrength: union.undergroundStrength,
          lastUndergroundRaidTurn: union.lastUndergroundRaidTurn ?? null,
          $or: [{ exposedUntilTurn: { $gte: turn } }, { heat: { $gte: RAID_HEAT_THRESHOLD } }],
        },
        {
          $inc: { undergroundStrength: outcome.sympathyGain - loss },
          $set: { lastUndergroundRaidTurn: turn, updatedAt: now },
        }
      );
      if (!changed.modifiedCount) {
        await db
          .collection<Character>("characters")
          .updateOne({ _id: character._id }, { $inc: { actions: RAID_ACTION_COST } });
        return NextResponse.json(
          { error: "The cell changed before the raid could proceed." },
          { status: 409 }
        );
      }
      return NextResponse.json({
        unionId: union._id.toString(),
        strengthLoss: outcome.strengthLoss,
        sympathyGain: outcome.sympathyGain,
        cooldownUntilTurn: turn + RAID_COOLDOWN_TURNS,
        actionsSpent: RAID_ACTION_COST,
      });
    }

    const spent = await db
      .collection<Character>("characters")
      .updateOne(
        { _id: character._id, actions: { $gte: 1 } },
        { $inc: { actions: -1 }, $set: { updatedAt: now } }
      );
    if (!spent.modifiedCount) {
      return NextResponse.json(
        { error: "Investigation requires one action point." },
        { status: 409 }
      );
    }
    return NextResponse.json({
      unionId: union._id.toString(),
      heat: heatBracket(undergroundHeat(union)),
      actionsSpent: 1,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
