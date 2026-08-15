"use client";

import { useState, useEffect, useCallback } from "react";
import type { UnitDomain } from "@/lib/db/types/militaryUnit";
import type { MilitaryCommand, CommanderRef, ThreatLevel } from "@/lib/military/types";
import type { ConflictAssignment } from "@/lib/military/assignments";
import type { CorpsMember } from "@/lib/db/collections/characterGenerals";

export interface CabinetOfficeData {
  /** Live in-game year for era-resolved roster chrome (null/absent = unavailable).
   *  Optional: payloads served by a pre-era-gating API omit it (rolling deploys). */
  liveYear?: number | null;
  position: {
    id: string;
    /** Era-resolved seat title. Optional for pre-era-gating payloads. */
    name?: string | null;
    /** Era-resolved department label. */
    department: string;
    sealImage: string | null;
    singleRegionFocus: string | null;
  };
  mechanics: {
    tierSetting: unknown | null;
    regionalTarget: unknown | null;
    allocation: unknown | null;
    advocacy: unknown | null;
    emergency: unknown | null;
  };
  orders: Array<{
    id: string;
    name: string;
    description: string;
    duration: number;
    effects: unknown[];
  }>;
  member: {
    characterId: string;
    characterName: string;
    party: string | null;
    ministerialActions: number;
    bannerImageUrl: string | null;
  } | null;
  currentSettings: {
    tierSetting: string | null;
    tierSettings: Record<string, string> | null;
    targetRegionId: string | null;
    targetCountryId: string | null;
    aidPriority: string | null;
    advocacyActive: boolean;
    allocationPercents: Record<string, number> | null;
    lastChangedTurn: number;
  } | null;
  sovereignBondProfile: Record<number, number> | null;
  debtPrincipal: number;
  sovereignBondsOutstanding: number;
  activeOrders: Array<{
    orderId: string;
    orderName: string;
    issuedTurn: number;
    expiresTurn: number;
  }>;
  targetCountries: Array<{
    id: string;
    label: string;
  }>;
  nationalMetrics: Record<string, number>;
  regionData: Array<{
    regionId: string;
    regionName: string;
    population: number;
    metrics: Record<string, number>;
  }>;
  regionalBudgets: Array<{
    regionId: string;
    fundingPoolAmount: number;
    westminsterGrant: number;
    nationalGrant: number;
    federalEqualizationGrant: number;
    totalBudget: number;
    propertyValuePerCapita: number;
    commercialValuePerCapita: number;
    chancellorAllocationPercent: number | null;
  }>;
  canAct: boolean;
  /**
   * gameConfig.prospectingEnabled — gates the Treasury-tab "Fund Geological
   * Survey" action. Assumed attached to this response following the same
   * convention as other per-surface feature flags (e.g. sector-detail's
   * labourEnabled); absent = treated as off.
   */
  prospectingEnabled?: boolean;
  /** Defense seat only: the military order-of-battle + force aggregates. */
  units?: MilitaryUnitView[];
  forceSummary?: ForceSummaryView;
  /** Defense seat only: the national doctrine state + the era gating adoption. */
  doctrine?: { adopted: Record<string, number>; points: number };
  doctrineEra?: number;
  /** Defense seat only: the persisted per-country military commands. */
  commands?: MilitaryCommand[];
  /** Defense seat only: the country's commissioned generals (command commander pool). */
  commanders?: CommanderRef[];
  conflictAssignments?: ConflictAssignment[];
  corps?: CorpsMember[];
  commissionCandidates?: { characterId: string; name: string }[];
  /** Defense seat only: live conflict-driven threat per strategic region (viewer-relative). */
  regionThreats?: Record<string, ThreatLevel>;
  /** Defense seat only: the replacement-manpower pool and the stance the law puts in force. */
  manpower?: ManpowerView;
  /** Defense seat only: the national materiel store and the contracts filling it. */
  arsenal?: ArsenalView;
  contracts?: DefenceContractView[];
  /** Defense seat only: plants that could take a contract, and the going rate per lot. */
  suppliers?: DefenceSupplierView[];
  /** Null when the country has no usable GDP — the award form disables rather than
   *  quoting a free contract. */
  lotPricePerLot?: number | null;
  /** Estates seat only: the portfolio roster + aggregate. */
  estates?: EstateView[];
  estateSummary?: EstateSummaryView;
  /** Energy seat only: the plant fleet + national mix aggregate. */
  plants?: PlantView[];
  energySummary?: EnergySummaryView;
  /** Transportation seat only: the project pipeline + aggregate. */
  projects?: ProjectView[];
  infraSummary?: InfraSummaryView;
  /** Finance seat only: the read-only monetary dossier + debt-op state. */
  monetary?: MonetaryView;
  currentTurn: number;
}

export interface MonetaryView {
  primeRate: number | null;
  primeRateHistory: Array<{ turn: number; rate: number }>;
  chairName: string | null;
  /** Full sovereign borrowing rate (budget.debt.interestRate). */
  sovereignRate: number | null;
  /** Investor-confidence premium component (decimal, e.g. 0.01 = +1pp). */
  confidencePremium: number;
  investorConfidence: number | null;
  confidenceBaseline: number;
  fxRate: number | null;
  fxBand: { floor: number; ceiling: number } | null;
  reserveBalance: number | null;
  forexRevenue: number | null;
  debtOp: {
    active: boolean;
    expiresTurn: number | null;
    cooldownUntilTurn: number;
    boostPerTurn: number | null;
  };
}

export interface ProjectView {
  _id: string;
  countryId: string;
  positionId: string;
  archetypeId: string;
  name: string;
  icon: string;
  regionId: string;
  status: "construction" | "operational";
  progress: number;
  buildDuration: number;
  fundingLevel: "slowed" | "standard" | "crashed";
  outputBase: number;
  upkeepBase: number;
  constructionCostBase: number;
  createdTurn: number;
  completedTurn?: number;
  effectiveOutput: number;
  effectiveUpkeep: number;
  progressPct: number;
  turnsRemaining: number;
}

export interface InfraSummaryView {
  building: number;
  operational: number;
  constructionSpend: number;
  operationalUpkeep: number;
  committedSpend: number;
  byRegion: Record<string, { building: number; operational: number }>;
  envelope: number;
}

export interface PlantView {
  _id: string;
  countryId: string;
  positionId: string;
  source: "coal" | "gas" | "nuclear" | "hydro" | "wind" | "solar";
  name: string;
  icon: string;
  capacityBase: number;
  tier: 0 | 1 | 2 | 3;
  regionId: string;
  createdTurn: number;
  effectiveCapacity: number;
  effectiveUpkeep: number;
}

export interface EnergySummaryView {
  totalCapacity: number;
  totalUpkeep: number;
  bySource: Record<string, number>;
  renewableShare: number;
  firmShare: number;
  carbonIntensity: number;
  envelope: number;
  byRegion: Record<string, Record<string, number>>;
}

export interface EstateView {
  _id: string;
  countryId: string;
  portfolioKey: string;
  positionId: string;
  archetypeId: string;
  name: string;
  icon: string;
  fundingLevel: "reduced" | "standard" | "enhanced";
  tier: 0 | 1 | 2 | 3;
  condition: number;
  outputBase: number;
  upkeepBase: number;
  siteScope: "region" | "country";
  siteId: string;
  createdTurn: number;
  effectiveOutput: number;
  effectiveUpkeep: number;
}

export interface EstateSummaryView {
  count: number;
  totalUpkeep: number;
  envelope: number;
  portfolioKey: string;
  bySite: Record<string, Record<string, number>>;
}

/** The defense seat's replacement-manpower readout. */
export interface ManpowerView {
  pool: number;
  mode: "off" | "trained" | "conscript";
  /** Added to the pool each turn (population x stance). */
  regenPerTurn: number;
  /** Ceiling the pool accumulates toward. */
  poolCap: number;
  /** The conscription stance in force — from the enacted reserve law for playables. */
  stanceLabel: string;
  conscriptAllowed: boolean;
}

export interface MilitaryUnitView {
  _id: string;
  countryId: string;
  branchId: string;
  domain: string;
  name: string;
  type: string;
  icon: string;
  posture: "garrison" | "standard" | "forward" | "alert";
  techTier: 0 | 1 | 2 | 3;
  personnel: number;
  readiness: number;
  basePower: number;
  upkeepBase: number;
  vet: 0 | 1 | 2 | 3 | 4;
  xp: number;
  equipment: { firepower: number; protection: number; support: number };
  drill: string | null;
  theaterId: string;
  assignedGeneralId: string | null;
  createdTurn: number;
  effectivePower: number;
  effectiveUpkeep: number;
}

export interface ForceSummaryView {
  unitCount: number;
  totalPower: number;
  totalPersonnel: number;
  totalUpkeep: number;
  avgReadiness: number;
  forwardShare: number;
  /** Signed national cash position, absolute local currency. Negative = debt. */
  treasuryBalance: number;
  /** National GDP in the same units as treasuryBalance; null when unusable. */
  gdp: number | null;
  /**
   * GDP this world's military prices are anchored to; null = price off live GDP.
   * Never 0 — that would anchor prices at zero and make every unit free.
   */
  militaryPriceBaselineGdp: number | null;
  /** Defence account balance. Procurement is paid from this, not the treasury. */
  appropriation: number;
  /** Accrued into the account each turn (the enacted defence line / TURNS_PER_YEAR). */
  appropriationAccrual: number;
  /** Charged out of the account each turn to sustain the standing force. */
  appropriationUpkeep: number;
  /** 0..1 share of upkeep the account could not fund; suppresses readiness. */
  arrearsRatio: number;
  /** False when this country has no federalBudget row for the active preset. */
  hasBudget: boolean;
  tier: string;
}

/** A country's materiel store, by the domain of unit each row equips. */
export interface ArsenalView {
  stock: Record<UnitDomain, number>;
  /** Volume-weighted mean grade (0..3) of what is in store — a new unit's techTier. */
  grade: Record<UnitDomain, number>;
}

/** An active procurement contract, as the defence seat sees it. */
/** A plant the defence minister may award a procurement contract to. */
export interface DefenceSupplierView {
  sectorId: string;
  corporationId: string;
  corporationName: string;
  plantLabel: string;
  strategyId: string;
  component: string;
  components: string[];
  projectedLotsPerTurn: number;
  gradeCeiling: number;
  alreadyContracted: boolean;
  availableLots?: number;
  allowanceWindowEndTurn?: number;
}

export interface DefenceContractView {
  /** "pending" until the supplying CEO accepts; only "active" delivers. */
  status?: string;
  _id: string;
  corporationId: string;
  sectorId: string;
  supplierName: string;
  component: string;
  lotsOrdered: number;
  lotsDelivered: number;
  pricePerLot: number;
  awardedTurn: number;
}

export function useCabinetOffice(countryCode: string, positionId: string) {
  const [data, setData] = useState<CabinetOfficeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (opts?: { silent?: boolean }) => {
      // A silent refresh keeps the existing tree mounted. Flipping `loading` here
      // unmounted the roster after every assign/recruit, which reset the branch
      // tab back to Ground and closed any open Manage panel.
      if (!opts?.silent) setLoading(true);
      try {
        const res = await fetch(
          `/api/country/${countryCode}/executive/cabinet/${positionId}/briefing`
        );
        if (!res.ok) {
          const json = await res.json();
          setError((json as { error?: string }).error ?? "Failed to load office data");
          return;
        }
        setData((await res.json()) as CabinetOfficeData);
        setError(null);
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    },
    [countryCode, positionId]
  );

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const refetch = useCallback(() => fetchData({ silent: true }), [fetchData]);

  return { data, loading, error, refetch };
}
