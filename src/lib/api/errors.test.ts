import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  ApiError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  isDuplicateKeyError,
  internalError,
  handleRouteError,
} from "./errors";

// Mock NextResponse and Sentry
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((data, init) => ({
      _type: "mock-next-response",
      data,
      status: init?.status,
    })),
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

describe("ApiError", () => {
  describe("constructor", () => {
    it("creates error with status, message, and optional code/details", () => {
      const error = new ApiError(400, "Bad request", "BAD_REQUEST", { field: "email" });
      expect(error.status).toBe(400);
      expect(error.message).toBe("Bad request");
      expect(error.code).toBe("BAD_REQUEST");
      expect(error.details).toEqual({ field: "email" });
      expect(error.name).toBe("ApiError");
    });

    it("creates error without code or details", () => {
      const error = new ApiError(404, "Not found");
      expect(error.status).toBe(404);
      expect(error.message).toBe("Not found");
      expect(error.code).toBeUndefined();
      expect(error.details).toBeUndefined();
    });
  });

  describe("toJson", () => {
    it("includes error message always", () => {
      const error = new ApiError(400, "Something went wrong");
      expect(error.toJson()).toEqual({ error: "Something went wrong" });
    });

    it("includes code when provided", () => {
      const error = new ApiError(400, "Bad request", "BAD_REQUEST");
      expect(error.toJson()).toEqual({ error: "Bad request", code: "BAD_REQUEST" });
    });

    it("includes details when provided", () => {
      const error = new ApiError(400, "Validation failed", "VALIDATION_ERROR", {
        field: "email",
        reason: "Invalid format",
      });
      expect(error.toJson()).toEqual({
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: { field: "email", reason: "Invalid format" },
      });
    });

    it("excludes code and details when undefined", () => {
      const error = new ApiError(404, "Not found");
      expect(error.toJson()).toEqual({ error: "Not found" });
    });
  });
});

describe("error helpers", () => {
  it("badRequest creates 400 ApiError with BAD_REQUEST code", () => {
    const error = badRequest("Invalid email");
    expect(error.status).toBe(400);
    expect(error.message).toBe("Invalid email");
    expect(error.code).toBe("BAD_REQUEST");
  });

  it("badRequest includes details when provided", () => {
    const error = badRequest("Validation failed", { field: "email" });
    expect(error.details).toEqual({ field: "email" });
  });

  it("unauthorized creates 401 ApiError with default message", () => {
    const error = unauthorized();
    expect(error.status).toBe(401);
    expect(error.message).toBe("Authentication required");
    expect(error.code).toBe("UNAUTHORIZED");
  });

  it("unauthorized accepts custom message", () => {
    const error = unauthorized("Session expired");
    expect(error.message).toBe("Session expired");
  });

  it("forbidden creates 403 ApiError with default message", () => {
    const error = forbidden();
    expect(error.status).toBe(403);
    expect(error.message).toBe("Forbidden");
    expect(error.code).toBe("FORBIDDEN");
  });

  it("forbidden accepts custom message", () => {
    const error = forbidden("Admin access required");
    expect(error.message).toBe("Admin access required");
  });

  it("notFound creates 404 ApiError with default message", () => {
    const error = notFound();
    expect(error.status).toBe(404);
    expect(error.message).toBe("Not found");
    expect(error.code).toBe("NOT_FOUND");
  });

  it("notFound accepts custom message", () => {
    const error = notFound("User not found");
    expect(error.message).toBe("User not found");
  });

  it("internalError creates 500 ApiError with provided message", () => {
    const error = internalError("Database connection failed");
    expect(error.status).toBe(500);
    expect(error.message).toBe("Database connection failed");
    expect(error.code).toBe("INTERNAL_ERROR");
  });

  it("conflict creates 409 ApiError with CONFLICT code", () => {
    const error = conflict("Resource already exists");
    expect(error.status).toBe(409);
    expect(error.message).toBe("Resource already exists");
    expect(error.code).toBe("CONFLICT");
  });
});

describe("isDuplicateKeyError", () => {
  it("returns true for MongoDB driver E11000 errors (code: 11000)", () => {
    const err = Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    expect(isDuplicateKeyError(err)).toBe(true);
  });

  it("returns true when code is the string '11000'", () => {
    const err = Object.assign(new Error("E11000 duplicate key"), { code: "11000" });
    expect(isDuplicateKeyError(err)).toBe(true);
  });

  it("returns false for other Mongo error codes", () => {
    const err = Object.assign(new Error("network error"), { code: 11602 });
    expect(isDuplicateKeyError(err)).toBe(false);
  });

  it("returns false for non-object values", () => {
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError(undefined)).toBe(false);
    expect(isDuplicateKeyError("boom")).toBe(false);
    expect(isDuplicateKeyError(11000)).toBe(false);
  });
});

describe("handleRouteError", () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("returns ApiError response for ApiError instances", () => {
    const apiError = badRequest("Invalid input");
    const result = handleRouteError(apiError);
    expect(result.status).toBe(400);
    const body = (result as any).data;
    expect(body.error).toBe("Invalid input");
    expect(body.code).toBe("BAD_REQUEST");
  });

  it("returns 500 response for non-Error objects", () => {
    const result = handleRouteError("string error");
    expect(result.status).toBe(500);
    const body = (result as any).data;
    expect(body.error).toBe("Internal server error");
    expect(body.code).toBe("INTERNAL_ERROR");
  });

  it("returns 500 response with message for Error objects in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const error = new Error("Detailed internal error");
    const result = handleRouteError(error);
    expect(result.status).toBe(500);
    const body = (result as any).data;
    expect(body.error).toBe("Detailed internal error");
  });

  it("returns 500 response with generic message for Error objects in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const error = new Error("Detailed internal error");
    const result = handleRouteError(error);
    expect(result.status).toBe(500);
    const body = (result as any).data;
    expect(body.error).toBe("Internal server error");
  });
});
