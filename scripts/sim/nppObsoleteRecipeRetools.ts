/** Bounded replay of normal corrective retools, not a world-profit forecast. */
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import type { CorporateSector, SectorBuildOrder } from "../../src/lib/db/types";
import { makeCorporation } from "../../src/lib/test-utils/factories";
import {
  getEffectiveStrategyRatesForOperatingModel,
  getStrategyForOperatingModel,
  STRATEGY_TRANSITION_TURNS,
} from "../../src/lib/constants/sectorStrategies";
import {
  revenuePerCapacityUnitForStrategy,
  unitYieldForSupply,
} from "../../src/lib/constants/capacityEconomy";
import { retoolOperatingCapacityRatio } from "../../src/lib/corporations/retooling/rules";
import { chooseNppStrategyRetool } from "../../src/lib/turn/npp/strategyRetooling";

const identities = [
  { sectorType: "media", mediaDiscriminator: "entertainment", strategyId: "legacy_broadcast" },
  { sectorType: "manufacturing", industryModel: "vehicles", strategyId: "heavy_metals" },
  {
    sectorType: "manufacturing",
    industryModel: "vehicles",
    strategyId: "electronics_manufacturing",
  },
] as const;
const close = (a: number, b: number) =>
  assert(Math.abs(a - b) <= Math.max(1, Math.abs(b)) * 1e-10, `${a} != ${b}`);
let cases = 0;
let blendSamples = 0;
for (const currentYear of [1953, 1994, 2027])
  for (const techTreesEnabled of [false, true])
    for (const plantsEnabled of [false, true])
      for (const identity of identities) {
        cases++;
        const s = {
          _id: new ObjectId("000000000000000000000101"),
          corporationId: new ObjectId("000000000000000000000100"),
          stateId: "NY",
          countryId: "US",
          ...identity,
          capitalStock: 1_000,
          otherOpexPerUnitAnchor: 8,
          buildQueue: [
            { unitsOrdered: 100, costPaidAnchor: 1_000, startTurn: 90, onlineTurn: 120 },
          ],
        } as CorporateSector;
        const before = JSON.stringify(s);
        const decision = chooseNppStrategyRetool({
          corp: makeCorporation({
            _id: s.corporationId,
            ceoType: "npp",
            type: s.sectorType,
            industryModel: s.industryModel,
            mediaDiscriminator: s.mediaDiscriminator,
          }),
          sectors: [s],
          divestedSectorIds: [],
          turn: 100,
          now: new Date("1994-01-01T00:00:00Z"),
          currentYear,
          techTreesEnabled,
          plantsEnabled,
          priceRatioOf: () => null,
        });
        assert(decision);
        assert.equal(JSON.stringify(s), before);
        assert.equal(decision.updates.strategyId, "standard");
        assert.equal(decision.updates.transitionFromStrategyId, s.strategyId);
        assert(!("liquidCapital" in decision.updates));
        assert(!("unlockedTechNodeIds" in decision.updates));
        if (!plantsEnabled) {
          for (const key of ["capitalStock", "buildQueue", "otherOpexPerUnitAnchor"])
            assert(!(key in decision.updates));
          assert.equal(decision.updates.retoolRescaleApplied, false);
          continue;
        }
        const after = { ...s, ...decision.updates } as CorporateSector;
        const rpu = (id: string) =>
          revenuePerCapacityUnitForStrategy(
            s.sectorType,
            id,
            1,
            s.industryModel,
            s.mediaDiscriminator
          );
        const paidValue = 1_000 * rpu(s.strategyId!);
        close(after.capitalStock! * rpu("standard"), paidValue);
        close(after.capitalStock! * after.otherOpexPerUnitAnchor!, 8_000);
        const order = (after.buildQueue as SectorBuildOrder[])[0];
        close(order.unitsOrdered * rpu("standard"), 100 * rpu(s.strategyId!));
        assert.equal(order.costPaidAnchor, 1_000);
        assert.equal(order.onlineTurn, 120);
        for (let elapsed = 0; elapsed <= STRATEGY_TRANSITION_TURNS; elapsed++) {
          blendSamples++;
          const turn = 100 + elapsed;
          const rates = getEffectiveStrategyRatesForOperatingModel(
            after.sectorType,
            after.strategyId!,
            after.transitionFromStrategyId,
            after.transitionStartTurn,
            turn,
            after.industryModel,
            after.mediaDiscriminator
          );
          const operating =
            after.capitalStock! * retoolOperatingCapacityRatio({ ...after, currentTurn: turn });
          close(operating / unitYieldForSupply(rates.supply, 1), paidValue);
          if (elapsed === 0) {
            const original = getStrategyForOperatingModel(
              s.sectorType,
              s.strategyId!,
              s.industryModel,
              s.mediaDiscriminator
            );
            for (const side of ["supply", "demand"] as const) {
              for (const key of new Set([
                ...Object.keys(rates[side]),
                ...Object.keys(original[side]),
              ])) {
                const commodity = key as keyof typeof rates.supply;
                close(
                  operating * (rates[side][commodity] ?? 0),
                  1_000 * (original[side][commodity] ?? 0)
                );
              }
            }
          }
        }
      }
console.log(
  JSON.stringify({
    passed: true,
    cases,
    blendSamples,
    limitation:
      "Synthetic normal-transition replay. Preserves paid capacity/queue/opex, not future profits, advertising eligibility or policy modifiers after a legitimate recipe change. No database writes or historical compensation.",
  })
);
