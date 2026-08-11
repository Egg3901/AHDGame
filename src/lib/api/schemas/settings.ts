import { z } from "zod";
import { containsBlockedName } from "@/lib/moderation";
import { getAllDemographicCategoryKeys } from "@/lib/demographics/countryDemographics";

function moderatedNameSchema(
  label: string,
  minLength: number,
  maxLength: number,
  characterPattern?: RegExp,
  characterPatternMessage?: string
) {
  let schema = z
    .string()
    .trim()
    .min(minLength, `${label} must be at least ${minLength} characters`)
    .max(maxLength, `${label} must be at most ${maxLength} characters`);

  if (characterPattern) {
    schema = schema.regex(
      characterPattern,
      characterPatternMessage ?? `${label} can only contain valid characters`
    );
  }

  return schema.refine((value) => !containsBlockedName(value), {
    message: `${label} contains prohibited language`,
  });
}

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

export const setPasswordSchema = z.object({
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
});

export const characterNameSchema = z.object({
  name: moderatedNameSchema(
    "Name",
    3,
    30,
    /^[a-zA-Z0-9 ]+$/,
    "Name can only contain letters, numbers, and spaces"
  ),
});

export const characterDemographicsSchema = z.object({
  race: z.enum(["white", "black", "hispanic", "asian", "other"]),
  gender: z.enum(["male", "female", "nonbinary"]),
  education: z.enum(["no_college", "college", "graduate"]),
  wealth: z.enum(["low", "middle", "high"]),
});

export const createCharacterSchema = z.object({
  name: moderatedNameSchema("Name", 2, 50),
  homeState: z.string().min(1, "Home state required"),
  // The country picked by the user at character creation. Used to scope the
  // state lookup so cross-country state-ID collisions (e.g. CN HB / DE HB)
  // can't accidentally home a character in the wrong country.
  countryId: z.string().min(2).max(3),
  party: z.string().min(1).optional().default("independent"),
  policies: z.object({
    economic: z.number().min(-5).max(5),
    social: z.number().min(-5).max(5),
    domainPositions: z.record(z.string(), z.number()).optional(),
  }),
  demographics: characterDemographicsSchema,
  // RPG stat allocation (28 points). Shape-validated here; the exact 28-sum /
  // 1–10 contract is enforced by validateStatAllocation in the route. Optional
  // so legacy/automated creation paths still work (those chars are grandfathered).
  stats: z.record(z.string(), z.number()).optional(),
  // @deprecated The pre-plan tutorial axis. The tutorial choice now happens in
  // the welcome flow after creation and is written to `Character.tutorial` by
  // PUT /api/tutorial/plan. Still accepted so older clients and automated
  // creation paths do not 400; absent means the full experience.
  tutorialTrack: z.enum(["politics", "complete"]).optional(),
});

export const characterTransferSchema = z.object({
  // `amount` is in the sender's local home currency (same unit as their balance).
  amount: z.coerce.number().int().min(1000, "Minimum transfer is 1,000"),
});

export const partyTransferSchema = z.object({
  stateId: z.string().min(1, "stateId is required"),
  amount: z.coerce.number().int().min(1000, "Transfer amount must be at least $1,000"),
});

export const themeSchema = z.object({
  theme: z.enum([
    "light",
    "default",
    "oled",
    "usa",
    "pastel",
    "dark-pastel",
    "retro",
    "solarized",
    "cloakroom",
    "broadsheet",
    "coldwar",
    "command-1953",
  ]),
});

export const statusBarLayoutSchema = z.object({
  layout: z.enum(["standard", "corp", "elections", "full", "minimal"]),
});

export const policyShiftSchema = z.object({
  axis: z.enum(["economic", "social"]),
  direction: z.union([z.literal(-1), z.literal(1)]),
});

export const profileBioSchema = z.object({
  bio: z
    .string()
    .max(500, "Bio must be 500 characters or fewer")
    .transform((s) => s.trim()),
});

export const campaignSongSchema = z.object({
  campaignSongUrl: z.string().max(300, "URL too long").optional().or(z.literal("")),
  campaignSongAutoplay: z.boolean().optional(),
});

export const autoplayPreferenceSchema = z.object({
  disableAutoplayOnOtherProfiles: z.boolean(),
});

export const experimentalUiSchema = z.object({
  enableExperimentalUI: z.boolean(),
});

export const autoRunForReelectionSchema = z.object({
  autoRunForReelection: z.boolean(),
});

export const actionsViewModeSchema = z.object({
  actionsViewMode: z.enum(["cards", "compact"]),
});

export const displayCurrencyPreferenceSchema = z.object({
  displayCurrencyPreference: z.enum([
    "local",
    "home",
    "internal",
    "USD",
    "GBP",
    "JPY",
    "CAD",
    "EUR",
    "BRL",
    "CNY",
    "NGN",
  ]),
});

export type DisplayCurrencyPreferenceBody = z.infer<typeof displayCurrencyPreferenceSchema>;

export const MAX_TAX_RATE = 33;

export const taxRateSchema = z.object({
  taxRate: z.coerce
    .number()
    .int()
    .min(0, "Tax rate must be at least 0")
    .max(MAX_TAX_RATE, `Tax rate must be at most ${MAX_TAX_RATE}%`),
});

export const statePartyTransferSchema = z.object({
  amount: z.coerce.number().int().min(1000, "Transfer amount must be at least $1,000"),
});

export const partyDonateSchema = z.object({
  amount: z.coerce.number().int().min(1000, "Donation amount must be at least 1,000"),
});

export const MAX_GOTV_PERCENT = 25;

// Valid GOTV/suppression target categories — US Layer-1 dimensions plus every
// country's `<cc>_voterGroups` bucket. Derived from the demographics SSOT so new
// countries are covered automatically (previously hardcoded to UK+JP, which
// rejected de/ie/cn/br treasurers — bug #0700).
const demographicCategories = getAllDemographicCategoryKeys() as [string, ...string[]];

export const gotvBudgetSchema = z.object({
  gotvBudgetPercent: z.coerce
    .number()
    .int()
    .min(0, "GOTV budget must be at least 0%")
    .max(MAX_GOTV_PERCENT, `GOTV budget cannot exceed ${MAX_GOTV_PERCENT}%`),
  gotvTargetCategory: z.enum(demographicCategories).optional(),
  gotvTargetGroup: z.string().optional(),
});

export const suppressionBudgetSchema = z.object({
  suppressionBudgetPercent: z.coerce
    .number()
    .int()
    .min(0, "Suppression budget must be at least 0%")
    .max(MAX_GOTV_PERCENT, `Suppression budget cannot exceed ${MAX_GOTV_PERCENT}%`),
  suppressionTargetCategory: z.enum(demographicCategories).optional(),
  suppressionTargetGroup: z.string().optional(),
});

// Voter-registration drive budget (player suggestion #81). Same 0-25 bounds
// shape as GOTV; no demographic target — registration is a per-party-per-state
// lane with no demographic dimension.
export const registrationBudgetSchema = z.object({
  registrationBudgetPercent: z.coerce
    .number()
    .int()
    .min(0, "Registration budget must be at least 0%")
    .max(MAX_GOTV_PERCENT, `Registration budget cannot exceed ${MAX_GOTV_PERCENT}%`),
});

export const MAX_ORG_BUILDING_PERCENT = 75;

export const orgBuildingBudgetSchema = z.object({
  orgBuildingPercent: z.coerce
    .number()
    .int()
    .min(0, "Org building budget must be at least 0%")
    .max(
      MAX_ORG_BUILDING_PERCENT,
      `Org building budget cannot exceed ${MAX_ORG_BUILDING_PERCENT}%`
    ),
});

export type ChangePasswordBody = z.infer<typeof changePasswordSchema>;
export type SetPasswordBody = z.infer<typeof setPasswordSchema>;
export type CharacterNameBody = z.infer<typeof characterNameSchema>;
export type CreateCharacterBody = z.infer<typeof createCharacterSchema>;
export type CharacterTransferBody = z.infer<typeof characterTransferSchema>;
export type PartyTransferBody = z.infer<typeof partyTransferSchema>;
export type ThemeBody = z.infer<typeof themeSchema>;
export type PolicyShiftBody = z.infer<typeof policyShiftSchema>;
export type ProfileBioBody = z.infer<typeof profileBioSchema>;
export type TaxRateBody = z.infer<typeof taxRateSchema>;
export type StatePartyTransferBody = z.infer<typeof statePartyTransferSchema>;
export type CampaignSongBody = z.infer<typeof campaignSongSchema>;
export type AutoplayPreferenceBody = z.infer<typeof autoplayPreferenceSchema>;
export type ActionsViewModeBody = z.infer<typeof actionsViewModeSchema>;
export type GotvBudgetBody = z.infer<typeof gotvBudgetSchema>;
export type SuppressionBudgetBody = z.infer<typeof suppressionBudgetSchema>;
export type RegistrationBudgetBody = z.infer<typeof registrationBudgetSchema>;
export type CharacterDemographicsBody = z.infer<typeof characterDemographicsSchema>;
export type OrgBuildingBudgetBody = z.infer<typeof orgBuildingBudgetSchema>;
