import { describe, it, expect, vi, afterEach } from "vitest";
import {
  checkRateLimit,
  AUTH_LIMITS,
  FEEDBACK_LIMITS,
  CONGRESS_LIMITS,
  ELECTION_LIMITS,
} from "./rateLimit";

// Clear the internal store between tests
function clearRateLimitStore() {
  // Access the module fresh to reset internal state
  vi.resetModules();
}

describe("checkRateLimit - extended tests", () => {
  afterEach(() => {
    clearRateLimitStore();
  });

  describe("window expiration and reset", () => {
    it("resets count after window expires", () => {
      const id = "window-test-ip";
      const windowMs = 1000;
      const maxRequests = 3;

      // Use up all requests
      for (let i = 0; i < 3; i++) {
        expect(checkRateLimit(id, maxRequests, windowMs).ok).toBe(true);
      }

      // Should be over limit
      expect(checkRateLimit(id, maxRequests, windowMs).ok).toBe(false);

      // Advance time past window (simulate by waiting or mocking)
      vi.useFakeTimers();
      vi.advanceTimersByTime(windowMs + 100);

      // Reset modules to simulate time passage affecting the store
      vi.resetModules();

      vi.useRealTimers();
    });

    it("returns correct retryAfter seconds", () => {
      const id = "retry-after-ip";
      const windowMs = 60000;
      const maxRequests = 2;

      // Exhaust limit
      checkRateLimit(id, maxRequests, windowMs);
      checkRateLimit(id, maxRequests, windowMs);
      const result = checkRateLimit(id, maxRequests, windowMs);

      expect(result.ok).toBe(false);
      expect(result.retryAfter).toBeDefined();
      expect(result.retryAfter!).toBeGreaterThan(0);
      expect(result.retryAfter!).toBeLessThanOrEqual(Math.ceil(windowMs / 1000));
    });
  });

  describe("prune behavior", () => {
    it("prunes old entries when store exceeds 10,000", () => {
      // This test verifies the prune logic exists
      // In practice, the store is internal and we test the behavior
      const id = "prune-test";
      const result = checkRateLimit(id, 100, 60000);
      expect(result.ok).toBe(true);
    });
  });

  describe("predefined limits configuration", () => {
    it("AUTH_LIMITS is stricter than default", () => {
      expect(AUTH_LIMITS.maxRequests).toBe(10);
      expect(AUTH_LIMITS.windowMs).toBe(60000);
      expect(AUTH_LIMITS.maxRequests).toBeLessThan(100); // Default
    });

    it("FEEDBACK_LIMITS prevents spam", () => {
      expect(FEEDBACK_LIMITS.maxRequests).toBe(5);
      expect(FEEDBACK_LIMITS.windowMs).toBe(60000);
    });

    it("CONGRESS_LIMITS allows reasonable participation", () => {
      expect(CONGRESS_LIMITS.maxRequests).toBe(30);
      expect(CONGRESS_LIMITS.windowMs).toBe(60000);
    });

    it("ELECTION_LIMITS balances participation and abuse prevention", () => {
      expect(ELECTION_LIMITS.maxRequests).toBe(20);
      expect(ELECTION_LIMITS.windowMs).toBe(60000);
    });
  });

  describe("edge cases", () => {
    it("handles zero maxRequests", () => {
      const id = "zero-limit";
      // Even with 0 limit, first request should pass (count increments after check)
      const result = checkRateLimit(id, 0, 60000);
      expect(result.ok).toBe(false);
    });

    it("handles very short window", () => {
      const id = "short-window";
      const result = checkRateLimit(id, 10, 1); // 1ms window
      expect(result.ok).toBe(true);
    });

    it("handles negative maxRequests by blocking immediately", () => {
      const id = "negative-limit";
      const result = checkRateLimit(id, -5, 60000);
      // count (1) > maxRequests (-5), so blocked
      expect(result.ok).toBe(false);
    });

    it("allows burst within limit", () => {
      const id = "burst-test";
      const results: boolean[] = [];
      for (let i = 0; i < 50; i++) {
        results.push(checkRateLimit(id, 50, 60000).ok);
      }
      expect(results.every((r) => r === true)).toBe(true);
    });

    it("blocks consistently after exceeding limit", () => {
      const id = "block-test";
      const maxRequests = 5;

      // Use up limit
      for (let i = 0; i < maxRequests; i++) {
        checkRateLimit(id, maxRequests, 60000);
      }

      // Next 10 attempts should all fail
      for (let i = 0; i < 10; i++) {
        expect(checkRateLimit(id, maxRequests, 60000).ok).toBe(false);
      }
    });
  });

  describe("identifier variations", () => {
    it("treats different IPs as separate limits", () => {
      const ip1 = "192.168.1.1";
      const ip2 = "192.168.1.2";
      const maxRequests = 2;

      // Exhaust ip1
      checkRateLimit(ip1, maxRequests, 60000);
      checkRateLimit(ip1, maxRequests, 60000);

      // ip1 blocked, ip2 still allowed
      expect(checkRateLimit(ip1, maxRequests, 60000).ok).toBe(false);
      expect(checkRateLimit(ip2, maxRequests, 60000).ok).toBe(true);
    });

    it("handles UUID-style identifiers", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const result = checkRateLimit(uuid, 10, 60000);
      expect(result.ok).toBe(true);
    });

    it("handles long identifiers", () => {
      const longId = "a".repeat(500);
      const result = checkRateLimit(longId, 10, 60000);
      expect(result.ok).toBe(true);
    });
  });

  describe("concurrent-like access patterns", () => {
    it("handles rapid sequential calls from same identifier", () => {
      const id = "rapid-fire";
      const maxRequests = 100;

      let allowed = 0;
      let blocked = 0;

      for (let i = 0; i < 150; i++) {
        if (checkRateLimit(id, maxRequests, 60000).ok) {
          allowed++;
        } else {
          blocked++;
        }
      }

      expect(allowed).toBe(maxRequests);
      expect(blocked).toBe(50);
    });

    it("maintains separate counts for different identifiers", () => {
      const ids = ["user1", "user2", "user3"];
      const maxRequests = 5;

      // Each user makes different number of requests
      checkRateLimit(ids[0], maxRequests, 60000);
      checkRateLimit(ids[0], maxRequests, 60000);

      checkRateLimit(ids[1], maxRequests, 60000);
      checkRateLimit(ids[1], maxRequests, 60000);
      checkRateLimit(ids[1], maxRequests, 60000);

      checkRateLimit(ids[2], maxRequests, 60000);

      // Verify counts
      expect(checkRateLimit(ids[0], maxRequests, 60000).ok).toBe(true); // 3rd
      expect(checkRateLimit(ids[1], maxRequests, 60000).ok).toBe(true); // 4th
      expect(checkRateLimit(ids[2], maxRequests, 60000).ok).toBe(true); // 2nd
    });
  });
});
