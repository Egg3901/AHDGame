import type { CaucusHealthItem } from "@/lib/caucus/caucusHealth";

export interface PartyAnalyticsLink {
  label: string;
  href: string;
}

export interface PartyAnalyticsStateMetric {
  stateId: string;
  stateName: string;
  organization: number;
  growthPerTurn: number;
  href: string;
}

export interface PartyAnalyticsGrowthMetric extends PartyAnalyticsStateMetric {
  trendLabel: "Growing" | "Shrinking" | "Flat";
}

export interface PartyAnalyticsRiskItem {
  id: string;
  name: string;
  homeState: string;
  currentOffice: string | null;
  loyalty: number;
  stubbornness: number;
  ambition: number;
  riskScore: number;
  riskLabel: "Critical" | "Elevated" | "Watch";
  href: string;
}

export interface PartyAnalyticsCaucusRiskItem {
  caucusId: string;
  caucusName: string;
  nppId: string;
  nppName: string;
  relationshipWithChair: number;
  gapFromExit: number;
  exitRiskLabel: "Critical" | "Elevated" | "Watch";
  chairName: string | null;
  href: string;
}

export interface PartyAnalyticsSlateItem {
  electionId: string;
  state: string;
  electionLabel: string;
  statusLabel: string;
  href: string;
}

export interface PartyAnalyticsSlateCoverageItem {
  state: string;
  totalRaces: number;
  coveredRaces: number;
  filedRaces: number;
  openRaces: number;
  likelyDeclines: number;
  href: string;
}

export interface PartyAnalyticsOrgSection {
  totalStateOrgs: number;
  positiveGrowthCount: number;
  negativeGrowthCount: number;
  growthLeaders: PartyAnalyticsStateMetric[];
  positiveGrowth: PartyAnalyticsGrowthMetric[];
  negativeGrowth: PartyAnalyticsGrowthMetric[];
}

export interface PartyAnalyticsDisciplineSection {
  lowLoyaltyCount: number;
  likelyWhipBreakers: number;
  cautionCount: number;
  caucusRiskCount: number;
  criticalRiskCount: number;
  elevatedRiskCount: number;
  activeDefianceCount: number;
  playerDefianceCount: number;
  nppDefianceCount: number;
  disciplineWatch: PartyAnalyticsRiskItem[];
  highStubbornness: PartyAnalyticsRiskItem[];
  caucusRisk: PartyAnalyticsCaucusRiskItem[];
}

export interface PartyAnalyticsSlateSection {
  activeRaceCount: number;
  uncoveredRaceCount: number;
  awaitingResolutionCount: number;
  filedCount: number;
  likelyDeclineCount: number;
  statesNeedingCoverageCount: number;
  statesWithLikelyDeclinesCount: number;
  noCoverage: PartyAnalyticsSlateItem[];
  atRiskAssignments: PartyAnalyticsSlateItem[];
  stateCoverage: PartyAnalyticsSlateCoverageItem[];
}

export interface PartyAnalyticsCaucusSection {
  recentWindowTurns: number;
  healthyCount: number;
  strainedCount: number;
  fragileCount: number;
  activeElectionCount: number;
  chairVacancyCount: number;
  recentJoinCount: number;
  recentLeaveCount: number;
  recentForcedExitCount: number;
  activeDefianceCount: number;
  atRiskMemberCount: number;
  caucuses: CaucusHealthItem[];
}

export interface PartyAnalyticsPayload {
  links: {
    slate: PartyAnalyticsLink;
    whipRoom: PartyAnalyticsLink;
    caucuses: PartyAnalyticsLink;
    npps: PartyAnalyticsLink;
    elections: PartyAnalyticsLink;
    stateParties: PartyAnalyticsLink;
  };
  org: PartyAnalyticsOrgSection;
  discipline: PartyAnalyticsDisciplineSection;
  caucuses: PartyAnalyticsCaucusSection;
  slate: PartyAnalyticsSlateSection;
}

export type StatePartyAnalyticsOrgSection = PartyAnalyticsStateMetric;

export interface StatePartyAnalyticsSlateSection {
  activeRaceCount: number;
  uncoveredRaceCount: number;
  awaitingResolutionCount: number;
  filedCount: number;
  likelyDeclineCount: number;
  coverage: PartyAnalyticsSlateCoverageItem | null;
  noCoverage: PartyAnalyticsSlateItem[];
  atRiskAssignments: PartyAnalyticsSlateItem[];
}

export interface StatePartyAnalyticsPayload {
  scope: {
    stateId: string;
    stateName: string;
  };
  links: {
    treasury: PartyAnalyticsLink;
    slate: PartyAnalyticsLink;
    whipRoom: PartyAnalyticsLink;
    npps: PartyAnalyticsLink;
    elections: PartyAnalyticsLink;
  };
  org: StatePartyAnalyticsOrgSection | null;
  discipline: PartyAnalyticsDisciplineSection;
  slate: StatePartyAnalyticsSlateSection;
}
