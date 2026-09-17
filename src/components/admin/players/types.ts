import type { IdentitySignalEligibility } from "@/lib/auth/identitySignals";

export interface UserData {
  id: string;
  username: string;
  email: string;
  role: string;
  isAdmin: boolean;
  isBanned: boolean;
  /** Optional while older admin bundles or test fixtures are in circulation. */
  singleplayerEntitled?: boolean;
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
  /** Values observed in the last 90 days (`identityObservations`), including
   * ones the account has since rotated away from. Raw on the admin route,
   * sha256-truncated into the `*Keys` pair on the moderator route, exactly like
   * the scalar signals above. Optional so a stale client bundle degrades to
   * "no historical signals" rather than throwing. */
  historicalIps?: string[] | null;
  historicalFingerprints?: string[] | null;
  historicalIpKeys?: string[];
  historicalFingerprintKeys?: string[];
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

/** `*-past` means the value was shared within the 90-day history window but is
 * no longer either account's current value. A moderator has to be able to tell
 * "these two share a fingerprint right now" from "these two shared one six
 * weeks ago"; collapsing the two would make the cards less trustworthy. */
export type MatchReason =
  "ip" | "fingerprint" | "tracking" | "device" | "ip-past" | "fingerprint-past";
export type GroupMember = UserData & {
  matchReasons: MatchReason[];
  /** True when this member's ONLY link to the group is a shared IP, current or
   * historical. Shared IPs are the least reliable signal (cgNAT, VPNs, DHCP
   * reassignment, household networks), so a member joined by nothing else needs
   * a caveat even when OTHER members of the group are strongly linked. The
   * group-level `cgnatSuspect` cannot say this: it requires EVERY member to be
   * IP-only, so it goes quiet on exactly the mixed groups that mislead. */
  weakMatch: boolean;
};

export interface DuplicateGroup {
  members: GroupMember[];
  sharedIps: string[];
  sharedFingerprints: string[];
  sharedDevices: string[];
  /** Values shared within the 90-day window that are no longer any member's
   * current value. Kept separate from the lists above so the header never
   * presents a rotated-away match as live evidence — but present, because a
   * group formed ONLY by a rotated fingerprint would otherwise render with an
   * empty header and read as having no evidence behind it at all. */
  sharedHistoricalIps: string[];
  sharedHistoricalFingerprints: string[];
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
