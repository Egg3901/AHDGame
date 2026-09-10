import { afterEach, describe, expect, it, vi } from "vitest";
import { authRevocationSnapshotFilter, reauthClock, resolveReauthIssuedAt } from "./sessionIssue";

function isRevoked(cutoff: Date, iat: number): boolean {
  return cutoff.getTime() >= iat * 1000;
}

const NOON_MS = Date.parse("2026-04-25T12:00:00.000Z");
const NOON_SEC = NOON_MS / 1000;

describe("resolveReauthIssuedAt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses wall-clock seconds when there is no cutoff", async () => {
    vi.spyOn(reauthClock, "now").mockReturnValue(NOON_MS + 400);
    const sleep = vi.spyOn(reauthClock, "sleep");
    await expect(resolveReauthIssuedAt(undefined)).resolves.toEqual({
      ok: true,
      iat: NOON_SEC,
      snapshotFilter: { authRevokedAt: { $exists: false } },
    });
    await expect(resolveReauthIssuedAt(null)).resolves.toEqual({
      ok: true,
      iat: NOON_SEC,
      snapshotFilter: { authRevokedAt: { $type: "null" } },
    });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("returns a safe integer NumericDate without waiting for a past cutoff", async () => {
    vi.spyOn(reauthClock, "now").mockReturnValue(NOON_MS + 5200);
    const sleep = vi.spyOn(reauthClock, "sleep");
    const cutoff = new Date(NOON_MS + 500);
    const result = await resolveReauthIssuedAt(cutoff);
    expect(result).toEqual({
      ok: true,
      iat: NOON_SEC + 5,
      snapshotFilter: { authRevokedAt: cutoff },
    });
    expect(result.ok && Number.isSafeInteger(result.iat)).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("waits only the remainder of the current second, then uses actual floor(now/1000)", async () => {
    let nowMs = NOON_MS + 400;
    vi.spyOn(reauthClock, "now").mockImplementation(() => nowMs);
    const sleep = vi.spyOn(reauthClock, "sleep").mockImplementation(async (ms) => {
      nowMs += ms;
    });
    const cutoff = new Date(NOON_MS + 400);
    const result = await resolveReauthIssuedAt(cutoff);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(600);
    expect(result).toEqual({
      ok: true,
      iat: NOON_SEC + 1,
      snapshotFilter: { authRevokedAt: cutoff },
    });
    expect(nowMs).toBe(NOON_MS + 1000);
    expect(result.ok && result.iat > nowMs / 1000).toBe(false);
  });

  it("waits a full second for an exact-second cutoff, then issues that next second", async () => {
    let nowMs = NOON_MS;
    vi.spyOn(reauthClock, "now").mockImplementation(() => nowMs);
    const sleep = vi.spyOn(reauthClock, "sleep").mockImplementation(async (ms) => {
      nowMs += ms;
    });
    const cutoff = new Date(NOON_MS);
    const result = await resolveReauthIssuedAt(cutoff);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(result).toEqual({
      ok: true,
      iat: NOON_SEC + 1,
      snapshotFilter: { authRevokedAt: cutoff },
    });
    expect(isRevoked(cutoff, NOON_SEC)).toBe(true);
    expect(result.ok && isRevoked(cutoff, result.iat)).toBe(false);
  });

  it("keeps a same-second logout after signing inside the revoked window", async () => {
    let nowMs = NOON_MS + 400;
    vi.spyOn(reauthClock, "now").mockImplementation(() => nowMs);
    vi.spyOn(reauthClock, "sleep").mockImplementation(async (ms) => {
      nowMs += ms;
    });
    const priorCutoff = new Date(NOON_MS + 400);
    const result = await resolveReauthIssuedAt(priorCutoff);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.iat * 1000).toBeLessThanOrEqual(nowMs);
    const logoutAfterCas = new Date(nowMs);
    expect(isRevoked(logoutAfterCas, result.iat)).toBe(true);
    expect(isRevoked(priorCutoff, result.iat)).toBe(false);
  });

  it("fails closed on a future-second cutoff instead of waiting", async () => {
    vi.spyOn(reauthClock, "now").mockReturnValue(NOON_MS + 400);
    const sleep = vi.spyOn(reauthClock, "sleep").mockResolvedValue();
    await expect(resolveReauthIssuedAt(new Date(NOON_MS + 2000))).resolves.toEqual({ ok: false });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("fails closed on invalid cutoffs instead of treating them as absent", async () => {
    vi.spyOn(reauthClock, "now").mockReturnValue(NOON_MS + 400);
    const sleep = vi.spyOn(reauthClock, "sleep").mockResolvedValue();
    await expect(resolveReauthIssuedAt(new Date(Number.NaN))).resolves.toEqual({ ok: false });
    await expect(resolveReauthIssuedAt(new Date(Number.POSITIVE_INFINITY))).resolves.toEqual({
      ok: false,
    });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("fails closed when the clock has not left the cutoff second after the wait", async () => {
    vi.spyOn(reauthClock, "now").mockReturnValue(NOON_MS + 400);
    vi.spyOn(reauthClock, "sleep").mockResolvedValue();
    await expect(resolveReauthIssuedAt(new Date(NOON_MS + 400))).resolves.toEqual({ ok: false });
  });

  it("preserves the original cutoff snapshot across the wait", async () => {
    let nowMs = NOON_MS + 400;
    const cutoff = new Date(NOON_MS + 400);
    vi.spyOn(reauthClock, "now").mockImplementation(() => nowMs);
    vi.spyOn(reauthClock, "sleep").mockImplementation(async (ms) => {
      nowMs += ms;
    });
    const result = await resolveReauthIssuedAt(cutoff);
    expect(result).toEqual({
      ok: true,
      iat: NOON_SEC + 1,
      snapshotFilter: { authRevokedAt: cutoff },
    });
  });

  it("still rejects an older JWT after a successful reauth iat", async () => {
    let nowMs = NOON_MS + 400;
    vi.spyOn(reauthClock, "now").mockImplementation(() => nowMs);
    vi.spyOn(reauthClock, "sleep").mockImplementation(async (ms) => {
      nowMs += ms;
    });
    const cutoff = new Date(NOON_MS + 500);
    const oldIat = NOON_SEC - 10;
    const result = await resolveReauthIssuedAt(cutoff);
    expect(isRevoked(cutoff, oldIat)).toBe(true);
    expect(result.ok && isRevoked(cutoff, result.iat)).toBe(false);
  });
});

describe("authRevocationSnapshotFilter", () => {
  it("matches the stored Date so a later stamp fails the write", () => {
    const cutoff = new Date(NOON_MS + 500);
    expect(authRevocationSnapshotFilter(cutoff)).toEqual({ authRevokedAt: cutoff });
  });

  it("distinguishes a missing field from an explicit null", () => {
    expect(authRevocationSnapshotFilter(undefined)).toEqual({
      authRevokedAt: { $exists: false },
    });
    expect(authRevocationSnapshotFilter(null)).toEqual({
      authRevokedAt: { $type: "null" },
    });
  });

  it("does not treat an invalid Date as missing", () => {
    expect(authRevocationSnapshotFilter(new Date(Number.NaN))).toEqual({
      $and: [{ authRevokedAt: { $exists: true } }, { authRevokedAt: { $exists: false } }],
    });
  });
});
