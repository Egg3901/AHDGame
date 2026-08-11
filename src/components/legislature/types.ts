import type { CountryId } from "@/lib/constants/countries";
import type { GovernmentContext } from "@/lib/charts/westminsterParliament";

export interface LegislatureMember {
  id: string;
  characterId: string | null;
  sequentialId: number | null;
  characterName: string;
  avatarUrl?: string | null;
  region: string;
  party: string;
  partyName: string;
  partyColor: string;
  countryId: CountryId;
  seatsHeld: number;
  isNPP: boolean;
  isVacant: boolean;
}

export interface LegislatureComposition {
  party: string;
  partyName: string;
  partyColor: string;
  economicPosition: number;
  seats: number;
  countryId?: CountryId;
}

export interface LegislatureCompositionData {
  members: LegislatureMember[];
  composition: LegislatureComposition[];
  totalSeats: number;
  filledSeats: number;
}

export interface LegislatureCompositionSectionProps {
  data: LegislatureCompositionData;
  chamberLabel: string;
  chamberSubtitle?: string;
  showSeatsColumn: boolean;
  searchPlaceholder?: string;
  sortOptions?: Array<{ value: string; label: string }>;
  defaultSort?: string;
  regionLabel?: string;
  extraControls?: React.ReactNode;
  filterFn?: (member: LegislatureMember) => boolean;
  /** Map of characterId -> badge label, for leader badges (Congress only) */
  leaderBadges?: Map<string, string>;
  /** Country ID for coalition data fetch — derived from composition data if not provided */
  countryId?: CountryId;
  /** Chamber seating layout: hemicycle arc (default), Westminster benches (UK), or Dáil horseshoe (IE) */
  parliamentChartVariant?: "hemicycle" | "westminster" | "horseshoe";
  /** UK Commons: government formation context for seating arrangement */
  governmentContext?: GovernmentContext;
}
