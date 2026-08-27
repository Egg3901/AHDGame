/**
 * Deterministic exposure probe for tension-gated society events. Run with:
 *
 *   npx tsx scripts/sim/highTensionSocietyEvents.ts
 */
import { WORLD_EVENT_SEED_DEFINITIONS } from "../../src/lib/events/worldEvents/definitions";
import { getEventHandler } from "../../src/lib/events/substrate/registry";
import "../../src/lib/events/worldEvents/handlers/highTensionEvents";

const eventKinds = [
  "worldEvents.panicBuying",
  "worldEvents.bankRun",
  "worldEvents.civilDefenseFever",
  "worldEvents.warScareProtests",
] as const;

console.log("SOCIETY EVENT EXPOSURE PER COUNTRY");
for (const kind of eventKinds) {
  const definition = WORLD_EVENT_SEED_DEFINITIONS.find((candidate) => candidate.kind === kind)!;
  const schedule = definition.schedule?.kind === "window" ? definition.schedule : null;
  const meanGap = schedule ? (schedule.minGapTurns + schedule.maxGapTurns) / 2 : Infinity;
  const handler = getEventHandler(kind)!;
  const fallback = handler.options.find((option) => option.id === handler.defaultOptionId)!;
  let expectedApproval = 0;
  let expectedTreasuryAnchor = 0;
  let expectedDemandTurnPct = 0;
  for (const tier of fallback.outcomeTable) {
    const probability = (tier.maxRoll - tier.minRoll + 1) / 100;
    for (const effect of tier.effects) {
      if (effect.type === "approvalDelta") expectedApproval += effect.delta * probability;
      if (effect.type === "treasuryDelta") {
        expectedTreasuryAnchor += effect.deltaAnchor * probability;
      }
      if (effect.type === "sectorDemandModifier") {
        expectedDemandTurnPct += effect.pct * effect.durationTurns * probability;
      }
    }
  }
  console.log(
    JSON.stringify({
      kind,
      minTension: definition.minTension,
      meanGapTurns: meanGap,
      expectedFiresPer100HighTensionTurns: Number((100 / meanGap).toFixed(2)),
      fallback: handler.defaultOptionId,
      expectedApproval: Number(expectedApproval.toFixed(2)),
      expectedTreasuryAnchor: Number(expectedTreasuryAnchor.toFixed(2)),
      expectedDemandTurnPct: Number(expectedDemandTurnPct.toFixed(2)),
    })
  );
}
