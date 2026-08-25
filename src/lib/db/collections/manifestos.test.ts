import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import { validateManifestoPledges, upsertManifestoDraft, lockManifesto } from "./manifestos";
import type { Pledge } from "@/lib/db/types/manifesto";

const VALID = new Set(["a", "b", "c", "d"]);
const p = (id: string): Pledge => ({ catalogEntryId: id });

describe("validateManifestoPledges", () => {
  it("accepts exactly 3 distinct valid pledges", () => {
    expect(validateManifestoPledges([p("a"), p("b"), p("c")], VALID).ok).toBe(true);
  });
  it("rejects the wrong count", () => {
    expect(validateManifestoPledges([p("a"), p("b")], VALID).ok).toBe(false);
    expect(validateManifestoPledges([p("a"), p("b"), p("c"), p("d")], VALID).ok).toBe(false);
  });
  it("rejects an unknown pledge", () => {
    const r = validateManifestoPledges([p("a"), p("b"), p("z")], VALID);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("z");
  });
  it("rejects duplicates", () => {
    const r = validateManifestoPledges([p("a"), p("a"), p("b")], VALID);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("duplicate");
  });
});

describe("upsertManifestoDraft", () => {
  const base = {
    countryId: "UK" as const,
    electionId: new ObjectId(),
    party: "1",
    pledges: [p("a"), p("b"), p("c")],
    authorCharacterId: new ObjectId(),
    now: new Date("2026-01-01"),
  };

  it("writes a draft when none is locked", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const findOne = vi.fn().mockResolvedValue(null);
    const db = { collection: vi.fn().mockReturnValue({ findOne, updateOne }) };
    const ok = await upsertManifestoDraft(db as never, base);
    expect(ok).toBe(true);
    expect(db.collection).toHaveBeenCalledWith("manifestos");
    expect(updateOne).toHaveBeenCalledWith(
      { countryId: "UK", electionId: base.electionId, party: "1" },
      expect.objectContaining({ $set: expect.any(Object), $setOnInsert: expect.any(Object) }),
      { upsert: true }
    );
  });

  it("refuses to edit a locked manifesto", async () => {
    const updateOne = vi.fn();
    const findOne = vi.fn().mockResolvedValue({ lockedAt: new Date() });
    const db = { collection: vi.fn().mockReturnValue({ findOne, updateOne }) };
    const ok = await upsertManifestoDraft(db as never, base);
    expect(ok).toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
  });
});

describe("lockManifesto", () => {
  const args = {
    countryId: "UK" as const,
    electionId: new ObjectId(),
    party: "1",
    validCatalogIds: VALID,
    now: new Date("2026-02-01"),
  };

  it("locks a valid draft", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const findOne = vi
      .fn()
      .mockResolvedValue({ lockedAt: null, pledges: [p("a"), p("b"), p("c")] });
    const db = { collection: vi.fn().mockReturnValue({ findOne, updateOne }) };
    const r = await lockManifesto(db as never, args);
    expect(r.ok).toBe(true);
    expect(updateOne).toHaveBeenCalledWith(
      { countryId: "UK", electionId: args.electionId, party: "1" },
      { $set: { lockedAt: args.now, updatedAt: args.now } }
    );
  });

  it("refuses to lock an invalid draft", async () => {
    const updateOne = vi.fn();
    const findOne = vi.fn().mockResolvedValue({ lockedAt: null, pledges: [p("a")] });
    const db = { collection: vi.fn().mockReturnValue({ findOne, updateOne }) };
    const r = await lockManifesto(db as never, args);
    expect(r.ok).toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("is idempotent on an already-locked manifesto", async () => {
    const updateOne = vi.fn();
    const findOne = vi.fn().mockResolvedValue({ lockedAt: new Date(), pledges: [] });
    const db = { collection: vi.fn().mockReturnValue({ findOne, updateOne }) };
    const r = await lockManifesto(db as never, args);
    expect(r.ok).toBe(true);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("errors when there is nothing to lock", async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const db = { collection: vi.fn().mockReturnValue({ findOne, updateOne: vi.fn() }) };
    const r = await lockManifesto(db as never, args);
    expect(r.ok).toBe(false);
  });
});
