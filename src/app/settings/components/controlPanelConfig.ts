import type { SectionId } from "./shared";
import type { SectionDef } from "./sectionsConfig";

export type SettingsBucketId = "account" | "game" | "interface" | "audio" | "data";

export interface SettingsBucket {
  id: SettingsBucketId;
  /** Message ids under the "settings" namespace, resolved via t() in the rendering component. */
  labelKey: string;
  eyebrowKey: string;
  summaryKey: string;
  sectionIds: SectionId[];
  quickKeywords: string[];
}

const bucketKeys = (id: SettingsBucketId) => ({
  labelKey: `buckets.${id}.label`,
  eyebrowKey: `buckets.${id}.eyebrow`,
  summaryKey: `buckets.${id}.summary`,
});

/**
 * The order is part of the information architecture. Keep these buckets stable
 * even when individual controls are added or retired.
 */
export const CONTROL_PANEL_BUCKETS: SettingsBucket[] = [
  {
    id: "account",
    ...bucketKeys("account"),
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
    ...bucketKeys("game"),
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
    ...bucketKeys("interface"),
    sectionIds: ["appearance"],
    quickKeywords: ["theme", "accessibility", "language", "contrast", "motion", "status bar"],
  },
  {
    id: "audio",
    ...bucketKeys("audio"),
    sectionIds: ["campaign-song", "royal-anthem"],
    quickKeywords: ["sound", "volume", "audio", "event sound", "music", "campaign song", "anthem"],
  },
  {
    id: "data",
    ...bucketKeys("data"),
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

export function sectionMatchesQuery(section: SectionDef, query: string, localizedText = "") {
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
  return `${localizedText} ${section.id.replaceAll("-", " ")} ${aliases[section.id] ?? ""}`
    .toLocaleLowerCase()
    .includes(normalized);
}

export function bucketQuickSettingsMatch(
  bucket: SettingsBucket,
  query: string,
  localizedText = ""
) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return `${localizedText} ${bucket.quickKeywords.join(" ")}`
    .toLocaleLowerCase()
    .includes(normalized);
}
