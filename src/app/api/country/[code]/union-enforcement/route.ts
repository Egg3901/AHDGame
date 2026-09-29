import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { COUNTRY_CONFIGS, getOfficeTypeConfig, type CountryId } from "@/lib/constants/countries";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { requireConfirmedSecretary } from "@/lib/api/requireConfirmedSecretary";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { Character, Union } from "@/lib/db/types";
import type { UnionOrganizer } from "@/lib/db/types/union";
import {
  undergroundHeat,
  undergroundStrength,
  isUnionExposed,
  RAID_ACTION_COST,
  RAID_COOLDOWN_TURNS,
  RAID_HEAT_THRESHOLD,
  resolveUndergroundRaid,
  PROSECUTION_ACTION_COST,
  PROSECUTION_BAR_TURNS,
  prosecutionStrengthLoss,
} from "@/lib/unions/underground";
import {
  undergroundRaidFine,
  unionEnforcementDelegatePosition,
} from "@/lib/unions/enforcementAuthority";
import { enforcementTreasuryCostPerTurn } from "@/lib/unions/enforcementCosts";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("posture"), posture: z.enum(["tolerant", "normal", "crackdown"]) }),
  z.object({ action: z.literal("investigate"), unionId: z.string() }),
  z.object({ action: z.literal("raid"), unionId: z.string() }),
  z.object({ action: z.literal("prosecute"), unionId: z.string(), characterId: z.string() }),
]);

function heatBracket(heat: number): "low" | "elevated" | "high" {
  if (heat >= 70) return "high";
  if (heat >= 30) return "elevated";
  return "low";
}

interface Context {
  params: Promise<{ code: string }>;
}

async function enforcementAccess(
  db: Awaited<ReturnType<typeof getDb>>,
  countryId: CountryId,
  character: Character,
  mutate: boolean
): Promise<NextResponse | null> {
  const office = character.currentOffice?.type;
  const officeConfig = office ? getOfficeTypeConfig(countryId, office) : null;
  if (character.countryId === countryId && officeConfig?.isExecutive && !officeConfig.isSubNational)
    return null;

  const positionId = unionEnforcementDelegatePosition(countryId);
  const member = positionId
    ? await getCabinetMembersCollection(db).findOne({ countryId, positionId })
    : null;
  if (
    character.countryId !== countryId ||
    !member?.characterId ||
    String(member.characterId) !== String(character._id)
  ) {
    return NextResponse.json(
      { error: "Only the country's executive or delegated minister may enforce a union ban." },
      { status: 403 }
    );
  }
  return mutate ? requireConfirmedSecretary(member, "stance") : null;
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
    if (auth.user.character.countryId !== countryId) {
      return NextResponse.json(
        { error: "Only domestic officials may enforce a union ban." },
        { status: 403 }
      );
    }
    const db = await getDb();
    const denied = await enforcementAccess(db, countryId, auth.user.character, false);
    if (denied) return denied;
    const budget = await db.collection<FederalBudget>("federalBudget").findOne(
      { _id: getNationalBudgetId(countryId) },
      {
        projection: {
          unionsBanned: 1,
          gdp: 1,
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
    const exposed = await db
      .collection<Union>("unions")
      .find(
        { countryId, suspended: true, exposedUntilTurn: { $gte: turn } },
        { projection: { _id: 1 } }
      )
      .toArray();
    const organizers = exposed.length
      ? await db
          .collection<UnionOrganizer>("unionOrganizers")
          .find(
            {
              unionId: { $in: exposed.map((union) => union._id) },
              undergroundStrength: { $gt: 0 },
              barredUntilTurn: { $not: { $gte: turn } },
            },
            { projection: { unionId: 1, characterId: 1 } }
          )
          .toArray()
      : [];
    const characters = organizers.length
      ? await db
          .collection<Character>("characters")
          .find(
            { _id: { $in: organizers.map((organizer) => organizer.characterId) } },
            { projection: { _id: 1, name: 1 } }
          )
          .toArray()
      : [];
    const names = new Map(
      characters.map((candidate) => [candidate._id.toString(), candidate.name])
    );
    return NextResponse.json(
      {
        posture: budget.unionEnforcementPosture ?? "normal",
        canChangePosture: budget.unionEnforcementPostureChangedTurn !== turn,
        crackdownCostPerTurn: enforcementTreasuryCostPerTurn(budget.gdp ?? 0, true, "crackdown"),
        crackdownApprovalPenalty: 2,
        exposedUnionIds: exposed.map((union) => union._id.toString()),
        prosecutionTargets: organizers.map((organizer) => ({
          unionId: organizer.unionId.toString(),
          characterId: organizer.characterId.toString(),
          name: names.get(organizer.characterId.toString()) ?? "Organizer",
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
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
    if (character.countryId !== countryId) {
      return NextResponse.json(
        { error: "Only domestic officials may enforce a union ban." },
        { status: 403 }
      );
    }
    const db = await getDb();
    const denied = await enforcementAccess(db, countryId, character, true);
    if (denied) return denied;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

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

    if (parsed.data.action === "prosecute") {
      if (!union.suspended || !isUnionExposed(union, turn)) {
        return NextResponse.json(
          { error: "Only an exposed cell can be prosecuted." },
          { status: 409 }
        );
      }
      if (!ObjectId.isValid(parsed.data.characterId)) {
        return NextResponse.json({ error: "Invalid organizer ID" }, { status: 400 });
      }
      const organizers = db.collection<UnionOrganizer>("unionOrganizers");
      const organizer = await organizers.findOne({
        unionId: union._id,
        characterId: new ObjectId(parsed.data.characterId),
      });
      if (
        !organizer ||
        !organizer.undergroundStrength ||
        organizer.undergroundStrength <= 0 ||
        (typeof organizer.barredUntilTurn === "number" && organizer.barredUntilTurn >= turn) ||
        organizer.lastProsecutedTurn === turn
      ) {
        return NextResponse.json(
          { error: "Organizer is not eligible for prosecution." },
          { status: 409 }
        );
      }
      const spent = await db
        .collection<Character>("characters")
        .updateOne(
          { _id: character._id, actions: { $gte: PROSECUTION_ACTION_COST } },
          { $inc: { actions: -PROSECUTION_ACTION_COST }, $set: { updatedAt: now } }
        );
      if (!spent.modifiedCount) {
        return NextResponse.json(
          { error: "Prosecution requires three action points." },
          { status: 409 }
        );
      }
      const strengthLoss = prosecutionStrengthLoss(organizer.undergroundStrength);
      const barredUntilTurn = turn + PROSECUTION_BAR_TURNS - 1;
      const prosecutionId = randomUUID();
      let changed;
      try {
        changed = await organizers.updateOne(
          {
            _id: organizer._id,
            undergroundStrength: organizer.undergroundStrength,
            lastProsecutedTurn: organizer.lastProsecutedTurn ?? null,
            barredUntilTurn: { $not: { $gte: turn } },
          },
          {
            $inc: { undergroundStrength: -strengthLoss },
            $set: {
              barredUntilTurn,
              lastProsecutedTurn: turn,
              lastProsecutionId: prosecutionId,
              updatedAt: now,
            },
          }
        );
      } catch (error) {
        const persisted = await organizers.findOne(
          { _id: organizer._id },
          { projection: { lastProsecutionId: 1 } }
        );
        if (persisted?.lastProsecutionId !== prosecutionId) {
          await db
            .collection<Character>("characters")
            .updateOne({ _id: character._id }, { $inc: { actions: PROSECUTION_ACTION_COST } });
        }
        return handleRouteError(error);
      }
      if (!changed.modifiedCount) {
        await db
          .collection<Character>("characters")
          .updateOne({ _id: character._id }, { $inc: { actions: PROSECUTION_ACTION_COST } });
        return NextResponse.json(
          { error: "Organizer changed before prosecution." },
          { status: 409 }
        );
      }
      return NextResponse.json({
        unionId: union._id.toString(),
        characterId: organizer.characterId.toString(),
        strengthLoss,
        barredUntilTurn,
        actionsSpent: PROSECUTION_ACTION_COST,
      });
    }

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
      const fineSeized = undergroundRaidFine(union.treasury);
      let changed;
      try {
        changed = await db.collection<Union>("unions").updateOne(
          {
            _id: union._id,
            countryId,
            suspended: true,
            undergroundStrength: union.undergroundStrength,
            treasury: union.treasury,
            lastUndergroundRaidTurn: union.lastUndergroundRaidTurn ?? null,
            $or: [{ exposedUntilTurn: { $gte: turn } }, { heat: { $gte: RAID_HEAT_THRESHOLD } }],
          },
          {
            $inc: {
              undergroundStrength: outcome.sympathyGain - loss,
              ...(fineSeized > 0
                ? { treasury: -fineSeized, undergroundFinesSeized: fineSeized }
                : {}),
            },
            $set: { lastUndergroundRaidTurn: turn, updatedAt: now },
          }
        );
      } catch (error) {
        // A standalone Mongo deployment cannot wrap these collections in a transaction.
        // If the write failed before applying, return the executive's spent points.
        const persisted = await db
          .collection<Union>("unions")
          .findOne({ _id: union._id, countryId }, { projection: { lastUndergroundRaidTurn: 1 } });
        if (persisted?.lastUndergroundRaidTurn !== turn) {
          await db
            .collection<Character>("characters")
            .updateOne({ _id: character._id }, { $inc: { actions: RAID_ACTION_COST } });
        }
        return handleRouteError(error);
      }
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
        fineSeized,
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
