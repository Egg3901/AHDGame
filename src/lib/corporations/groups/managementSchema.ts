import { z } from "zod";
export const groupManagementSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("identity"), name: z.string().trim().min(2).max(60) }).strict(),
  z.object({ action: z.literal("policy"), policy: z.enum(["independent", "members"]) }).strict(),
  z.object({ action: z.literal("participation"), enabled: z.boolean() }).strict(),
  z
    .object({
      action: z.literal("direction"),
      memberId: z.string().regex(/^[a-f0-9]{24}$/i),
      objective: z.enum(["balanced", "profit", "capacity", "expansion", "regional", "stability"]),
      regions: z.array(z.string().trim().min(1).max(80)).max(8),
      allowInvestment: z.boolean(),
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
