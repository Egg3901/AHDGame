import type { BucketProfileSection } from "@/lib/demographics/bucketProfile";
import React from "react";
import type {
  State,
  ElectedOfficial,
  Character,
  StateDemographics,
  DemographicCategory,
  OfficeType,
} from "@/lib/db/types";
import type { Layer1Config } from "@/lib/seeds/stateDemographics";
import type { ArchetypeRegionCensus } from "@/lib/seeds/regionCensusData";
import type { CountryId } from "@/lib/constants/countries";

import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import type { RegionPartyPosition } from "@/lib/demographics/preferredParty";

export interface PartyOrgDisplay {
  _id: string;
  stateId: string;
  partyId: string;
  countryId: CountryId;
  organization: number;
  /** State-party PS reserve — powers the inline Build Org panel's PS gate.
   *  Optional for back-compat with any other constructor; always set by
   *  `serializePartyOrg`. */
  politicalStrength?: number;
  partyName: string;
  partyAbbreviation: string;
  partyColor: string;
  isDefault: boolean;
  /** State-party chair character name, when the seat is filled. */
  chairName?: string;
  /** Character _id of the state-party chair (for linking to the chair's page). */
  chairCharacterId?: string;
}

export interface NPPDisplaySimple {
  _id: string;
  name: string;
  party: string;
  homeState: string;
  politicalInfluence: number;
  currentOffice: OfficeType | null;
  avatarUrl?: string | null;
  sequentialId?: number;
  partyName?: string;
  partyColor?: string;
}

export type TabId =
  | "overview"
  | "elections"
  | "politics"
  | "parties"
  | "demographics"
  | "metrics"
  | "budget"
  | "laws"
  | "economy"
  | "resources"
  | "admin";

export interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

export interface SerializedOfficial extends Omit<ElectedOfficial, "_id" | "characterId" | "nppId"> {
  _id: string;
  characterId: string | null;
  nppId: string | null;
  characterSequentialId?: number | null;
  nppSequentialId?: number | null;
  avatarUrl?: string | null;
  borderKey?: string | null;
  tintColor?: string | null;
  partyColor?: string | null;
  partyName?: string | null;
  partyAbbreviation?: string | null;
}

export interface SerializedPlayer extends Omit<Character, "_id" | "userId" | "factionId"> {
  _id: string;
  userId: string;
  /** Stringified ObjectId (or null). The raw ObjectId cannot cross the
   *  server / client boundary because Next.js rejects objects with
   *  `toJSON()` methods passed to Client Components. */
  factionId?: string | null;
  borderKey?: string | null;
  tintColor?: string | null;
  isAdmin?: boolean;
  isModerator?: boolean;
}

export interface SerializedStateDemographics extends Omit<StateDemographics, "lastUpdated"> {
  lastUpdated: string | null;
}

export interface SerializedGovernor {
  _id: string;
  characterId: string | null;
  characterName: string | null;
  party: string | null;
  partyAbbreviation: string | null;
  avatarUrl: string | null;
  borderKey?: string | null;
  tintColor?: string | null;
  isNPP: boolean;
  nppId: string | null;
  characterSequentialId?: number | null;
  nppSequentialId?: number | null;
}

export type { Layer1Config, ArchetypeRegionCensus };

export interface TurnoutResponse {
  stateId: string;
  turnout: Record<string, Record<string, { baseline: number; modifier: number; actual: number }>>;
  lastUpdated: string | null;
  lastDecayApplied: string | null;
}

export interface StatePageTabsProps {
  state: State;
  officials: {
    senators: SerializedOfficial[];
    houseReps: SerializedOfficial[];
    stateSenators: SerializedOfficial[];
    governor: SerializedGovernor | null;
  };
  players: SerializedPlayer[];
  npps: NPPDisplaySimple[];
  demographics: SerializedStateDemographics | null;
  categories: DemographicCategory[];
  censusData: Layer1Config | ArchetypeRegionCensus | null;
  calculatedLeans: { economicLean: number; socialLean: number } | null;
  partyOrg: PartyOrgDisplay[];
  turnoutData?: TurnoutResponse | null;
  activeElections?: unknown[];
  isAdmin?: boolean;
  /**
   * Phase 1: Overview tab data, fetched server-side via `getStateOverview`.
   * Optional during the rollout window — when omitted, the Overview tab
   * renders a minimal placeholder (no KPI numbers).
   */
  overview?: import("@/lib/states/overview/types").StateOverviewResult;
  /** PoliticalParty._id of the viewing user, or null if unaffiliated. */
  viewerPartyId?: string | null;
  /**
   * Phase 2: state-scope party-budget rows for this state, indexed by
   * partyId (sequentialId-string). Used to surface current GOTV /
   * Suppression / OrgBuilding percentages on the State Politics tab.
   * Mutation lives canonically on the State Party page (Phase 2 D2).
   */
  partyBudgetsByPartyId?: Record<
    string,
    {
      gotvBudgetPercent: number;
      gotvTargetCategory?: string;
      gotvTargetGroup?: string;
      suppressionBudgetPercent: number;
      suppressionTargetCategory?: string;
      suppressionTargetGroup?: string;
      orgBuildingPercent: number;
    }
  >;
  /**
   * Per-state Registration headline + recent movement for the Registration
   * Ledger card on the State Politics tab (fetched via `getStateRegLedger`).
   */
  regLedger: import("@/lib/states/overview/getStateRegLedger").StateRegLedgerResult;
  /**
   * When true, the overview tab shows the regional conditions card listing
   * active approval modifiers. Gated via `gameConfig.regionalConditionsOverviewEnabled`.
   */
  regionalConditionsOverviewEnabled?: boolean;
  /** Active approval modifiers for the regional conditions card. */
  approvalModifiersForOverview?: ActiveModifier[];
  /** Government approval score for the regional conditions card hero. */
  regionGovernmentApproval?: number | null;
  /** Base approval (pre-modifiers) for the regional conditions card. */
  regionApprovalBase?: number | null;
  /** Region's major parties (with positions) for the Demographics dossier's
   *  preferred-party derivation. Empty/omitted when none resolve. */
  regionParties?: RegionPartyPosition[];
  /**
   * Per-bucket electorate profile, derived server-side from the same granular
   * units the vote engine uses. Null when the region has no Layer-1 substrate.
   */
  bucketProfile?: BucketProfileSection[] | null;
}

export interface PolicyRecordResponse {
  legislationTypeId: string;
  name: string;
  policyDomain: string;
  economic: number;
  social: number;
  nationalOnly: boolean;
  policyOptionName: string | null;
  hasEconomic?: boolean;
  hasSocial?: boolean;
  enactedByKind?: "bill" | "order" | "expiry" | null;
  activeOrder?: {
    orderId: string;
    issuedByName: string;
    issuedAtTurn: number;
    expiresAtTurn: number;
  } | null;
}
