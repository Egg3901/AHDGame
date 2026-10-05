/**
 * Deterministic advertising agreement efficacy report. No world, clock or
 * randomness: it runs the portable attribution and coverage rules over a grid
 * of supplier models and contracted shares for one fixed buyer footprint.
 * Run with `npx tsx scripts/sim/advertisingAgreementsReport.ts`.
 */
import { attributeBuyerSpend } from "@/lib/advertising/rules/attribution";
import {
  MODEL_NATIONAL_REACH,
  buyerOperatingWeights,
  coverageOverlap,
  supplierCoverageByState,
} from "@/lib/advertising/rules/coverage";

const SETTLED_SPEND = 100;
const buyerWeights = buyerOperatingWeights({
  buyerSectors: [
    { stateId: "US-CA", revenue: 600 },
    { stateId: "US-TX", revenue: 300 },
    { stateId: "US-NY", revenue: 100 },
  ],
});
const states = [...buyerWeights.keys()];

const rows = Object.keys(MODEL_NATIONAL_REACH).flatMap((model) =>
  [0, 2500, 5000, 10000].flatMap((shareBps) =>
    [false, true].map((footprint) => {
      const coverage = supplierCoverageByState({
        operatingModels: [model],
        supplierSectors: footprint ? [{ stateId: "US-CA", revenue: 1 }] : [],
        states,
      });
      const overlap = coverageOverlap(buyerWeights, coverage);
      const result = attributeBuyerSpend({
        settledSpendAnchor: SETTLED_SPEND,
        deliveryExists: true,
        agreements:
          shareBps > 0 ? [{ supplierCorpId: "supplier", allocationShareBps: shareBps }] : [],
        coverFractionBySupplier: new Map([["supplier", 1]]),
        deliveredBySupplier: new Map([["supplier", true]]),
        overlapBySupplier: new Map([["supplier", overlap]]),
      });
      return {
        model,
        shareBps,
        supplierHasFootprint: footprint,
        overlap,
        settledSpend: result.settledSpendAnchor,
        contractedSpend: result.contractedSpendAnchor,
        spotSpend: result.spotSpendAnchor,
        effectiveAdvertising: Math.round(result.effectiveAnchor * 1e4) / 1e4,
        spendConserved:
          Math.abs(
            result.contractedSpendAnchor + result.spotSpendAnchor - result.settledSpendAnchor
          ) < 1e-9,
      };
    })
  )
);

console.log(
  JSON.stringify(
    {
      assumptions: {
        settledSpendAnchor: SETTLED_SPEND,
        buyerStates: Object.fromEntries(buyerWeights),
        cashMoved: "none; attribution only, spend is split never added",
      },
      allSpendConserved: rows.every((row) => row.spendConserved),
      maxEfficacy: Math.max(...rows.map((row) => row.effectiveAdvertising / SETTLED_SPEND)),
      rows,
    },
    null,
    2
  )
);
