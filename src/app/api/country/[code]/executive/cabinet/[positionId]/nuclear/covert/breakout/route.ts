// POST /api/country/[code]/executive/cabinet/[positionId]/nuclear/covert/breakout
//
// The breakout test: the banked device goes off, and the covert programme
// becomes an overt one. Opens (or updates) the real nuclearPrograms doc with
// the fission device adopted, spikes tension harder than any ordinary test,
// shocks the deterrence board, and goes out on the wire. Breakout is once.
//
// Auth: defence cabinet holder or admin. Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import type { Filter } from "mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { applyBoardDelta } from "@/lib/politicalLegislation/boardWrite";
import { applyTensionEvent } from "@/lib/coldwar/tension";
import { createSystemNewsPost } from "@/lib/news";
import { getNuclearProgram, putNuclearProgram } from "@/lib/db/collections/nuclearPrograms";
import {
  getCovertNuclearProgram,
  putCovertNuclearProgram,
} from "@/lib/db/collections/covertNuclearPrograms";
import {
  BREAKOUT_DETERRENCE_SHOCK,
  BREAKOUT_TENSION_SPIKE,
  COVERT_CAPABLE,
} from "@/lib/military/covertNuclear";
import { loadGameStateSlice, requireDefenceHolder, type NuclearRouteParams } from "../../shared";

export async function POST(request: Request, { params }: NuclearRouteParams) {
  try {
    const { code, positionId } = await params;
    const guard = await requireDefenceHolder(code, positionId);
    if ("error" in guard) return guard.error;
    const { db, countryId } = guard;

    const gs = await loadGameStateSlice(db);
    if (!COVERT_CAPABLE.includes(countryId) || gs?.coldWarEnabled !== true) {
      return NextResponse.json({ eligible: false }, { status: 404 });
    }

    const covert = await getCovertNuclearProgram(db, countryId);
    if (!covert.completed) {
      return NextResponse.json({ error: "No device has been assembled." }, { status: 409 });
    }
    if (covert.brokenOutTurn != null) {
      return NextResponse.json(
        { error: "The breakout test has already been conducted." },
        { status: 409 }
      );
    }

    const turn = gs.currentTurn ?? 0;

    // Open the overt programme: the fission device adopts as if tested, and
    // any warheads a prior programme somehow held are kept, not clobbered.
    const overt = await getNuclearProgram(db, countryId);
    await putNuclearProgram(db, {
      ...overt,
      adopted: { ...overt.adopted, "device-fission": turn },
      lastTestTurn: turn,
    });
    await putCovertNuclearProgram(db, { ...covert, brokenOutTurn: turn });

    const countryName = COUNTRY_CONFIGS[countryId].name;
    const tension = await applyTensionEvent(
      db,
      turn,
      "nuclear-test",
      "East Germany detonates a nuclear device",
      BREAKOUT_TENSION_SPIKE
    );
    // Country-wide VALUE shock on the deterrence family, same helper and mode
    // as the overt test route; never a dotted $inc.
    await applyBoardDelta(
      db,
      { countryId } as Filter<PoliticalMetricsDoc>,
      "order.deterrence",
      BREAKOUT_DETERRENCE_SHOCK,
      "value"
    );
    await createSystemNewsPost(
      `${countryName} has detonated a nuclear device at a test range without prior announcement. No capital had the programme on its books. The balance of the continent changed overnight.`,
      "executive",
      { title: `${countryName} Detonates Nuclear Device` }
    );

    return NextResponse.json({
      brokenOutTurn: turn,
      adopted: { ...overt.adopted, "device-fission": turn },
      tension: tension.value,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
