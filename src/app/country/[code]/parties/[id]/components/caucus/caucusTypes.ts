import type { CaucusHealthItem } from "@/lib/caucus/caucusHealth";

export interface CaucusListEntry {
  id: string;
  slug: string;
  name: string;
  description: string;
  color: string;
  discordInviteUrl: string | null;
  chairId: string | null;
  chairName: string | null;
  viceChairId: string | null;
  viceChairName: string | null;
  whipMode: "free" | "soft" | "hard";
  treasury: number;
  taxRate: number;
  motto: string | null;
  memberCounts: { players: number; npps: number; total: number };
  health: {
    statusLabel: CaucusHealthItem["statusLabel"];
    statusReason: string;
    activeDefianceCount: number;
    atRiskCount: number;
    recentJoinCount: number;
    recentLeaveCount: number;
    recentForcedExitCount: number;
    electionStatus: CaucusHealthItem["election"]["status"];
  } | null;
}

export interface CaucusPosition {
  id: string;
  topic: string;
  stance: string;
  note: string;
  weight: "core" | "secondary";
  sortOrder: number;
}

export interface RosterEntry {
  membershipId: string;
  memberType: "character" | "npp";
  memberId: string;
  sequentialId: number | null;
  name: string;
  homeState: string;
  role: string;
  complianceScore: number;
  loyalty: number | null;
}

export interface ChairMemberOption {
  id: string;
  name: string;
  homeState: string;
}

export interface RecruitableNppOption {
  id: string;
  name: string;
  homeState: string;
  currentOfficeLabel: string | null;
  relationshipScore: number;
  eligible: boolean;
  status:
    "eligible" | "already_member" | "other_caucus" | "retired" | "cooldown" | "needs_relationship";
  statusLabel: string;
  cooldownUntil: string | null;
}

export interface RecruitableNppResponse {
  items: RecruitableNppOption[];
  cooldownUntil: string | null;
}

export interface CaucusDetail {
  caucus: CaucusListEntry & { createdAt: string; updatedAt: string };
  positions: CaucusPosition[];
  health: import("@/lib/caucus/caucusHealth").CaucusHealthItem | null;
  isRedirect: boolean;
  canonicalSlug: string;
}

export interface CaucusesTabProps {
  countryCode: string;
  partyId: string;
  viewerCharacterId: string | null;
  currentTurn: number;
  isNationalParty: boolean;
  viewerInParty: boolean;
  eligibleStates?: Array<{ id: string; name: string }>;
  initialSelectedSlug?: string | null;
}
