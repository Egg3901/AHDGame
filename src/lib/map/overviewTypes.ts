// Response types for /api/map/overview. Shared with UI consumers via lib so
// they don't reach into the route file.

import type { MapPartyOrgState } from "@/lib/map/partyOrgService";
import type { MapSenateState } from "@/lib/map/senateService";
import type { MapHouseState } from "@/lib/map/houseService";
import type { MapGovernorState } from "@/lib/map/governorService";
import type { MapApprovalState } from "@/lib/map/approvalService";
import type { MapLeanState } from "@/lib/map/leanService";
import type { MapPresidentialState } from "@/lib/map/presidentialService";
import type { MapRegionRosterEntry } from "@/lib/map/rosterService";
import type { CorporationType } from "@/lib/constants/corporations";

export interface MapSectorSpecializationState {
  primary: CorporationType;
  primaryLabel: string;
  secondary: CorporationType;
  secondaryLabel: string;
  tooltip: string[];
}

export interface MapOverviewResponse {
  partyOrg: Record<string, MapPartyOrgState>;
  senate: Record<string, MapSenateState>;
  house: Record<string, MapHouseState>;
  governor: Record<string, MapGovernorState>;
  approval: Record<string, MapApprovalState>;
  lean: Record<string, MapLeanState>;
  presidential: Record<string, MapPresidentialState>;
  /** UK: Commons seat leader (like house for US). US: empty, use house. */
  commons?: Record<string, MapHouseState>;
  presidentialElectoralVotes?: Record<string, number>;
  presidentialCandidateNames?: Record<string, string>;
  presidentialCandidateParties?: Record<string, string>;
  /** candidateId → party hex colour, resolved server-side (client can't map sequentialIds). */
  presidentialCandidateColors?: Record<string, string>;
  /** Live electoral-college total = Σ active apportionment EV units (538 today,
   *  fewer in an earlier/fewer-state era). The map's Presidential panel derives
   *  the "to win" threshold from this instead of a hardcoded 538/270. */
  totalElectoralVotes?: number;
  sectorSpecializations?: Record<string, MapSectorSpecializationState>;
  /** Live region roster (id/name/seats/grouping) for the country's owned states. */
  regions?: MapRegionRosterEntry[];
}
