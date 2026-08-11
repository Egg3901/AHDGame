// Response types for /api/country/[code]/politicians. Shared with UI consumers
// via lib so they don't reach into the route file.

import type { CountryId } from "@/lib/constants/countries";

export interface PoliticianData {
  id: string;
  sequentialId?: number;
  name: string;
  avatarUrl?: string;
  party: string;
  partyName?: string;
  partyColor?: string;
  countryId: CountryId;
  homeState: string;
  homeStateName: string;
  currentOffice: string;
  officeType: string | null;
  politicalInfluence: number;
  nationalInfluence: number;
  favorability: number;
  funds: number | null; // null for NPPs
  isNPP?: boolean;
  isAdmin?: boolean;
  isModerator?: boolean;
}
