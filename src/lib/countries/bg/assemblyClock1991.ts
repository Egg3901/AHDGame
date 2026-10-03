/**
 * The Bulgarian scheduler hosts the portable Grand and ordinary term clock.
 * It preserves live campaigns and waits for national certification before
 * starting another cohort. Other presets retain their existing scheduler.
 */
import type { Election } from "@/lib/db/types";
import { buildCanonicalSpawn, justResolvedInSameTurn } from "@/lib/turn/perpetualElections/engine";
import { getSeatIdFromElection } from "@/lib/seats";
import { turnToWallClock } from "@/lib/elections/canonicalCycle";
import { turnToGameMonth, calendarTurn } from "@/lib/utils/gameDate";
import { isBgOrdinaryCapacity } from "./rules/assemblyTransition";
import { bgGrandAssemblyRegularAnchor, planBg1991AssemblyClock } from "./rules/assemblyClock1991";

export function buildBg1991AssemblySpawn(
  input: Parameters<typeof buildCanonicalSpawn>[0],
  authority: { authorized: boolean; nativeGrandAnchorTurn?: number; firstOrdinaryEndTurn?: number }
): Omit<Election, "_id"> | null {
  if (input.ctx.preset !== "1991-default") return buildCanonicalSpawn(input);
  if (justResolvedInSameTurn(input.prev, input.now, input.currentTurn)) return null;
  const plan = planBg1991AssemblyClock({
    currentTurn: input.currentTurn,
    preIterationActive: input.ctx.preIterationActive,
    authorized: authority.authorized,
    firstOrdinaryEndTurn: authority.firstOrdinaryEndTurn,
    previous: input.prev,
    previousOrdinary: !!input.prev && isBgOrdinaryCapacity(input.state, input.prev.totalSeats),
  });
  if (plan.kind === "blocked") return null;
  if (plan.kind === "founding") return buildCanonicalSpawn(input);
  if (plan.kind === "canonical-grand" || plan.kind === "canonical-ordinary") {
    const doc = buildCanonicalSpawn({
      ...input,
      ...(plan.kind === "canonical-grand"
        ? {
            customCycle1EndTurn: bgGrandAssemblyRegularAnchor({
              startingYear: input.ctx.startingYear,
              preIterationTurns: input.ctx.preIterationTurns,
              nativeAnchorTurn: authority.nativeGrandAnchorTurn,
            }),
          }
        : {}),
    });
    if (doc?.endTurn != null) {
      doc.shiftedScheduleEndTurn = doc.endTurn;
      doc.electionYear = turnToGameMonth(
        calendarTurn(doc.endTurn, {
          preIterationTurns: input.ctx.preIterationTurns,
        }),
        input.ctx.startingYear
      ).year;
    }
    return doc;
  }
  return {
    countryId: "BG",
    electionType: "nationalAssembly",
    state: input.state,
    seatId: getSeatIdFromElection({
      countryId: "BG",
      electionType: "nationalAssembly",
      state: input.state,
    }),
    cycle: plan.cycle,
    electionYear: turnToGameMonth(
      calendarTurn(plan.endTurn, { preIterationTurns: input.ctx.preIterationTurns }),
      input.ctx.startingYear
    ).year,
    status: "active",
    totalSeats: input.fallbackTotalSeats,
    startTurn: plan.startTurn,
    primaryEndTurn: plan.primaryEndTurn,
    endTurn: plan.endTurn,
    startTime: input.now,
    primaryEndTime: turnToWallClock(plan.primaryEndTurn, input.now, input.currentTurn),
    endTime: turnToWallClock(plan.endTurn, input.now, input.currentTurn),
    durationHours: plan.endTurn - plan.startTurn,
    primaryDurationHours: plan.primaryEndTurn - plan.startTurn,
    shiftedScheduleEndTurn: plan.endTurn,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
