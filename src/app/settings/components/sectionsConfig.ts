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

export const DISCORD_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  linked: { text: "Discord account linked successfully.", ok: true },
  not_configured: { text: "Discord linking is not configured on this server.", ok: false },
  already_linked: { text: "This Discord account is already linked to another user.", ok: false },
  exchange_failed: { text: "Discord linking failed. Please try again.", ok: false },
  missing_params: { text: "Discord linking failed. Please try again.", ok: false },
  invalid_state: { text: "Discord linking expired. Please try again.", ok: false },
  session_expired: {
    text: "Discord linking expired or was interrupted. Please try again.",
    ok: false,
  },
  rate_limited: {
    text: "You're sending requests too quickly. Please wait a moment and try again.",
    ok: false,
  },
  access_denied: { text: "Discord authorization was denied.", ok: false },
};

export const GOOGLE_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  linked: { text: "Google account linked successfully.", ok: true },
  not_configured: { text: "Google linking is not configured on this server.", ok: false },
  already_linked: { text: "This Google account is already linked to another user.", ok: false },
  exchange_failed: { text: "Google linking failed. Please try again.", ok: false },
  missing_params: { text: "Google linking failed. Please try again.", ok: false },
  invalid_state: { text: "Google linking expired. Please try again.", ok: false },
  access_denied: { text: "Google authorization was denied.", ok: false },
};

export interface SectionDef {
  id: SectionId;
  label: string;
  group: "account" | "character";
  summary: string;
}

export const ACCOUNT_SECTIONS: SectionDef[] = [
  { id: "account-profile", label: "Profile", group: "account", summary: "Username & email" },
  {
    id: "identity",
    label: "Connected Accounts",
    group: "account",
    summary: "Discord, Google",
  },
  {
    id: "appearance",
    label: "Appearance",
    group: "account",
    summary: "Theme, experimental UI",
  },
  { id: "patreon", label: "Patreon", group: "account", summary: "Supporter benefits" },
  {
    id: "supporter-perks",
    label: "Supporter Perks",
    group: "account",
    summary: "Wall name, politician rename",
  },
  { id: "referrals", label: "Referrals", group: "account", summary: "Invite friends" },
  {
    id: "achievements",
    label: "Achievements",
    group: "account",
    summary: "Badges & milestones",
  },
  {
    id: "retired-characters",
    label: "Retired Characters",
    group: "account",
    summary: "Past character records",
  },
  { id: "security", label: "Security", group: "account", summary: "Password" },
  { id: "api-keys", label: "API Keys", group: "account", summary: "API access & automation" },
  { id: "danger", label: "Danger Zone", group: "account", summary: "Delete account" },
];

export const CHARACTER_SECTIONS: SectionDef[] = [
  {
    id: "profile",
    label: "Character Profile",
    group: "character",
    summary: "Name, bio, avatar, header image",
  },
  {
    id: "demographics",
    label: "Background",
    group: "character",
    summary: "Race, gender, education",
  },
  {
    id: "politics",
    label: "Policy Positions",
    group: "character",
    summary: "Economic & social",
  },
  {
    id: "campaign-song",
    label: "Campaign Song",
    group: "character",
    summary: "Profile music",
  },
  {
    id: "character-danger",
    label: "Character Danger Zone",
    group: "character",
    summary: "Retire character",
  },
];

export const IMPERIAL_SECTIONS: SectionDef[] = [
  {
    id: "imperial-profile" as SectionId,
    label: "Imperial Profile",
    group: "character",
    summary: "Name, bio, avatar, header image",
  },
  {
    id: "royal-identity" as SectionId,
    label: "Royal Identity",
    group: "character",
    summary: "Royal House, Coat of Arms",
  },
  {
    id: "royal-anthem" as SectionId,
    label: "Royal Anthem",
    group: "character",
    summary: "Profile music",
  },
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
