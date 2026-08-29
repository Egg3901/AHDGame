import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deploymentServiceSlug, ownsConfiguredWebhooks } from "./deploymentIdentity";

describe("deploymentServiceSlug", () => {
  it("slugifies the Railway service name", () => {
    expect(
      deploymentServiceSlug({ RAILWAY_SERVICE_NAME: "Main Site" } as unknown as NodeJS.ProcessEnv)
    ).toBe("main-site");
    expect(
      deploymentServiceSlug({
        RAILWAY_SERVICE_NAME: "Sandbox Staging",
      } as unknown as NodeJS.ProcessEnv)
    ).toBe("sandbox-staging");
  });

  it("prefers the service name over the environment name", () => {
    expect(
      deploymentServiceSlug({
        RAILWAY_SERVICE_NAME: "Main Site",
        RAILWAY_ENVIRONMENT_NAME: "production",
      } as unknown as NodeJS.ProcessEnv)
    ).toBe("main-site");
  });

  it("falls back to the environment name, then to local", () => {
    expect(
      deploymentServiceSlug({
        RAILWAY_ENVIRONMENT_NAME: "production",
      } as unknown as NodeJS.ProcessEnv)
    ).toBe("production");
    expect(deploymentServiceSlug({} as unknown as NodeJS.ProcessEnv)).toBe("local");
  });

  it("never returns an empty slug for a punctuation-only name", () => {
    expect(
      deploymentServiceSlug({ RAILWAY_SERVICE_NAME: "---" } as unknown as NodeJS.ProcessEnv)
    ).toBe("local");
  });
});

describe("ownsConfiguredWebhooks (#1208)", () => {
  const originalService = process.env.RAILWAY_SERVICE_NAME;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    delete process.env.RAILWAY_SERVICE_NAME;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.RAILWAY_SERVICE_NAME = originalService;
  });

  it("allows an unstamped config, so an existing live world is never silenced", () => {
    process.env.RAILWAY_SERVICE_NAME = "Anything";
    expect(ownsConfiguredWebhooks(undefined)).toBe(true);
    expect(ownsConfiguredWebhooks("")).toBe(true);
  });

  it("allows the deployment that owns the config", () => {
    process.env.RAILWAY_SERVICE_NAME = "Main Site";
    expect(ownsConfiguredWebhooks("main-site")).toBe(true);
  });

  it("blocks another deployment running the same restored database", () => {
    process.env.RAILWAY_SERVICE_NAME = "Sandbox Staging";
    expect(ownsConfiguredWebhooks("main-site")).toBe(false);
  });

  it("blocks a run outside Railway entirely", () => {
    expect(ownsConfiguredWebhooks("main-site")).toBe(false);
  });

  // A distinct pair, because the "log once" set is module state that outlives a
  // single test — reusing a pair another case already reported would make this
  // pass or fail on declaration order rather than on the behavior.
  it("says which deployment owns the config when it blocks, once per mismatch", () => {
    process.env.RAILWAY_SERVICE_NAME = "Replay Worker";
    expect(ownsConfiguredWebhooks("some-other-world")).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('owned by "some-other-world", running as "replay-worker"')
    );
    // A suppressed world posts on nearly every turn; the log must not grow with it.
    expect(ownsConfiguredWebhooks("some-other-world")).toBe(false);
    expect(ownsConfiguredWebhooks("some-other-world")).toBe(false);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
