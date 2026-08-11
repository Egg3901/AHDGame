import type { IdentitySignalEligibility } from "@/lib/auth/identitySignals";

export interface UserData {
  id: string;
  username: string;
  email: string;
  role: string;
  isAdmin: boolean;
  isBanned: boolean;
  characterId: string | null;
  characterName: string | null;
  party: string | null;
  registrationIp: string | null;
  lastKnownIp: string | null;
  registrationIpKey?: string | null;
  lastKnownIpKey?: string | null;
  lastAuthToken: string | null;
  registrationFingerprint: string | null;
  lastFingerprint: string | null;
  registrationFingerprintKey?: string | null;
  lastFingerprintKey?: string | null;
  fingerprintCount: number;
  trackingId: string | null;
  trackingIdKey?: string | null;
  deviceKey: string | null;
  deviceKeyKey?: string | null;
  lastDevice?: "mobile" | "tablet" | "desktop" | null;
  lastLogin: string | null;
  lastLogout: string | null;
  createdAt: string;
  discordId: string | null;
  discordUsername: string | null;
  modNote: string | null;
  latestModNote?: string | null;
  /** VPN/proxy/Tor flag — boolean if detected, null if not checked. */
  vpnFlag?: boolean | null;
  /** Per-signal matching eligibility, computed server-side from the raw values
   * (`eligibleIdentitySignals`). Optional so a stale client bundle degrades to
   * "no annotation" rather than throwing. Consumed ONLY by
   * `getDuplicateGroups`; `UsersTable` ignores it and keeps rendering the raw
   * values exactly as before. */
  signalEligibility?: IdentitySignalEligibility;
  /** Full IP intelligence from ipapi.co (admin context only). */
  ipDetails?: {
    checkedAt: string;
    ip: string;
    country: string | null;
    region: string | null;
    city: string | null;
    timezone: string | null;
    isp: string | null;
    org: string | null;
    as: string | null;
    isVpn: boolean;
    isProxy: boolean;
    isHosting: boolean;
  } | null;
}

export type MatchReason = "ip" | "fingerprint" | "tracking" | "device";
export type GroupMember = UserData & { matchReasons: MatchReason[] };

export interface DuplicateGroup {
  members: GroupMember[];
  sharedIps: string[];
  sharedFingerprints: string[];
  sharedDevices: string[];
  cgnatSuspect: boolean;
  /** Age in ms of the most recently observed eligible signal anywhere in this
   * group. Undefined when no member carried an age (e.g. a stale client
   * bundle that predates the eligibility annotation). */
  newestEvidenceMs?: number;
}

export interface RetiredCharacterEntry {
  id: string;
  characterId: string;
  retiredAt: string;
  reason: string;
  name: string;
  party: string | null;
  highestOffice: string | null;
  achievementCount: number;
  countryId: string;
  homeState: string;
}

export const ACTION_BTN = "min-h-[44px] rounded px-3 py-2 text-sm font-medium transition-colors";

export const getLatestNoteText = (user: UserData) => user.latestModNote ?? user.modNote ?? null;
