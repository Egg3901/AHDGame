/**
 * Startup environment validation.
 *
 * Validates required environment variables the first time a runtime path
 * needs them, so builds can compile safely while requests still fail closed
 * before any auth or database work runs without secrets.
 *
 * Import this module in `mongodb.ts` and `auth.ts` so runtime callers share
 * the same validation and error formatting.
 *
 * In the test environment (NODE_ENV==="test") validation is skipped so
 * unit/integration tests can run without setting up real credentials.
 */

import { z } from "zod";

const envSchema = z.preprocess(
  (raw) => {
    const env = raw as NodeJS.ProcessEnv;
    return {
      ...env,
      // Railway's MongoDB template exposes MONGO_URL by default. Keep MONGODB_URI
      // as the canonical app variable, but accept MONGO_URL as a deployment alias.
      MONGODB_URI: env.MONGODB_URI || env.MONGO_URL,
      // Accept both historical DB-name env vars; runtime code treats MONGODB_DB
      // as canonical while still honoring MONGO_DB_NAME for older deployments.
      MONGODB_DB: env.MONGODB_DB || env.MONGO_DB_NAME,
    };
  },
  z.object({
    MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
    MONGODB_DB: z.string().min(1).optional(),
    AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters"),
    ADMIN_REGISTRATION_KEY: z.string().min(1, "ADMIN_REGISTRATION_KEY is required"),
    CRON_SECRET: z.string().min(1, "CRON_SECRET is required"),
    // Optional - Vercel Blob storage (legacy, migrating to Cloudflare R2)
    BLOB_READ_WRITE_TOKEN: z.string().optional(),
    // Optional - Cloudflare R2 storage for image uploads
    CLOUDFLARE_R2_ACCOUNT_ID: z.string().optional(),
    CLOUDFLARE_R2_ACCESS_KEY_ID: z.string().optional(),
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string().optional(),
    CLOUDFLARE_R2_BUCKET_NAME: z.string().optional(),
    CLOUDFLARE_R2_PUBLIC_URL: z.string().optional(),
    // Optional - GitHub issue creation from in-app feedback
    GIT_TOKEN: z.string().optional(),
    GITHUB_REPO: z.string().optional(),
    // Optional - secret required to register when test mode is enabled
    TEST_SECRET: z.string().optional(),
  })
);

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;
const MISSING_ENV_ERROR_PREFIX = "Missing or invalid environment variables:";

function validateEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `${MISSING_ENV_ERROR_PREFIX}\n${missing}\n\n` +
        "Set these in .env.local for local development or in your deployment environment variables for hosted builds."
    );
  }
  return parsed.data;
}

// Validate lazily on first runtime use so `next build` can compile route modules
// before Railway/Vercel inject request-time secrets, while requests still fail
// closed the first time auth/DB code actually needs these values.
export function getValidatedEnv(): Env {
  if (process.env.NODE_ENV === "test") {
    return process.env as unknown as Env;
  }

  if (!cachedEnv) {
    cachedEnv = validateEnv();
  }

  return cachedEnv;
}

export function isMissingRequiredEnvError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(MISSING_ENV_ERROR_PREFIX);
}
