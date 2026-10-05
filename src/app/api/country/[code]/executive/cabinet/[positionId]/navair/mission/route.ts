// POST /api/country/[code]/executive/cabinet/[positionId]/navair/mission
// Set a naval or air formation's STANDING mission, and optionally move it to a station.
// The mission persists between turns; only a command changes it. Auth mirrors the other
// battle actions (theater commander where designated, otherwise the defense holder,
// admin always).
// Errors: 400, 401, 403, 404.
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { authorizeBattleAction } from "@/lib/api/battleAuthz";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { isMissionValidFor, missionNeedsTarget } from "@/lib/navair/missions";
import { region as regionOf, isWaterAccessible, isNavigable } from "@/lib/navair/map";
import type { CountryId } from "@/lib/constants/countries";

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

// The body is untrusted, so the shape is enforced at runtime here rather than by the
// TypeScript types, which say nothing once this is running. A non-string would otherwise
// reach a lookup or a template and fail somewhere less obvious. `min(1)` because an empty
// id is never a real region or unit, and the messages are written for a human because
// this client shows the server's reason verbatim.
const missionSchema = z
  .object({
    unitId: z.string().min(1, "A formation is required."),
    mission: z.string().min(1, "A mission is required.").optional(),
    station: z.string().min(1, "station must be a region id.").optional(),
    missionTarget: z.string().min(1, "missionTarget must be a region id.").optional(),
  })
  // `mission` is optional because the station dropdown orders a move on its own
  // (`send(f.id, { station })` in NavairCommandClient) and a move is not a change
  // of orders. One of the two still has to be present, or the request asks for
  // nothing.
  .refine((b) => b.mission !== undefined || b.station !== undefined, {
    message: "An order must set a mission, a station, or both.",
  });

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const ctx = await authorizeBattleAction(params);
    if (ctx.error) return ctx.error;
    const { db, countryId } = ctx;

    const parsed = await parseJsonBody(request, missionSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const body = parsed.data;

    if (!ObjectId.isValid(body.unitId)) {
      return errorResponse(404, "Unknown formation.");
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
      return errorResponse(404, "Unknown formation.");
    }

    if (unit.domain !== "naval" && unit.domain !== "air") {
      return errorResponse(400, "Only naval and air formations take a mission.");
    }

    if (body.mission !== undefined && !isMissionValidFor(unit.domain, body.mission)) {
      // Never inferred from the client: a naval formation on an air mission falls through
      // to the flying-weights fallback and quietly fights at half value forever, with
      // nothing in the interface to say why.
      return errorResponse(
        400,
        `${body.mission} is not a mission a ${unit.domain} formation can fly.`
      );
    }

    const update: Record<string, unknown> = {};
    if (body.mission !== undefined) update.mission = body.mission;

    if (body.station !== undefined) {
      const target = regionOf(body.station);
      if (!target) {
        return errorResponse(400, "Unknown region.");
      }
      // A fleet cannot be stationed on dry land. Air formations can operate from anywhere
      // with an airbase, which every region has to some degree, so only naval is gated.
      if (unit.domain === "naval" && !isWaterAccessible(body.station)) {
        return errorResponse(400, `${target.name} is not water a fleet can operate in.`);
      }
      if (unit.domain === "naval" && !isNavigable(body.station)) {
        return errorResponse(400, `${target.name} has no port a fleet can work out of.`);
      }
      update.station = body.station;
      // Flag it as a command decision. The turn pass re-derives every machine-assigned
      // station each tick, and must not overwrite an order a commander actually gave.
      update.stationSetByPlayer = true;
    }

    // Only a change of orders touches the target. A station-only move leaves the
    // standing mission and its target exactly as they were: blanking the target
    // here would silently disarm a strike the commander never countermanded.
    if (body.mission !== undefined) {
      if (missionNeedsTarget(body.mission)) {
        if (!body.missionTarget || !regionOf(body.missionTarget)) {
          return errorResponse(400, "A strike mission needs a target region.");
        }
        update.missionTarget = body.missionTarget;
      } else {
        // Clear a stale target rather than leaving one attached to a mission that does not
        // read it, or switching back to a strike later would silently reuse an old target.
        update.missionTarget = null;
      }
    }

    await units.updateOne({ _id: unit._id }, { $set: update });

    return NextResponse.json({
      ok: true,
      unitId: String(unit._id),
      mission: body.mission ?? unit.mission ?? null,
      station: update.station ?? unit.station ?? null,
      // The order stands from the next turn: this does not resolve anything now.
      note: "Standing order set. It takes effect at the next turn.",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
