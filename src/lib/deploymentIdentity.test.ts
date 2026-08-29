import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deploymentServiceSlug, ownsConfiguredWebhooks } from "./deploymentIdentity";

describe("deploymentServiceSlug", () => {
  it("slugifies the Railway service name", () => {
    expect(deploymentServiceSlug({ RAILWAY_SERVICE_NAME: "Main Site" } as NodeJS.ProcessEnv)).toBe(
      "main-site"
    );
    expect(
      deploymentServiceSlug({ RAILWAY_SERVICE_NAME: "Sandbox Staging" } as NodeJS.ProcessEnv)
    ).toBe("sandbox-staging");
  });

  it("prefers the service name over the environment name", () => {
    expect(
      deploymentServiceSlug({
        RAILWAY_SERVICE_NAME: "Main Site",
        RAILWAY_ENVIRONMENT_NAME: "production",
      } as NodeJS.ProcessEnv)
    ).toBe("main-site");
  });

  it("falls back to the environment name, then to local", () => {
    expect(
      deploymentServiceSlug({ RAILWAY_ENVIRONMENT_NAME: "production" } as NodeJS.ProcessEnv)
    ).toBe("production");
    expect(deploymentServiceSlug({} as NodeJS.ProcessEnv)).toBe("local");
  });

  it("never returns an empty slug for a punctuation-only name", () => {
    expect(deploymentServiceSlug({ RAILWAY_SERVICE_NAME: "---" } as NodeJS.ProcessEnv)).toBe(
      "local"
    );
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

  it("says which deployment owns the config when it blocks", () => {
    process.env.RAILWAY_SERVICE_NAME = "Sandbox Staging";
    ownsConfiguredWebhooks("main-site");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('owned by "main-site", running as "sandbox-staging"')
    );
  });
});
