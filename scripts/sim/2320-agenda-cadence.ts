/**
 * Controlled issue #2320 cadence comparison. This describes agenda trigger timing
 * only; it does not execute game policy or predict a world simulation.
 */

import { TURNS_PER_YEAR } from "../../src/lib/constants/turnTime";
import {
  agendaReviewSnapshot,
  annualPerformanceReviewDue,
  shouldRecomputeGoverningAgenda,
} from "../../src/lib/nppAutonomy/rules/agendaReview";
import type { ConditionsSignal } from "../../src/lib/nppAutonomy/selectNppBill";
import type { CrisisAgendaIntake } from "../../src/lib/nppAutonomy/rules/crisisAgendaSignals";
import type { GoverningAgenda } from "../../src/lib/nppAutonomy/governingAgenda";

function observedAt(turn: number) {
  const conditions: ConditionsSignal = {
    weakDomains: { healthcare: turn >= 102 ? 0.55 : 0.2 },
    strongDomains: {},
    inflationRate: 4,
  };
  const crisis: CrisisAgendaIntake =
    turn >= 126
      ? { signals: {}, latestStartTurn: 24, effectFingerprintByDomain: {} }
      : turn >= 78
        ? {
            signals: { healthcare: 1 },
            latestStartTurn: 24,
            effectFingerprintByDomain: { healthcare: "rung=2;current-effect=-4" },
          }
        : turn >= 24
          ? {
              signals: { healthcare: 1 },
              latestStartTurn: 24,
              effectFingerprintByDomain: { healthcare: "rung=1;current-effect=-1" },
            }
          : { signals: {}, latestStartTurn: 0, effectFingerprintByDomain: {} };
  return { conditions, crisis };
}

export function runCurrentAgendaPolicy(): number[] {
  let computedTurn: number | undefined;
  const updates: number[] = [];
  for (let turn = 0; turn <= 240; turn += 6) {
    const { crisis } = observedAt(turn);
    const due =
      computedTurn === undefined ||
      turn - computedTurn >= 168 ||
      (Object.keys(crisis.signals).length > 0 && crisis.latestStartTurn > computedTurn);
    if (due) {
      updates.push(turn);
      computedTurn = turn;
    }
  }
  return updates;
}

export function runCandidateAgendaPolicy(): number[] {
  let agenda: GoverningAgenda | undefined;
  const updates: number[] = [];
  for (let turn = 0; turn <= 240; turn += 6) {
    const input = observedAt(turn);
    if (
      shouldRecomputeGoverningAgenda({
        agenda,
        currentTurn: turn,
        intervalTurns: TURNS_PER_YEAR,
        ...input,
      })
    ) {
      updates.push(turn);
      const reportDue = annualPerformanceReviewDue(agenda, turn, TURNS_PER_YEAR);
      agenda = {
        items: [],
        archetype: "reformer",
        computedTurn: turn,
        performanceReviewedTurn: reportDue
          ? turn
          : (agenda?.performanceReviewedTurn ?? agenda?.computedTurn ?? turn),
        reviewSnapshot: agendaReviewSnapshot(input.conditions, input.crisis),
      };
    }
  }
  return updates;
}

export function runAgendaCadenceComparison() {
  return {
    turnsPerGameYear: TURNS_PER_YEAR,
    sampledEveryTurns: 6,
    horizonTurns: 240,
    currentAgendaTurns: runCurrentAgendaPolicy(),
    candidateAgendaTurns: runCandidateAgendaPolicy(),
    scope: "agenda trigger timing only; not policy outcomes or worldsim evidence",
  };
}

if (process.argv[1]?.endsWith("2320-agenda-cadence.ts")) {
  process.stdout.write(`${JSON.stringify(runAgendaCadenceComparison(), null, 2)}\n`);
}
