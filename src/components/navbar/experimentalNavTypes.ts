/**
 * Shared prop/state types for {@link ExperimentalNavbar} and its extracted
 * dropdown/mobile-menu subcomponents. Type-only module — no runtime code.
 */

export interface NavLinkRef {
  username: string;
  isAdmin?: boolean;
  isModerator?: boolean;
  patreonTier?: string | null;
  isPatronActive?: boolean;
}

export interface AdminCharacter {
  id: string;
  name: string;
  countryId: string;
  party: string | null;
  isActive: boolean;
}

export interface ImperialCharacterNav {
  id: string;
  name: string;
}

export interface CharacterProfile {
  avatarUrl?: string | null;
  profileHeaderImageUrl?: string | null;
  borderKey?: string | null;
  tintColor?: string | null;
  name?: string;
}

export type OpenKey =
  "world" | "country" | "nation" | "state" | "help" | "staff" | "user" | "profile" | null;

export type MobileSubKey = "profile" | "state" | "nation" | "world" | "help" | "staff" | "country";

/**
 * Top-level tab descriptor for the experimental navbar (desktop tabs and the
 * mobile core nav list share the same entries).
 */
export interface ExperimentalNavItem {
  label: string;
  href: string;
  icon: string;
  key?: Exclude<OpenKey, null>;
  useFlag?: boolean;
}

/** Charter quick-link entry shown in the Nation dropdown / mobile menu. */
export interface CharterNavEntry {
  href: string;
  label: string;
}
