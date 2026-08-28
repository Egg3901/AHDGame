// POST /api/country/[code]/executive/cabinet/[positionId]/navair/mission
// Set a naval or air formation's STANDING mission, and optionally move it to a station.
// The mission persists between turns; only a command changes it. Auth mirrors the other
// battle actions (theater commander where designated, otherwise the defense holder,
// admin always).
// Errors: 400, 401, 403, 404.
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { authorizeBattleAction } from "@/lib/api/battleAuthz";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { isMissionValidFor, missionNeedsTarget } from "@/lib/navair/missions";
import { region as regionOf, isWaterAccessible, isNavigable } from "@/lib/navair/map";
import type { CountryId } from "@/lib/constants/countries";

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const ctx = await authorizeBattleAction(params);
    if (ctx.error) return ctx.error;
    const { db, countryId } = ctx;

    const body = (await request.json().catch(() => null)) as {
      unitId?: string;
      mission?: string;
      station?: string;
      missionTarget?: string;
    } | null;
    if (!body?.unitId || !body?.mission) {
      return NextResponse.json({ error: "unitId and mission are required" }, { status: 400 });
    }

    if (!ObjectId.isValid(body.unitId)) {
      return NextResponse.json({ error: "Unknown formation." }, { status: 404 });
    }

    // Scope the read to the acting country. A commander may only order their own
    // formations, and filtering here rather than after the read means an id belonging to
    // another nation is indistinguishable from one that does not exist, so this cannot be
    // used to probe for another country's units.
    const units = getMilitaryUnitsCollection(db);
    const unit = await units.findOne({
      _id: new ObjectId(body.unitId),
      countryId: countryId as CountryId,
    });
    if (!unit) {
      return NextResponse.json({ error: "Unknown formation." }, { status: 404 });
    }

    if (unit.domain !== "naval" && unit.domain !== "air") {
      return NextResponse.json(
        { error: "Only naval and air formations take a mission." },
        { status: 400 }
      );
    }

    if (!isMissionValidFor(unit.domain, body.mission)) {
      // Never inferred from the client: a naval formation on an air mission falls through
      // to the flying-weights fallback and quietly fights at half value forever, with
      // nothing in the interface to say why.
      return NextResponse.json(
        { error: `${body.mission} is not a mission a ${unit.domain} formation can fly.` },
        { status: 400 }
      );
    }

    const update: Record<string, unknown> = { mission: body.mission };

    if (body.station !== undefined) {
      const target = regionOf(body.station);
      if (!target) {
        return NextResponse.json({ error: "Unknown region." }, { status: 400 });
      }
      // A fleet cannot be stationed on dry land. Air formations can operate from anywhere
      // with an airbase, which every region has to some degree, so only naval is gated.
      if (unit.domain === "naval" && !isWaterAccessible(body.station)) {
        return NextResponse.json(
          { error: `${target.name} is not water a fleet can operate in.` },
          { status: 400 }
        );
      }
      if (unit.domain === "naval" && !isNavigable(body.station)) {
        return NextResponse.json(
          { error: `${target.name} has no port a fleet can work out of.` },
          { status: 400 }
        );
      }
      update.station = body.station;
    }

    if (missionNeedsTarget(body.mission)) {
      if (!body.missionTarget || !regionOf(body.missionTarget)) {
        return NextResponse.json(
          { error: "A strike mission needs a target region." },
          { status: 400 }
        );
      }
      update.missionTarget = body.missionTarget;
    } else {
      // Clear a stale target rather than leaving one attached to a mission that does not
      // read it, or switching back to a strike later would silently reuse an old target.
      update.missionTarget = null;
    }

    await units.updateOne({ _id: unit._id }, { $set: update });

    return NextResponse.json({
      ok: true,
      unitId: String(unit._id),
      mission: body.mission,
      station: update.station ?? unit.station ?? null,
      // The order stands from the next turn: this does not resolve anything now.
      note: "Standing order set. It takes effect at the next turn.",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
