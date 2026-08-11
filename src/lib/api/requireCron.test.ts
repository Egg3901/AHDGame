import { describe, it, expect, vi, afterEach } from "vitest";
import { requireCron } from "./requireCron";

describe("requireCron", () => {
  const originalSecret = process.env.CRON_SECRET;

  afterEach(() => {
    if (originalSecret) {
      process.env.CRON_SECRET = originalSecret;
    } else {
      delete process.env.CRON_SECRET;
    }
  });

  it("returns true when request has valid Bearer token matching CRON_SECRET", () => {
    process.env.CRON_SECRET = "test-secret-123";
    const mockRequest = {
      headers: {
        get: vi.fn().mockReturnValue("Bearer test-secret-123"),
      },
    } as unknown as Request;

    expect(requireCron(mockRequest)).toBe(true);
  });

  it("returns false when request has no authorization header", () => {
    process.env.CRON_SECRET = "test-secret-123";
    const mockRequest = {
      headers: {
        get: vi.fn().mockReturnValue(null),
      },
    } as unknown as Request;

    expect(requireCron(mockRequest)).toBe(false);
  });

  it("returns false when request has wrong token", () => {
    process.env.CRON_SECRET = "test-secret-123";
    const mockRequest = {
      headers: {
        get: vi.fn().mockReturnValue("Bearer wrong-secret"),
      },
    } as unknown as Request;

    expect(requireCron(mockRequest)).toBe(false);
  });

  it("returns false when request has malformed authorization header", () => {
    process.env.CRON_SECRET = "test-secret-123";
    const mockRequest = {
      headers: {
        get: vi.fn().mockReturnValue("test-secret-123"),
      },
    } as unknown as Request;

    expect(requireCron(mockRequest)).toBe(false);
  });

  it("returns false when CRON_SECRET is not set", () => {
    delete process.env.CRON_SECRET;
    const mockRequest = {
      headers: {
        get: vi.fn().mockReturnValue("Bearer any-token"),
      },
    } as unknown as Request;

    expect(requireCron(mockRequest)).toBe(false);
  });

  it("returns false when CRON_SECRET is empty string", () => {
    process.env.CRON_SECRET = "";
    const mockRequest = {
      headers: {
        get: vi.fn().mockReturnValue("Bearer "),
      },
    } as unknown as Request;

    expect(requireCron(mockRequest)).toBe(false);
  });
});
