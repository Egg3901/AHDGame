import { describe, expect, it } from "vitest";
import { eligibleIdentitySignals } from "@/lib/auth/identitySignals";

const NOW = new Date("2026-08-09T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

/**
 * The moderator endpoint hashes every signal before emitting it. A hash never
 * equals the string "unknown", so the client-side sentinel filter cannot catch
 * it — which is how every account with an unresolvable IP got welded into one
 * component. Eligibility MUST therefore be computed on the raw value, before
 * hashing.
 *
 * These cases pin that contract so a future change that moves gating
 * client-side breaks a test rather than silently reopening the bug.
 */
describe("moderator endpoint signal gating", () => {
  it("marks a sentinel IP ineligible while the raw value is still available", () => {
    const result = eligibleIdentitySignals(
      { createdAt: ago(10 * DAY), lastKnownIp: "unknown", lastKnownIpAt: ago(1 * DAY) },
      NOW
    );
    expect(result.lastKnownIp.eligible).toBe(false);
  });

  it("marks a Cloudflare edge IP ineligible while the raw value is still available", () => {
    const result = eligibleIdentitySignals(
      { createdAt: ago(10 * DAY), lastKnownIp: "104.23.190.204", lastKnownIpAt: ago(1 * DAY) },
      NOW
    );
    expect(result.lastKnownIp.eligible).toBe(false);
  });

  it("keeps a genuine recent residential IP eligible", () => {
    const result = eligibleIdentitySignals(
      { createdAt: ago(10 * DAY), lastKnownIp: "198.51.100.77", lastKnownIpAt: ago(1 * DAY) },
      NOW
    );
    expect(result.lastKnownIp.eligible).toBe(true);
  });
});
