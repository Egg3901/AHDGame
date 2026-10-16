/**
 * Consumer rankings must reconcile with the world ledger's global demand.
 *
 * The ledger (`computeRawSupplyDemand`) divides each sector's revenue by its own
 * realized price leg as the input-demand phase-in advances. The commodity page
 * leaderboard and the corporation tab share `computeSectorCommodityUnits`; when
 * that chain skipped the deflator, per-corporation demand stayed on the
 * pre-correction basis and the "Top consumers" rows summed past the global
 * demand figure shown in the header.
 */
import { describe, expect, it } from "vitest";
import { COMMODITY_TYPES, computeRawSupplyDemand } from "@/lib/constants/commodities";
import type { CommodityType } from "@/lib/constants/commodities";
import type { CorpCommodityFlowContext } from "@/lib/corporations/corpCommodityFlows";
import { INPUT_DEMAND_REAL_PHASE_TURNS } from "@/lib/market/inputDemandRealPhase";
import {
  aggregateRealizedCommodityVolumes,
  realizedTotalTolerance,
} from "./realizedCommodityBasis";
import type { RealizedLeaderboardSector } from "./realizedCommodityBasis";

const TURN = 240;
/** A 1991-era preset: the ledger resolves standard-strategy recipes the way the display chain does. */
const PRESET = "1991-default";

const mk = (
  corporationId: string,
  sectorType: string,
  revenue: number,
  priceLeg: number | null,
  over: Partial<RealizedLeaderboardSector> = {}
): RealizedLeaderboardSector & { sectorId: string } => ({
  sectorId: `${corporationId}-${sectorType}`,
  sectorType,
  stateId: "CA",
  countryId: "US",
  revenue,
  revenueAnchor: revenue,
  strategyId: "standard",
  transitionFromStrategyId: null,
  transitionStartTurn: null,
  priceLeg,
  producedUnits: 800,
  capacityUnits: 1_000,
  corporationId,
  ...over,
});

const sectors = [
  mk("a", "manufacturing", 4_000_000, 1.8),
  mk("b", "manufacturing", 2_500_000, 1.3),
  mk("c", "energy", 3_000_000, 2.2),
  mk("d", "technology", 1_500_000, null),
  mk("e", "manufacturing", 900_000, 0.7),
];

function ledgerGlobalDemand(
  commodity: CommodityType,
  phase: number,
  ledgerSectors: typeof sectors = sectors
): number {
  const ledger = computeRawSupplyDemand(
    // The leaderboard sector shape carries nullable fields the ledger input types as optional.
    ledgerSectors as unknown as Parameters<typeof computeRawSupplyDemand>[0],
    undefined, // gdpGrowthData
    undefined, // stateGdpMap
    TURN,
    undefined, // primeRates
    undefined, // extractionMultipliers
    false, // extractionOutputScaleEnabled
    undefined, // sectorDemandModifierPct
    false, // suppressRetailConsumerDemand
    true, // plantsEnabled
    1, // ledgerUnitScale
    undefined, // sectorOutputDemandModifierPct
    1, // retailLegacyDemandFactor
    undefined, // ledgerBasePrices
    undefined, // demandCalibration
    PRESET, // preset
    undefined, // sectorUnitsOut
    undefined, // retailGdpParams
    phase // inputDemandRealPhase
  );
  return ledger.global.get(commodity)?.demand ?? 0;
}

/**
 * Corporate input demand only: the ledger total minus what it books with no
 * sectors at all (the stabilizer floor and the turn-driven unowned drift).
 */
function ledgerCorporateDemand(commodity: CommodityType, phase: number): number {
  return ledgerGlobalDemand(commodity, phase) - ledgerGlobalDemand(commodity, phase, []);
}

function leaderboardDemand(commodity: CommodityType, phase: number): number {
  const context: CorpCommodityFlowContext = {
    plantsEnabled: true,
    eraUnitScale: 1,
    preset: PRESET,
    inputDemandRealPhase: phase,
  };
  const { demandByCorp } = aggregateRealizedCommodityVolumes(sectors, commodity, TURN, context);
  return [...demandByCorp.values()].reduce((sum, units) => sum + units, 0);
}

describe("commodity consumers reconcile with ledger global demand", () => {
  const demanded = COMMODITY_TYPES.filter((c) => leaderboardDemand(c, 1) > 0);

  it("exercises several demanded commodities", () => {
    expect(demanded.length).toBeGreaterThanOrEqual(3);
  });

  for (const progress of [0, 0.5, 1]) {
    it(`sums consumers to the ledger corporate demand at phase progress ${progress}`, () => {
      for (const commodity of demanded) {
        const ledger = ledgerCorporateDemand(commodity, progress);
        const rows = leaderboardDemand(commodity, progress);
        expect(Math.abs(rows - ledger)).toBeLessThanOrEqual(
          Math.max(realizedTotalTolerance(sectors.length), ledger * 1e-9)
        );
      }
    });
  }

  it("negative control: omitting the phase leaves rows above the corrected total", () => {
    const withPhase = demanded.reduce((sum, c) => sum + leaderboardDemand(c, 1), 0);
    const legacy = demanded.reduce((sum, c) => sum + leaderboardDemand(c, 0), 0);
    expect(legacy).not.toBeCloseTo(withPhase, 3);
  });

  it("is a no-op before the phase starts", () => {
    expect(INPUT_DEMAND_REAL_PHASE_TURNS).toBeGreaterThan(0);
    for (const commodity of demanded) {
      const noContext = aggregateRealizedCommodityVolumes(sectors, commodity, TURN, {
        plantsEnabled: true,
        eraUnitScale: 1,
        preset: PRESET,
      });
      const explicitZero = aggregateRealizedCommodityVolumes(sectors, commodity, TURN, {
        plantsEnabled: true,
        eraUnitScale: 1,
        preset: PRESET,
        inputDemandRealPhase: 0,
      });
      expect([...noContext.demandByCorp]).toEqual([...explicitZero.demandByCorp]);
    }
  });
});
