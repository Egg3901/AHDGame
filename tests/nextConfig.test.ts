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
  const configureProductionBuild = (authToken: string | undefined): void => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
    vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", "0123456789abcdef0123456789abcdef01234567");

    if (authToken === undefined) {
      vi.stubEnv("SENTRY_AUTH_TOKEN", "restore-after-delete");
      delete process.env.SENTRY_AUTH_TOKEN;
      return;
    }

    vi.stubEnv("SENTRY_AUTH_TOKEN", authToken);
  };

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace-only", " \t "],
  ])("allows a production Railway build with a %s source-map token", async (_label, token) => {
    vi.resetModules();
    configureProductionBuild(token);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(import("../next.config")).resolves.toHaveProperty("default");

    expect(warn).toHaveBeenCalledWith(
      "[sentry] SENTRY_AUTH_TOKEN is not set; continuing without source-map upload."
    );
  });

  it("keeps source-map upload enabled when the token is present", async () => {
    vi.resetModules();
    configureProductionBuild("  test-sentry-token  ");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(import("../next.config")).resolves.toHaveProperty("default");

    expect(process.env.SENTRY_AUTH_TOKEN).toBe("test-sentry-token");
    expect(warn).not.toHaveBeenCalledWith(
      "[sentry] SENTRY_AUTH_TOKEN is not set; continuing without source-map upload."
    );
  });
});
