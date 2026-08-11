import { z } from "zod";
import { schemas } from "../validate";

const deviceKeySchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid device key")
  .optional();

const fingerprintComponentsSchema = z
  .object({
    canvas: z.string().max(256).optional(),
    webglRenderer: z.string().max(256).optional(),
    audio: z.string().max(256).optional(),
    fonts: z.string().max(2048).optional(),
    cores: z.number().int().nonnegative().max(1024).optional(),
    memory: z.number().nonnegative().max(1024).optional(),
    screen: z.string().max(512).optional(),
    timezone: z.string().max(128).optional(),
    platform: z.string().max(128).optional(),
    // Modest client entropy additions (forensics-v2 Part B) — see
    // `src/lib/utils/fingerprint.ts`'s `generateFingerprintData`.
    webglVendor: z.string().max(256).optional(),
    languages: z.string().max(256).optional(),
  })
  .strict()
  .optional();

export const loginBodySchema = z.object({
  email: z.string().min(1, "Email/username required"),
  password: schemas.password,
  fingerprint: z.string().optional(),
  deviceKey: deviceKeySchema,
  fingerprintComponents: fingerprintComponentsSchema,
});

export const registerBodySchema = z.object({
  email: schemas.email,
  username: schemas.username,
  password: z.string().min(8, "Password must be at least 8 characters"),
  adminKey: z.string().optional(),
  fingerprint: z.string().optional(),
  deviceKey: deviceKeySchema,
  fingerprintComponents: fingerprintComponentsSchema,
  turnstileToken: z.string().optional(),
  referralCode: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-f0-9]{24}$/, "Invalid referral code")
    .optional(),
  testSecret: z.string().optional(),
  ageConfirmed: z.boolean().refine((val) => val === true, {
    message: "You must confirm that you are at least 13 years old",
  }),
  termsAccepted: z.boolean().refine((val) => val === true, {
    message: "You must accept the Terms of Service and Privacy Policy",
  }),
});

export const forgotPasswordBodySchema = z.object({
  identifier: z.string().min(1, "Email or username required").max(320),
  turnstileToken: z.string().optional(),
});

export const resetPasswordBodySchema = z.object({
  token: z.string().min(1, "Reset token required").max(256),
  // Same strength rule as the change-password schema (settings.ts).
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;
export type RegisterBody = z.infer<typeof registerBodySchema>;
