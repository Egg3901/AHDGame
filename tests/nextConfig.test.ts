import { afterEach, describe, expect, it, vi } from "vitest";

const originalSentryRelease = process.env.SENTRY_RELEASE;
const originalPublicSentryRelease = process.env.NEXT_PUBLIC_SENTRY_RELEASE;
const originalPublicSentryEnvironment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT;

const restoreEnv = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();

  restoreEnv("SENTRY_RELEASE", originalSentryRelease);
  restoreEnv("NEXT_PUBLIC_SENTRY_RELEASE", originalPublicSentryRelease);
  restoreEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", originalPublicSentryEnvironment);
});

describe("next.config Sentry build setup", () => {
  it("allows a production Railway build without a source-map upload token", async () => {
    vi.resetModules();
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
    vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", "0123456789abcdef0123456789abcdef01234567");
    vi.stubEnv("SENTRY_AUTH_TOKEN", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(import("../next.config")).resolves.toHaveProperty("default");

    expect(warn).toHaveBeenCalledWith(
      "[sentry] SENTRY_AUTH_TOKEN is not set; continuing without source-map upload."
    );
  });
});
