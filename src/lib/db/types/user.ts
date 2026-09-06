import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { NotificationPreferences } from "./notifications";
import type { PatreonTier, ProfileBorderKey, SupporterProvider } from "./patreon";
import type { StoredFingerprintComponents } from "@/lib/utils/fingerprint";
import type { IpDetails } from "@/lib/ip/ipteoh";
import type { CfFingerprint } from "@/lib/utils/cfFingerprint";

export type PatreonAdPreference = "ad-free" | "player-only" | "all-ads";

/** Structured mod note with author attribution. */
export interface ModNote {
  authorId: ObjectId;
  authorName: string;
  authorRole: "admin" | "moderator";
  text: string;
  createdAt: Date;
}

export interface User {
  _id: ObjectId;
  email: string;
  username: string;
  displayName: string;
  password: string;
  role: "admin" | "moderator" | "player";
  isAdmin?: boolean;
  isBanned?: boolean;
  banReason?: string;
  bannedAt?: Date;
  /** Any auth token issued at or before this timestamp is invalid and must re-authenticate. */
  authRevokedAt?: Date;
  /** Last time the password was set via change-password or reset-password. */
  passwordChangedAt?: Date;
  /** When the 48-hour banned shareholder/CEO grace cleanup was applied. */
  bannedShareReleaseProcessedAt?: Date;
  /** CEO-held corporations snapshotted at ban time so share release survives later seat changes. */
  bannedShareReleaseCorporationIds?: ObjectId[];
  hasCompletedSetup: boolean;
  activeCharacterId?: ObjectId;
  activeImperialCharacterId?: ObjectId;
  activeCharacterType?: "character" | "imperial";
  activeCharacterCount?: number;
  /** Turn of this user's most recent corporation founding; gates the founding cooldown (Bug #0728). */
  lastCorporationFoundedTurn?: number;
  createdAt: Date;
  updatedAt: Date;
  lastLogin?: Date;
  lastLogout?: Date;
  lastActivity?: Date;
  registrationIp?: string;
  lastKnownIp?: string;
  lastAuthToken?: string;
  registrationFingerprint?: string;
  lastFingerprint?: string;
  fingerprintHistory?: string[];
  /** Normalized ThumbmarkJS components captured at registration (advisory; never used for blocking). */
  registrationFingerprintComponents?: StoredFingerprintComponents;
  /** Normalized ThumbmarkJS components from the most recent login/capture. */
  lastFingerprintComponents?: StoredFingerprintComponents;
  trackingId?: string;
  /** Per-device key persisted in the browser's localStorage; survives cookie clears. */
  deviceKey?: string;
  // ── Per-signal observation timestamps ────────────────────────────────────
  // Each identity signal is dated by its OWN stamp, written at the same sites
  // that write the signal. Proxy timestamps do not work: `lastActivity` is
  // refreshed by /api/client-nav on every authenticated page load without
  // re-observing any of these, and `lastLogin` is written unconditionally where
  // `deviceKey`/`lastFingerprint` are written conditionally. Absent on rows
  // predating these fields — consumers fall back per the design spec's
  // timestamp table (`max(lastLogin, createdAt)`, or `createdAt` for
  // registration values). See `src/lib/auth/identitySignals.ts`.
  /** When `trackingId` was last observed. */
  trackingIdAt?: Date;
  /** When `deviceKey` was last observed. Only stamped when the client sent one. */
  deviceKeyAt?: Date;
  /** When `lastFingerprint` was last observed. Only stamped when the client sent one. */
  lastFingerprintAt?: Date;
  /** When `lastKnownIp` was last observed. */
  lastKnownIpAt?: Date;
  /** When `registrationFingerprint` was captured — NOT necessarily `createdAt`,
   * because `/api/auth/record-fingerprint` backfills it for OAuth accounts. */
  registrationFingerprintAt?: Date;
  /** Coarse device class derived from the last login's User-Agent. */
  lastDevice?: "mobile" | "tablet" | "desktop";
  /** Immutable nationality for the account, set from the first country the player enters. */
  accountCountryId?: CountryId;
  /**
   * Which life's name to show on the cross-iteration Hall of Fame leaderboard:
   * "current" (active character), a characterId (must belong to this user, current
   * or retired), or unset (defaults to the name of the user's highest-scoring life).
   */
  legacyDisplayCharacterId?: string;
  discordId?: string;
  discordUsername?: string;
  discordAvatar?: string;
  discordLinkedAt?: Date;
  googleId?: string;
  googleEmail?: string;
  googleName?: string;
  googleAvatar?: string;
  googleLinkedAt?: Date;
  theme?:
    | "light"
    | "default"
    | "oled"
    | "usa"
    | "pastel"
    | "dark-pastel"
    | "retro"
    | "solarized"
    | "cloakroom"
    | "broadsheet"
    | "coldwar"
    | "command-1953";
  statusBarLayout?: "standard" | "corp" | "elections" | "full" | "minimal";
  disableAutoplayOnOtherProfiles?: boolean;
  /**
   * The redesigned interface (new navigation bar + CEO Command Center) is the
   * default for everyone. This flag is the opt-OUT: an explicit `false` returns
   * the user to the classic interface. Absent/`true` = new interface.
   */
  enableExperimentalUI?: boolean;
  actionsViewMode?: "cards" | "compact";
  notificationPreferences?: NotificationPreferences;
  referredBy?: ObjectId;
  referralCount?: number;
  /** Referrals credited since `gameConfig.referralContestStartedAt` (character creation milestones). */
  referralContestCount?: number;
  patreonTier?: PatreonTier;
  /**
   * Which system granted the current supporter benefits ("patreon" | "stripe" |
   * "bot"). Absent on legacy records is treated as "patreon". Stripe subscribers
   * (Lakeside portal) are skipped by the Patreon reconciler.
   */
  supporterProvider?: SupporterProvider;
  patreonExpiresAt?: Date | null;
  patreonSince?: Date;
  patreonUserId?: string;
  adsDisabled?: boolean;
  patreonAdPreference?: PatreonAdPreference;
  patreonHighlightColor?: string;
  patreonProfileBorder?: ProfileBorderKey;
  /** Server-side access grant for the official desktop singleplayer client. */
  singleplayerEntitledAt?: Date;
  /** Admin username that last granted desktop singleplayer access. */
  singleplayerEntitledBy?: string;
  /** Moderator-approved name shown on the public supporter wall. */
  supporterWallName?: string | null;
  /** Set when the account's one-time Supporter++ NPP rename has been used. */
  nppRenameUsedAt?: Date | null;
  /** Admin-only mod note, viewable only from the admin users panel. */
  modNote?: string;
  /**
   * Optional alt user accounts whose notifications appear in a unified inbox for this login.
   * Configured by ops/admin (same human, multiple site accounts).
   */
  notificationBundleUserIds?: ObjectId[];
  /** Structured mod notes with attribution, replaces legacy modNote string. */
  modNotes?: ModNote[];
  /** When moderator role was assigned. */
  moderatorSince?: Date;
  /** When this user last voluntarily retired a character (player_deleted). Used to enforce creation cooldown. */
  lastRetiredAt?: Date;
  /** Cumulative anchor-unit amount wired in the current 24h quota window. */
  wireQuotaUsed?: number;
  /** Start of the current 24h wire quota window. */
  wireQuotaWindowStart?: Date;
  /** IP intelligence from ipapi.co — populated at registration or backfill. */
  ipDetails?: IpDetails;
  /** Cloudflare edge fingerprint (country/ASN/colo/JA4-JA3/bot-threat scores)
   * captured at registration — mirrors `registrationFingerprint`. All
   * sub-fields optional; absent when the request carried no Cloudflare
   * headers (local dev) or the zone's plan doesn't expose them. */
  registrationCf?: CfFingerprint;
  /** Cloudflare edge fingerprint from the most recent login/capture —
   * mirrors `lastFingerprint`. */
  lastCf?: CfFingerprint;
}

/** Re-export IpDetails for consumers of this module. */
export type { IpDetails } from "@/lib/ip/ipteoh";
