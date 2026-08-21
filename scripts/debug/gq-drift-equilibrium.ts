/**
 * Audit check for the German Question drift constant.
 *
 * Verifies the plateau and time-to-threshold figures quoted in the design doc
 * (ahd-german-question-design §6) against the implementation, with drift noise
 * disabled so the equilibrium is deterministic.
 */
import {
  SETTLEMENT_INSTITUTIONS,
  CARRY_THRESHOLD,
  LOCK_THRESHOLD,
  HUNDREDTHS,
} from "../../src/lib/constants/settlementCrisis";
import { recomputePosition } from "../../src/lib/settlement/position";
import { rollInstitutionDrift } from "../../src/lib/settlement/drift";
import type { SettlementInstitutionState } from "../../src/lib/db/types/settlementCrisis";

const noiseless = () => 0.5; // unit = 0 → pure mean reversion

function opening(): SettlementInstitutionState[] {
  return SETTLEMENT_INSTITUTIONS.map((i) => ({
    id: i.id,
    weight: i.weight,
    position: i.opening,
    lastPlay: null,
    lastDrift: 0,
  }));
}

/**
 * Run `netPlayPerTurn` (in index hundredths) against drift until it settles or
 * crosses a threshold. Play pressure is spread across institutions by weight so
 * the index moves by exactly the stated amount each turn.
 */
function run(label: string, netPlayPerTurn: number, maxTurns = 400) {
  let inst = opening();
  let crossed: string | null = null;
  let crossedAt = 0;

  for (let turn = 1; turn <= maxTurns; turn++) {
    inst = inst.map((s) => {
      const withPlay = { ...s, position: s.position + netPlayPerTurn };
      const drift = rollInstitutionDrift({
        institutionId: s.id,
        position: withPlay.position,
        rng: noiseless,
      });
      return { ...withPlay, position: Math.max(0, Math.min(10_000, withPlay.position + drift)) };
    });
    const pos = recomputePosition(inst);
    if (!crossed && pos >= CARRY_THRESHOLD) {
      crossed = "CARRY";
      crossedAt = turn;
    }
    if (!crossed && pos <= LOCK_THRESHOLD) {
      crossed = "LOCK";
      crossedAt = turn;
    }
  }

  const plateau = recomputePosition(inst) / HUNDREDTHS;
  console.log(
    `${label.padEnd(26)} net ${(netPlayPerTurn / HUNDREDTHS).toFixed(1).padStart(5)}/turn` +
      `  plateau ${plateau.toFixed(1).padStart(6)}` +
      `  ${crossed ? `${crossed} at turn ${crossedAt}` : "never crossed"}`
  );
}

console.log("German Question — drift equilibrium audit (noise disabled)\n");
console.log(`opening index ${recomputePosition(opening()) / HUNDREDTHS}`);
console.log(`carry ${CARRY_THRESHOLD / HUNDREDTHS}   lock ${LOCK_THRESHOLD / HUNDREDTHS}\n`);

run("East optimal, West idle", 420);
run("Both optimal", 260);
run("West optimal, East idle", -160);
run("Nobody plays", 0);
