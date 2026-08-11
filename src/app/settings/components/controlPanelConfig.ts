import type { SectionId } from "./shared";
import type { SectionDef } from "./sectionsConfig";

export type SettingsBucketId = "account" | "game" | "interface" | "audio" | "data";

export interface SettingsBucket {
  id: SettingsBucketId;
  label: string;
  eyebrow: string;
  summary: string;
  sectionIds: SectionId[];
  quickKeywords: string[];
}

/**
 * The order is part of the information architecture. Keep these buckets stable
 * even when individual controls are added or retired.
 */
export const CONTROL_PANEL_BUCKETS: SettingsBucket[] = [
  {
    id: "account",
    label: "Account",
    eyebrow: "Identity & access",
    summary: "Sign-in methods, security, supporter benefits, and account actions.",
    sectionIds: [
      "account-profile",
      "identity",
      "security",
      "patreon",
      "supporter-perks",
      "referrals",
      "danger",
    ],
    quickKeywords: ["login", "email", "password", "security", "delete", "discord", "google"],
  },
  {
    id: "game",
    label: "Game",
    eyebrow: "Play preferences",
    summary: "Your country, live turn cadence, notifications, and character setup.",
    sectionIds: [
      "profile",
      "imperial-profile",
      "royal-identity",
      "politics",
      "demographics",
      "achievements",
      "character-danger",
    ],
    quickKeywords: [
      "turn",
      "speed",
      "cadence",
      "notification",
      "alerts",
      "country",
      "default country",
    ],
  },
  {
    id: "interface",
    label: "Interface",
    eyebrow: "Look & feel",
    summary: "Theme, navigation, status bar, accessibility, and language.",
    sectionIds: ["appearance"],
    quickKeywords: ["theme", "accessibility", "language", "contrast", "motion", "status bar"],
  },
  {
    id: "audio",
    label: "Audio",
    eyebrow: "Sound",
    summary: "Game sound level, event sounds, and profile music.",
    sectionIds: ["campaign-song", "royal-anthem"],
    quickKeywords: ["sound", "volume", "audio", "event sound", "music", "campaign song", "anthem"],
  },
  {
    id: "data",
    label: "Data",
    eyebrow: "Storage & automation",
    summary: "Export or import device preferences, clear local data, and manage API access.",
    sectionIds: ["api-keys", "retired-characters"],
    quickKeywords: ["export", "import", "cache", "reset", "api", "key", "retired", "history"],
  },
];

export const ADVANCED_SECTION_IDS = new Set<SectionId>([
  "patreon",
  "supporter-perks",
  "referrals",
  "demographics",
  "achievements",
  "api-keys",
  "retired-characters",
  "royal-identity",
]);

export function bucketForSection(id: SectionId) {
  return CONTROL_PANEL_BUCKETS.find((bucket) => bucket.sectionIds.includes(id));
}

export function sectionMatchesQuery(section: SectionDef, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const aliases: Partial<Record<SectionId, string>> = {
    "account-profile": "username email account",
    identity: "login sign in oauth connected discord google",
    security: "password authentication login",
    danger: "delete close resign account",
    profile: "character name bio avatar header image",
    "imperial-profile": "character name avatar",
    politics: "policy election reelection",
    appearance: "theme navigation interface status bar autoplay video",
    "campaign-song": "audio music profile song autoplay",
    "royal-anthem": "audio music profile anthem",
    "api-keys": "automation developer data",
    "retired-characters": "history records archive wrapped",
  };
  return `${section.label} ${section.summary} ${section.id.replaceAll("-", " ")} ${aliases[section.id] ?? ""}`
    .toLocaleLowerCase()
    .includes(normalized);
}

export function bucketQuickSettingsMatch(bucket: SettingsBucket, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return `${bucket.label} ${bucket.summary} ${bucket.quickKeywords.join(" ")}`
    .toLocaleLowerCase()
    .includes(normalized);
}
