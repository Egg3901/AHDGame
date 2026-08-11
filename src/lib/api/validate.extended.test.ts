import { describe, it, expect } from "vitest";
import { parseJsonBody, parseBoundedIntParam, schemas } from "./validate";
import { z } from "zod";

describe("validate utilities - extended tests", () => {
  describe("parseJsonBody - edge cases", () => {
    it("handles deeply nested schema validation", async () => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            name: z.string().min(1),
            age: z.number().positive(),
          }),
        }),
      });

      const req = new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ user: { profile: { name: "", age: -5 } } }),
      });

      const result = await parseJsonBody(req, schema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("user.profile.name");
      }
    });

    it("handles array validation", async () => {
      const schema = z.object({
        items: z.array(z.number()).min(1),
      });

      const req = new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ items: [] }),
      });

      const result = await parseJsonBody(req, schema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("items");
      }
    });

    it("handles enum validation", async () => {
      const schema = z.object({
        status: z.enum(["active", "inactive", "pending"]),
      });

      const req = new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ status: "unknown" }),
      });

      const result = await parseJsonBody(req, schema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("status");
      }
    });

    it("handles date parsing", async () => {
      const schema = z.object({
        date: z.string().date(),
      });

      const req = new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ date: "not-a-date" }),
      });

      const result = await parseJsonBody(req, schema);
      expect(result.success).toBe(false);
    });

    it("handles union types", async () => {
      const schema = z.object({
        value: z.union([z.string(), z.number()]),
      });

      const req = new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ value: true }),
      });

      const result = await parseJsonBody(req, schema);
      expect(result.success).toBe(false);
    });

    it("handles optional fields correctly", async () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });

      const req = new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ required: "test" }),
      });

      const result = await parseJsonBody(req, schema);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.optional).toBeUndefined();
      }
    });

    it("handles nullable fields", async () => {
      const schema = z.object({
        value: z.string().nullable(),
      });

      const req = new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ value: null }),
      });

      const result = await parseJsonBody(req, schema);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.value).toBeNull();
      }
    });

    it("handles schema transforms (coerce)", async () => {
      const schema = z.object({
        count: z.coerce.number(),
      });

      const req = new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ count: "42" }),
      });

      const result = await parseJsonBody(req, schema);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.count).toBe(42);
      }
    });

    it("handles refine validation", async () => {
      const schema = z
        .object({
          password: z.string().min(8),
          confirmPassword: z.string(),
        })
        .refine((data) => data.password === data.confirmPassword, {
          message: "Passwords do not match",
          path: ["confirmPassword"],
        });

      const req = new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ password: "password123", confirmPassword: "different" }),
      });

      const result = await parseJsonBody(req, schema);
      expect(result.success).toBe(false);
    });
  });

  describe("parseBoundedIntParam - edge cases", () => {
    it("handles zero as valid value", () => {
      const params = new URLSearchParams("offset=0");
      expect(parseBoundedIntParam(params, "offset", 10, -100, 100)).toBe(0);
    });

    it("handles string zero", () => {
      const params = new URLSearchParams("offset=0");
      expect(parseBoundedIntParam(params, "offset", 10, 0, 100)).toBe(0);
    });

    it("handles floating point by parsing then clamping", () => {
      const params = new URLSearchParams("count=5.7");
      expect(parseBoundedIntParam(params, "count", 0, 0, 10)).toBe(5);
    });

    it("handles scientific notation by parsing first digit", () => {
      // parseInt("1e2") returns 1 (stops at 'e')
      const params = new URLSearchParams("value=1e2");
      expect(parseBoundedIntParam(params, "value", 0, 0, 1000)).toBe(1);
    });

    it("handles whitespace in value", () => {
      const params = new URLSearchParams("count=  5  ");
      expect(parseBoundedIntParam(params, "count", 0, 0, 10)).toBe(5);
    });

    it("handles multiple values (takes first)", () => {
      const params = new URLSearchParams("count=5&count=10&count=15");
      expect(parseBoundedIntParam(params, "count", 0, 0, 100)).toBe(5);
    });

    it("handles min equals max", () => {
      const params = new URLSearchParams("value=50");
      expect(parseBoundedIntParam(params, "value", 0, 50, 50)).toBe(50);
    });

    it("handles negative default", () => {
      const params = new URLSearchParams();
      expect(parseBoundedIntParam(params, "offset", -10, -100, 100)).toBe(-10);
    });

    it("handles infinity clamping", () => {
      const params = new URLSearchParams("value=Infinity");
      const result = parseBoundedIntParam(params, "value", 0, 0, 100);
      // parseInt("Infinity") = NaN, so falls back to default (0), clamped to [0, 100]
      expect(result).toBe(0);
    });
  });

  describe("schemas - objectId", () => {
    it("accepts valid 24-char hex lowercase", () => {
      expect(schemas.objectId.safeParse("507f1f77bcf86cd799439011").success).toBe(true);
    });

    it("accepts valid 24-char hex uppercase", () => {
      expect(schemas.objectId.safeParse("507F1F77BCF86CD799439011").success).toBe(true);
    });

    it("accepts valid 24-char hex mixed case", () => {
      expect(schemas.objectId.safeParse("507f1F77bCf86Cd799439011").success).toBe(true);
    });

    it("rejects 23-char hex (too short)", () => {
      expect(schemas.objectId.safeParse("507f1f77bcf86cd79943901").success).toBe(false);
    });

    it("rejects 25-char hex (too long)", () => {
      expect(schemas.objectId.safeParse("507f1f77bcf86cd7994390112").success).toBe(false);
    });

    it("rejects hex with hyphens", () => {
      expect(schemas.objectId.safeParse("507f1f77-bcf8-6cd7-9943-9011").success).toBe(false);
    });

    it("rejects non-hex characters", () => {
      expect(schemas.objectId.safeParse("507f1f77bcf86cd7994390gh").success).toBe(false);
    });

    it("rejects null", () => {
      expect(schemas.objectId.safeParse(null as any).success).toBe(false);
    });

    it("rejects undefined", () => {
      expect(schemas.objectId.safeParse(undefined as any).success).toBe(false);
    });

    it("rejects number", () => {
      expect(schemas.objectId.safeParse(12345 as any).success).toBe(false);
    });
  });

  describe("schemas - nppObjectId", () => {
    it("accepts valid 24-char hex", () => {
      expect(schemas.nppObjectId.safeParse("507f1f77bcf86cd799439011").success).toBe(true);
    });

    it("rejects invalid format", () => {
      expect(schemas.nppObjectId.safeParse("invalid-npp-id").success).toBe(false);
    });

    it("has different error message than objectId", () => {
      const objectIdResult = schemas.objectId.safeParse("invalid");
      const nppObjectIdResult = schemas.nppObjectId.safeParse("invalid");

      if (!objectIdResult.success && !nppObjectIdResult.success) {
        expect(objectIdResult.error.issues[0].message).toBe("Invalid ID format");
        expect(nppObjectIdResult.error.issues[0].message).toBe("Invalid NPP ID format");
      }
    });
  });

  describe("schemas - email", () => {
    it("accepts standard emails", () => {
      expect(schemas.email.safeParse("user@example.com").success).toBe(true);
    });

    it("accepts emails with plus addressing", () => {
      expect(schemas.email.safeParse("user+tag@example.com").success).toBe(true);
    });

    it("accepts emails with subdomains", () => {
      expect(schemas.email.safeParse("user@mail.example.com").success).toBe(true);
    });

    it("rejects missing @", () => {
      expect(schemas.email.safeParse("userexample.com").success).toBe(false);
    });

    it("rejects missing domain", () => {
      expect(schemas.email.safeParse("user@").success).toBe(false);
    });

    it("rejects missing local part", () => {
      expect(schemas.email.safeParse("@example.com").success).toBe(false);
    });

    it("rejects spaces", () => {
      expect(schemas.email.safeParse("user @example.com").success).toBe(false);
    });
  });

  describe("schemas - password", () => {
    it("accepts any non-empty string", () => {
      expect(schemas.password.safeParse("a").success).toBe(true);
      expect(schemas.password.safeParse("password123").success).toBe(true);
    });

    it("rejects empty string", () => {
      expect(schemas.password.safeParse("").success).toBe(false);
    });

    it("has no maximum length", () => {
      expect(schemas.password.safeParse("a".repeat(1000)).success).toBe(true);
    });
  });

  describe("schemas - username", () => {
    it("accepts alphanumeric usernames", () => {
      expect(schemas.username.safeParse("user123").success).toBe(true);
    });

    it("accepts usernames with underscores", () => {
      expect(schemas.username.safeParse("user_name").success).toBe(true);
      expect(schemas.username.safeParse("user_name_123").success).toBe(true);
    });

    it("accepts minimum length (3 chars)", () => {
      expect(schemas.username.safeParse("abc").success).toBe(true);
    });

    it("accepts maximum length (20 chars)", () => {
      expect(schemas.username.safeParse("a".repeat(20)).success).toBe(true);
    });

    it("rejects too short (2 chars)", () => {
      expect(schemas.username.safeParse("ab").success).toBe(false);
    });

    it("rejects too long (21 chars)", () => {
      expect(schemas.username.safeParse("a".repeat(21)).success).toBe(false);
    });

    it("rejects hyphens", () => {
      expect(schemas.username.safeParse("user-name").success).toBe(false);
    });

    it("rejects spaces", () => {
      expect(schemas.username.safeParse("user name").success).toBe(false);
    });

    it("rejects special characters", () => {
      expect(schemas.username.safeParse("user@name").success).toBe(false);
      expect(schemas.username.safeParse("user#1").success).toBe(false);
      expect(schemas.username.safeParse("user$1").success).toBe(false);
    });

    it("rejects empty string", () => {
      expect(schemas.username.safeParse("").success).toBe(false);
    });
  });
});
