import { z } from "zod";
import { MAX_REGION_ID_LENGTH } from "@/lib/constants/states";
import { WAGE_LEVEL_MIN, WAGE_LEVEL_MAX } from "@/lib/labour/laborCost";
import {
  CORPORATION_TYPES,
  MAX_GROWTH_RATE,
  MIN_GROWTH_RATE,
  MAX_DIVIDEND_RATE,
  IPO_MIN_FLOAT_PCT,
  IPO_MAX_FLOAT_PCT,
} from "@/lib/constants/corporations";
import {
  SUPERSHARE_MIN_MULTIPLIER,
  SUPERSHARE_MAX_MULTIPLIER,
  SUPERSHARE_IPO_MAX_FLOAT_PCT,
} from "@/lib/corporations/superShares";
import { containsBlockedName } from "@/lib/moderation";
import { ZOD_CURRENCY_ENUM } from "@/lib/constants/currencies";
import { countryIdSchema } from "@/lib/api/schemas/country";
import { schemas } from "@/lib/api/validate";

function moderatedNameSchema(label: string, minLength: number, maxLength: number) {
  return z
    .string()
    .trim()
    .min(minLength, `${label} must be at least ${minLength} characters`)
    .max(maxLength, `${label} must be ${maxLength} characters or less`)
    .refine((value) => !containsBlockedName(value), {
      message: `${label} contains prohibited language`,
    });
}

/**
 * Shared IPO terms (founding IPO and late go-public). A single-class IPO may
 * float up to IPO_MAX_FLOAT_PCT; floating more requires adopting a dual-class
 * supershare structure so the founder keeps voting control.
 */
const ipoTermsSchema = z
  .object({
    floatPct: z
      .number()
      .int("Float percentage must be a whole number")
      .min(IPO_MIN_FLOAT_PCT, `Float must be at least ${IPO_MIN_FLOAT_PCT}%`)
      .max(SUPERSHARE_IPO_MAX_FLOAT_PCT, `Float cannot exceed ${SUPERSHARE_IPO_MAX_FLOAT_PCT}%`),
    superShareMultiplier: z
      .number()
      .int("Supershare multiplier must be a whole number")
      .min(SUPERSHARE_MIN_MULTIPLIER, `Multiplier must be at least ${SUPERSHARE_MIN_MULTIPLIER}×`)
      .max(SUPERSHARE_MAX_MULTIPLIER, `Multiplier cannot exceed ${SUPERSHARE_MAX_MULTIPLIER}×`)
      .optional(),
  })
  .refine((v) => v.floatPct <= IPO_MAX_FLOAT_PCT || v.superShareMultiplier !== undefined, {
    message: `Floating more than ${IPO_MAX_FLOAT_PCT}% requires a dual-class supershare structure`,
  });

export const foundCorporationSchema = z.object({
  name: moderatedNameSchema("Name", 2, 60),
  tickerSymbol: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(
      z
        .string()
        .regex(/^[A-Z]{1,5}$/, "Ticker must be 1–5 letters (A–Z), no numbers or symbols")
        .refine((v) => !containsBlockedName(v), {
          message: "Ticker contains prohibited language",
        })
    ),
  type: z.enum(CORPORATION_TYPES),
  /**
   * Shape only. The real bounds are era-scaled and therefore not knowable
   * here: a 1953 world's minimum is ~1/70th of the modern one, so validating
   * the modern `MIN_CORPORATION_STARTING_CAPITAL` at the schema layer
   * rejected every legal founding in that era before the route could apply
   * the era bounds it already computes. The route enforces
   * `getEraFoundingBounds` min/max against the live preset.
   */
  startingCapital: z
    .number()
    .int("Starting capital must be a whole number")
    .positive("Starting capital must be a positive amount")
    .optional(),
  secondaryType: z.enum(CORPORATION_TYPES).optional(),
  ipo: ipoTermsSchema.optional(),
});

export const goPublicSchema = ipoTermsSchema;

export const privatizationVoteSchema = z.object({
  vote: z.enum(["yes", "no"]),
});

export const updateCorporationSettingsSchema = z.object({
  marketingBudget: z.number().min(0, "Marketing budget cannot be negative").optional(),
  logisticsBudget: z.number().min(0, "Logistics budget cannot be negative").optional(),
  rdBudget: z.number().min(0, "R&D budget cannot be negative").optional(),
  ceoSalary: z.number().min(0, "CEO salary cannot be negative").optional(),
  shareBuybackMode: z.enum(["instant", "escrow"]).optional(),
  escrowFundingPerTurn: z.number().min(0, "Escrow funding cannot be negative").optional(),
  description: z.string().max(500, "Description must be 500 characters or less").trim().optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color (e.g. #3b82f6)")
    .optional(),
  /** Clear with null; must be https URL or app-upload path */
  headerImageUrl: z
    .union([
      z
        .string()
        .min(1)
        .refine((s) => /^https?:\/\//.test(s) || s.startsWith("/api/"), "Invalid header image URL"),
      z.null(),
    ])
    .optional(),
  secondaryType: z.enum(CORPORATION_TYPES).nullable().optional(),
  primaryType: z.enum(CORPORATION_TYPES).optional(),
});

export const renameCorporationSchema = z.object({
  name: moderatedNameSchema("Name", 2, 60),
});

/**
 * Shape only. Membership is NOT checked against US HOUSE_SEATS (`STATE_IDS`) —
 * non-US regions (e.g. UK `YHU`) are valid expansion targets. This was refined
 * against `STATE_IDS`, which is not a list of the world's regions: it rejected
 * every non-US region id before the route ran, so no non-US corporation could
 * open OR split a sector at all.
 *
 * The real check is in `expandSector`, which resolves the id against the
 * `states` collection scoped to the corporation's own country. That is strictly
 * stronger than any allowlist here — it proves the region exists AND that the
 * corp may build there — and it is country-agnostic.
 */
export const expandSectorSchema = z.object({
  stateId: z
    .string()
    .trim()
    .min(1, "Invalid state ID")
    .max(MAX_REGION_ID_LENGTH, "Invalid state ID"),
  sectorType: z.enum(CORPORATION_TYPES).optional(),
});

export const setGrowthRateSchema = z.object({
  targetGrowthRate: z
    .number()
    .min(MIN_GROWTH_RATE, `Growth rate cannot be below ${MIN_GROWTH_RATE}%`)
    .max(MAX_GROWTH_RATE, `Growth rate cannot exceed ${MAX_GROWTH_RATE}%`),
  preview: z.boolean().optional().default(false),
});

export const setDividendRateSchema = z.object({
  dividendRate: z
    .number()
    .min(0, "Dividend rate cannot be negative")
    .max(MAX_DIVIDEND_RATE, `Dividend rate cannot exceed ${MAX_DIVIDEND_RATE}%`),
});

export const sellSharesSchema = z.object({
  shares: z.number().int().positive("Must sell at least 1 share"),
  sellAsCorporation: z.boolean().optional().default(false),
  // When a sale would divest a CEO's entire remaining stake (auto-vacating the
  // seat), the route returns 409 requiresCeoVacateConfirm unless this is true.
  confirmCeoVacate: z.boolean().optional().default(false),
});

export const buySharesSchema = z.object({
  shares: z.number().int().positive("Must buy at least 1 share"),
  buyAsCorporation: z.boolean().optional().default(false),
  payCurrency: z.enum(ZOD_CURRENCY_ENUM).optional(),
});

export const placeOrderSchema = z.object({
  type: z.enum(["buy", "sell"]),
  shares: z.number().int().positive("Must be at least 1 share"),
  pricePerShare: z.number().positive("Price must be positive"),
  placeAsCorporation: z.boolean().optional().default(false),
});

export const issueSharesSchema = z.object({
  percent: z
    .number()
    .min(0.01, "Must issue at least 0.01%")
    .max(50, "Cannot issue more than 50% of outstanding shares"),
});

export const selfIssueSharesSchema = z.object({
  shares: z.number().int().positive("Must purchase at least 1 share"),
});

export const consolidateSharesSchema = z.object({
  targetTotalShares: z
    .number()
    .int("Whole shares only")
    .positive("Target must be at least 1 share"),
});

export const fillOrderSchema = z.object({
  shares: z.number().int().positive("Must fill at least 1 share"),
  /** When true and the open order is a sell (ask), pay from the CEO's corporation liquid capital and credit shares to that corporation. */
  fillAsCorporation: z.boolean().optional().default(false),
});

export const setSectorStrategySchema = z.object({
  strategyId: z.string().min(1).max(50),
});

export const setSectorPolicySchema = z.object({
  productionPolicy: z.number().min(-25).max(25),
});

// Posted-price market clearing (marketSystemMode >= "clearing"): posture is
// the CEO's price relative to market, -20%..+20%; null reverts to auto.
export const setSectorPricingSchema = z.object({
  pricingPosture: z.number().min(-0.2).max(0.2).nullable(),
});

export const setSectorWageLevelSchema = z.object({
  wageLevel: z.number().min(WAGE_LEVEL_MIN).max(WAGE_LEVEL_MAX),
});

export const bulkSectorOperationsSchema = z
  .object({
    countryId: countryIdSchema,
    // Omitted/null → apply to every sector type the corp holds in this country (Corporate-Wide).
    sectorType: z.enum(CORPORATION_TYPES).optional(),
    targetGrowthRate: z
      .number()
      .min(MIN_GROWTH_RATE, `Growth rate cannot be below ${MIN_GROWTH_RATE}%`)
      .max(MAX_GROWTH_RATE, `Growth rate cannot exceed ${MAX_GROWTH_RATE}%`)
      .optional(),
    productionPolicy: z.number().min(-25).max(25).optional(),
    // Posted-price posture (−20%…+20% vs market); null = Auto. Requires clearing mode.
    pricingPosture: z.number().min(-0.2).max(0.2).nullable().optional(),
    preview: z.boolean().optional().default(false),
  })
  .refine(
    (d) =>
      d.targetGrowthRate !== undefined ||
      d.productionPolicy !== undefined || // pragma: allowlist secret
      d.pricingPosture !== undefined,
    {
      message: "Need growth, production policy, and/or pricing", // pragma: allowlist secret
    }
  );

export const setSectorDisplayNameSchema = z.object({
  displayName: z
    .string()
    .trim()
    .max(40, "Sector name must be 40 characters or less")
    .refine((value) => value.length === 0 || !containsBlockedName(value), {
      message: "Sector name contains prohibited language",
    })
    .nullable(),
});

export const createListingSchema = z.object({
  shares: z.number().int().positive("Must list at least 1 share"),
  sellAsCorporation: z.boolean().optional().default(false),
  // When a listing would divest a CEO's entire remaining stake (auto-vacating
  // the seat), the route returns 409 requiresCeoVacateConfirm unless this is true.
  confirmCeoVacate: z.boolean().optional().default(false),
});

export const submitOfferSchema = z.object({
  shares: z.number().int().positive("Must offer at least 1 share"),
  pricePerShare: z.number().positive("Price must be positive"),
  offerAsCorporation: z.boolean().optional().default(false),
});

export const acceptOfferSchema = z.object({
  sharesToAccept: z.number().int().positive("Must accept at least 1 share"),
});

export const hostileTakeoverSchema = z.object({
  parentCorporationId: schemas.objectId,
});

export const parentBondPayoffSchema = z.object({
  parentCorporationId: schemas.objectId,
});
