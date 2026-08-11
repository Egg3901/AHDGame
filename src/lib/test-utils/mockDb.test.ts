/**
 * Tests for mockDb factory and assertion helpers.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createMockDb,
  assertCalledWithFilter,
  assertSetFields,
  getAccessedCollections,
} from "./mockDb";

describe("createMockDb", () => {
  it("lazily creates collections on first access", () => {
    const db = createMockDb();
    expect(Object.keys(db.collectionMocks)).toHaveLength(0);

    db.collection("users");
    expect(Object.keys(db.collectionMocks)).toHaveLength(1);
    expect(db.collectionMocks["users"]).toBeDefined();
  });

  it("returns same mock for repeated access to same collection", () => {
    const db = createMockDb();
    const first = db.collection("users");
    const second = db.collection("users");
    expect(first).toBe(second);
  });

  it("provides distinct mocks for different collections", () => {
    const db = createMockDb();
    const users = db.collection("users");
    const posts = db.collection("posts");
    expect(users).not.toBe(posts);
  });

  it("has all CRUD methods pre-mocked", () => {
    const db = createMockDb();
    db.collection("test");
    const coll = db.collectionMocks["test"]!;

    expect(coll.findOne).toBeDefined();
    expect(coll.find).toBeDefined();
    expect(coll.insertOne).toBeDefined();
    expect(coll.insertMany).toBeDefined();
    expect(coll.updateOne).toBeDefined();
    expect(coll.updateMany).toBeDefined();
    expect(coll.deleteOne).toBeDefined();
    expect(coll.deleteMany).toBeDefined();
    expect(coll.countDocuments).toBeDefined();
    expect(coll.aggregate).toBeDefined();
    expect(coll.bulkWrite).toBeDefined();
  });

  it("find returns chainable cursor by default", async () => {
    const db = createMockDb();
    db.collection("test");
    const result = await db.collectionMocks["test"]!.find()
      .sort({ a: 1 })
      .limit(10)
      .skip(5)
      .project({ a: 1 })
      .toArray();
    expect(result).toEqual([]);
  });
});

describe("assertCalledWithFilter", () => {
  it("passes when filter matches", () => {
    const mockFn = vi.fn();
    mockFn({ _id: "abc", status: "active" }, { $set: { x: 1 } });

    expect(() => assertCalledWithFilter(mockFn, { _id: "abc" })).not.toThrow();
  });

  it("passes for partial filter match", () => {
    const mockFn = vi.fn();
    mockFn({ _id: "abc", status: "active", type: "test" }, {});

    expect(() => assertCalledWithFilter(mockFn, { status: "active" })).not.toThrow();
  });

  it("throws when no call matches the filter", () => {
    const mockFn = vi.fn();
    mockFn({ _id: "abc" }, {});

    expect(() => assertCalledWithFilter(mockFn, { _id: "xyz" })).toThrow(
      /Expected mock to be called with filter/
    );
  });
});

describe("assertSetFields", () => {
  it("passes when $set contains expected fields", () => {
    const mockFn = vi.fn();
    mockFn({ _id: "abc" }, { $set: { status: "failed", updatedAt: new Date() } });

    expect(() => assertSetFields(mockFn, { status: "failed" })).not.toThrow();
  });

  it("throws when $set does not contain expected fields", () => {
    const mockFn = vi.fn();
    mockFn({ _id: "abc" }, { $set: { status: "active" } });

    expect(() => assertSetFields(mockFn, { status: "failed" })).toThrow(
      /Expected mock to be called with \$set/
    );
  });

  it("throws when no $set exists", () => {
    const mockFn = vi.fn();
    mockFn({ _id: "abc" }, { $inc: { count: 1 } });

    expect(() => assertSetFields(mockFn, { status: "failed" })).toThrow(
      /Expected mock to be called with \$set/
    );
  });
});

describe("getAccessedCollections", () => {
  it("returns empty array for fresh db", () => {
    const db = createMockDb();
    expect(getAccessedCollections(db)).toEqual([]);
  });

  it("returns names of all accessed collections", () => {
    const db = createMockDb();
    db.collection("users");
    db.collection("posts");
    db.collection("comments");

    const accessed = getAccessedCollections(db);
    expect(accessed).toContain("users");
    expect(accessed).toContain("posts");
    expect(accessed).toContain("comments");
    expect(accessed).toHaveLength(3);
  });
});
