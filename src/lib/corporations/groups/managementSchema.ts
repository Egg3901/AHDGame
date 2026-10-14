import { z } from "zod";
import { SUPPLY_AGREEMENT_PRICE_BAND } from "@/lib/db/types/supplyAgreement";
export const groupManagementSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("identity"), name: z.string().trim().min(2).max(60) }).strict(),
  z.object({ action: z.literal("policy"), policy: z.enum(["independent", "members"]) }).strict(),
  z
    .object({
      action: z.literal("discount"),
      discount: z.number().finite().min(0).max(SUPPLY_AGREEMENT_PRICE_BAND),
    })
    .strict(),
  z.object({ action: z.literal("participation"), enabled: z.boolean() }).strict(),
  z
    .object({
      action: z.literal("direction"),
      memberId: z.string().regex(/^[a-f0-9]{24}$/i),
      objective: z.enum(["balanced", "profit", "capacity", "expansion", "regional", "stability"]),
      regions: z.array(z.string().trim().min(1).max(80)).max(8),
      allowInvestment: z.boolean(),
      primaryIndustryOnly: z.boolean().optional(),
    })
    .strict()
    .refine((v) => v.objective !== "regional" || v.regions.length > 0, {
      message: "Choose a target region",
    }),
  z
    .object({
      action: z.literal("respond"),
      response: z.enum(["acknowledged", "declined"]),
      revision: z.string().uuid(),
    })
    .strict(),
]);
export type GroupManagementCommand = z.infer<typeof groupManagementSchema>;
