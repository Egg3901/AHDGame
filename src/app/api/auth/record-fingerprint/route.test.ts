import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
// The route now records a net-identity audit envelope (forensics/alt-detection
// plan §3.1/§4 T2.3) alongside the DB write — mock the IP resolver the same
// way the other auth-route tests do.
vi.mock("@/lib/utils/network", () => ({ getClientIp: vi.fn().mockResolvedValue("203.0.113.10") }));

describe("POST /api/auth/record-fingerprint", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated requests with 401", async () => {
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue(null as never);
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/auth/record-fingerprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint: "h", fingerprintComponents: {} }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("backfills registration components only when absent and always updates last", async () => {
    const { ObjectId } = await import("mongodb");
    const userId = new ObjectId();
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({ userId: userId.toString() } as never);

    const updateOne = vi.fn().mockResolvedValue({});
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({
        findOne: vi.fn().mockResolvedValue({
          _id: userId,
          registrationFingerprintComponents: null,
          // Fresh account: the registration backfill is gated on `createdAt`
          // being inside REGISTRATION_BACKFILL_WINDOW_MS, which is the OAuth
          // signup case this backfill exists for.
          createdAt: new Date(),
        }),
        updateOne,
      }),
    } as never);

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/auth/record-fingerprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint: "h",
          fingerprintComponents: { canvas: "C", webglRenderer: "G", audio: "A" },
        }),
      })
    );
    expect(res.status).toBe(200);
    const setArg = updateOne.mock.calls[0][1].$set;
    expect(setArg.lastFingerprintComponents).toEqual({
      canvas: "C",
      webglRenderer: "G",
      audio: "A",
    });
    expect(setArg.registrationFingerprintComponents).toEqual({
      canvas: "C",
      webglRenderer: "G",
      audio: "A",
    });
  });

  it("does not overwrite an existing registration components value", async () => {
    const { ObjectId } = await import("mongodb");
    const userId = new ObjectId();
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({ userId: userId.toString() } as never);

    const updateOne = vi.fn().mockResolvedValue({});
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({
        findOne: vi.fn().mockResolvedValue({
          _id: userId,
          registrationFingerprintComponents: { canvas: "ORIGINAL" },
        }),
        updateOne,
      }),
    } as never);

    const { POST } = await import("./route");
    await POST(
      new Request("http://localhost/api/auth/record-fingerprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint: "h", fingerprintComponents: { canvas: "NEW" } }),
      })
    );
    const setArg = updateOne.mock.calls[0][1].$set;
    expect(setArg.registrationFingerprintComponents).toBeUndefined();
    expect(setArg.lastFingerprintComponents).toEqual({ canvas: "NEW" });
  });

  // Regression guard for the session-beacon path (design spec §1). Once this
  // route fires from every authenticated page, an unguarded backfill would
  // write today's values onto any legacy account whose registration values are
  // null — fabricating fresh "registration evidence" on signals that Duplicate
  // Groups unions on, and manufacturing the permanent groups the 30-day cutoff
  // exists to remove.
  it("does not mint registration evidence for an account older than the backfill window", async () => {
    const { ObjectId } = await import("mongodb");
    const userId = new ObjectId();
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({ userId: userId.toString() } as never);

    const updateOne = vi.fn().mockResolvedValue({});
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({
        findOne: vi.fn().mockResolvedValue({
          _id: userId,
          // Legacy account: never captured a fingerprint, and far outside the
          // 24h registration-backfill window.
          registrationFingerprint: null,
          registrationFingerprintComponents: null,
          registrationCf: null,
          createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
        }),
        updateOne,
      }),
    } as never);

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/auth/record-fingerprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint: "beacon-hash",
          fingerprintComponents: { canvas: "C" },
        }),
      })
    );

    expect(res.status).toBe(200);
    const setArg = updateOne.mock.calls[0][1].$set;
    // None of the three registration values may be written.
    expect(setArg.registrationFingerprint).toBeUndefined();
    expect(setArg.registrationFingerprintAt).toBeUndefined();
    expect(setArg.registrationFingerprintComponents).toBeUndefined();
    expect(setArg.registrationCf).toBeUndefined();
    // The current-value writes still happen — only registration is gated.
    expect(setArg.lastFingerprint).toBe("beacon-hash");
    expect(setArg.lastFingerprintComponents).toEqual({ canvas: "C" });
  });
});
