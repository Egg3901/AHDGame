import { describe, it, expect } from "vitest";
import { computeAuthCookieName } from "./authCookieName";

// Prevents the cross-environment cookie collision that caused users on
// sandbox + live in the same browser to log each other out: both used
// `auth-token` on `.ahousedividedgame.com`, overwriting each other every
// request. Env-prefixed names live side-by-side in the browser.

describe("computeAuthCookieName", () => {
  it("uses RAILWAY_SERVICE_NAME (slugified) when set", () => {
    expect(computeAuthCookieName({ RAILWAY_SERVICE_NAME: "Sandbox Staging" } as never)).toBe(
      "auth-token-sandbox-staging"
    );
    expect(computeAuthCookieName({ RAILWAY_SERVICE_NAME: "Main Site" } as never)).toBe(
      "auth-token-main-site"
    );
  });

  it("falls back to RAILWAY_ENVIRONMENT_NAME when service name is absent", () => {
    expect(computeAuthCookieName({ RAILWAY_ENVIRONMENT_NAME: "production" } as never)).toBe(
      "auth-token-production"
    );
  });

  it("returns auth-token-local when no Railway env vars are present", () => {
    expect(computeAuthCookieName({} as never)).toBe("auth-token-local");
  });

  it("strips non-alphanumeric punctuation and collapses runs", () => {
    expect(computeAuthCookieName({ RAILWAY_SERVICE_NAME: "weird/!@name__here" } as never)).toBe(
      "auth-token-weird-name-here"
    );
  });

  it("trims leading and trailing dashes after slugification", () => {
    expect(computeAuthCookieName({ RAILWAY_SERVICE_NAME: "---env---" } as never)).toBe(
      "auth-token-env"
    );
  });
});
