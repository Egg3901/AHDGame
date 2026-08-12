import { type ReactNode } from "react";
import { type SectionId } from "./shared";

export interface CharacterData {
  _id: string;
  name: string;
  bio?: string;
  avatarUrl?: string;
  profileHeaderImageUrl?: string;
  policies: { economic: number; social: number };
  actions: number;
  infamy: number;
  politicalInfluence: number;
  nationalInfluence?: number;
  lastNameChange?: string;
  sequentialId?: number;
  discordId?: string;
  discordUsername?: string;
  discordAvatar?: string;
  discordTag?: string;
  showDiscordTag?: boolean;
  googleId?: string;
  googleEmail?: string;
  googleName?: string;
  googleAvatar?: string;
  campaignSongUrl?: string;
  campaignSongAutoplay?: boolean;
  demographics?: { race: string; gender: string; education: string; wealth: string };
  autoRunForReelection?: boolean;
}

export interface CorporationData {
  _id: string;
  sequentialId: number;
  name: string;
  logoUrl?: string | null;
}

export interface OAuthData {
  discordId?: string;
  discordUsername?: string;
  discordAvatar?: string;
  googleId?: string;
  googleEmail?: string;
  googleName?: string;
  googleAvatar?: string;
}

/** Message ids resolved against the "settings" namespace via t(). */
export const DISCORD_MESSAGES: Record<string, { key: string; ok: boolean }> = {
  linked: { key: "oauth.discord.linked", ok: true },
  not_configured: { key: "oauth.discord.notConfigured", ok: false },
  already_linked: { key: "oauth.discord.alreadyLinked", ok: false },
  exchange_failed: { key: "oauth.discord.failed", ok: false },
  missing_params: { key: "oauth.discord.failed", ok: false },
  invalid_state: { key: "oauth.discord.expired", ok: false },
  session_expired: { key: "oauth.discord.sessionExpired", ok: false },
  rate_limited: { key: "oauth.discord.rateLimited", ok: false },
  access_denied: { key: "oauth.discord.denied", ok: false },
};

export const GOOGLE_MESSAGES: Record<string, { key: string; ok: boolean }> = {
  linked: { key: "oauth.google.linked", ok: true },
  not_configured: { key: "oauth.google.notConfigured", ok: false },
  already_linked: { key: "oauth.google.alreadyLinked", ok: false },
  exchange_failed: { key: "oauth.google.failed", ok: false },
  missing_params: { key: "oauth.google.failed", ok: false },
  invalid_state: { key: "oauth.google.expired", ok: false },
  access_denied: { key: "oauth.google.denied", ok: false },
};

export interface SectionDef {
  id: SectionId;
  /** Message id under the "settings" namespace, resolved via t() in the rendering component. */
  labelKey: string;
  group: "account" | "character";
  summaryKey: string;
}

const section = (id: SectionId, group: SectionDef["group"], key: string): SectionDef => ({
  id,
  group,
  labelKey: `sections.${key}.label`,
  summaryKey: `sections.${key}.summary`,
});

export const ACCOUNT_SECTIONS: SectionDef[] = [
  section("account-profile", "account", "accountProfile"),
  section("identity", "account", "identity"),
  section("appearance", "account", "appearance"),
  section("patreon", "account", "patreon"),
  section("supporter-perks", "account", "supporterPerks"),
  section("referrals", "account", "referrals"),
  section("achievements", "account", "achievements"),
  section("retired-characters", "account", "retiredCharacters"),
  section("security", "account", "security"),
  section("api-keys", "account", "apiKeys"),
  section("danger", "account", "danger"),
];

export const CHARACTER_SECTIONS: SectionDef[] = [
  section("profile", "character", "profile"),
  section("demographics", "character", "demographics"),
  section("politics", "character", "politics"),
  section("campaign-song", "character", "campaignSong"),
  section("character-danger", "character", "characterDanger"),
];

export const IMPERIAL_SECTIONS: SectionDef[] = [
  section("imperial-profile", "character", "imperialProfile"),
  section("royal-identity", "character", "royalIdentity"),
  section("royal-anthem", "character", "royalAnthem"),
];

export const ALL_SECTIONS = [...ACCOUNT_SECTIONS, ...CHARACTER_SECTIONS, ...IMPERIAL_SECTIONS];

export interface Recommendation {
  id: string;
  icon: ReactNode;
  label: string;
  action: "link" | "section";
  href?: string;
  sectionId?: SectionId;
}
