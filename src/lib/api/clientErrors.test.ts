import { describe, it, expect } from "vitest";
import { getApiErrorMessage, assertOk } from "./clientErrors";

describe("getApiErrorMessage", () => {
  it("extracts error string from standard error response", async () => {
    const mockResponse = {
      json: async () => ({ error: "Unauthorized access" }),
      status: 401,
    } as Response;

    const result = await getApiErrorMessage(mockResponse);
    expect(result).toBe("Unauthorized access");
  });

  it("returns just error string when error is present (reason ignored)", async () => {
    const mockResponse = {
      json: async () => ({ error: "Validation failed", reason: "Email is required" }),
      status: 400,
    } as Response;

    const result = await getApiErrorMessage(mockResponse);
    expect(result).toBe("Validation failed");
  });

  it("extracts error with reason when error field is missing", async () => {
    const mockResponse = {
      json: async () => ({ reason: "Email is required" }),
      status: 400,
    } as Response;

    const result = await getApiErrorMessage(mockResponse);
    expect(result).toBe("Error: Email is required");
  });

  it("handles response without reason field", async () => {
    const mockResponse = {
      json: async () => ({ error: "Not found" }),
      status: 404,
    } as Response;

    const result = await getApiErrorMessage(mockResponse);
    expect(result).toBe("Not found");
  });

  it("returns generic message for non-JSON response", async () => {
    const mockResponse = {
      json: async () => {
        throw new Error("Invalid JSON");
      },
      status: 500,
    } as unknown as Response;

    const result = await getApiErrorMessage(mockResponse);
    expect(result).toBe("Something went wrong. Please try again.");
  });

  it("returns status-specific message for 500 errors", async () => {
    const mockResponse = {
      json: async () => ({}),
      status: 500,
    } as Response;

    const result = await getApiErrorMessage(mockResponse);
    expect(result).toBe("Something went wrong. Please try again.");
  });

  it("returns status-specific message for 400 errors", async () => {
    const mockResponse = {
      json: async () => ({}),
      status: 400,
    } as Response;

    const result = await getApiErrorMessage(mockResponse);
    expect(result).toBe("Request failed (400)");
  });
});

describe("assertOk", () => {
  it("resolves void for ok response", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
    } as Response;

    await expect(assertOk(mockResponse)).resolves.toBeUndefined();
  });

  it("throws error with parsed message for non-ok response", async () => {
    const mockResponse = {
      ok: false,
      json: async () => ({ error: "Forbidden" }),
      status: 403,
    } as Response;

    await expect(assertOk(mockResponse)).rejects.toThrow("Forbidden");
  });

  it("throws generic error message for 500 response", async () => {
    const mockResponse = {
      ok: false,
      json: async () => ({}),
      status: 500,
    } as Response;

    await expect(assertOk(mockResponse)).rejects.toThrow("Something went wrong. Please try again.");
  });
});
