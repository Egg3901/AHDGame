import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-09-30-seed-snap-election-wiki-page";

describe("2026-09-30-seed-snap-election-wiki-page migration", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("wikiPages");
  });

  it("reports the missing article without writing on a dry run", async () => {
    const result = await migration.execute(db as unknown as Db, { dryRun: true });

    expect(result.documentsInserted).toBe(0);
    expect(result.notes).toEqual(["Dry run: would insert the snap-elections seed page."]);
    expect(db.collectionMocks.wikiPages.updateOne).not.toHaveBeenCalled();
  });

  it("inserts the canonical published seed with insert-only semantics", async () => {
    db.collectionMocks.wikiPages.updateOne.mockResolvedValue({ upsertedCount: 1 });

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(result.documentsInserted).toBe(1);
    expect(db.collectionMocks.wikiPages.updateOne).toHaveBeenCalledWith(
      { slug: "snap-elections" },
      {
        $setOnInsert: expect.objectContaining({
          slug: "snap-elections",
          title: "Snap Elections",
          status: "published",
          category: "elections",
          content: expect.stringContaining("# Snap Elections"),
        }),
      },
      { upsert: true }
    );
  });

  it("preserves any existing row without rewriting its content", async () => {
    db.collectionMocks.wikiPages.findOne.mockResolvedValue({
      _id: "existing",
      slug: "snap-elections",
      status: "draft",
      content: "Human-authored content",
    });

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(result.documentsInserted).toBe(0);
    expect(result.notes?.join(" ")).toContain(
      "status=draft, private=false, contentChars=22, canonicalContent=false, humanEdits=false"
    );
    expect(db.collectionMocks.wikiPages.updateOne).not.toHaveBeenCalled();
  });

  it("is race-safe when another process inserts the page first", async () => {
    db.collectionMocks.wikiPages.updateOne.mockResolvedValue({ upsertedCount: 0 });

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(result.documentsInserted).toBe(0);
    expect(result.notes?.join(" ")).toContain("created concurrently");
  });

  it("is registered as idempotent", () => {
    expect(migration.idempotent).toBe(true);
  });
});
