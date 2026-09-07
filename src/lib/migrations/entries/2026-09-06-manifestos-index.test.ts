import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-09-06-manifestos-index";
import { MIGRATIONS } from "../registry";

function fakeDb() {
  const createIndex = vi.fn().mockResolvedValue("manifestos_country_election_party");
  const db = { collection: vi.fn(() => ({ createIndex })) } as unknown as Db;
  return { db, createIndex };
}

const ctx = (dryRun: boolean) => ({ dryRun }) as Parameters<typeof migration.execute>[1];

describe("2026-09-06-manifestos-index", () => {
  it("creates the manifestos lookup index", async () => {
    const { db, createIndex } = fakeDb();
    const result = await migration.execute(db, ctx(false));

    expect(createIndex).toHaveBeenCalledWith(
      { countryId: 1, electionId: 1, party: 1 },
      expect.objectContaining({ name: "manifestos_country_election_party", background: true })
    );
    expect((result.notes ?? []).join(" ")).toContain("manifestos");
  });

  it("creates nothing on a dry run", async () => {
    const { db, createIndex } = fakeDb();
    const result = await migration.execute(db, ctx(true));

    expect(createIndex).not.toHaveBeenCalled();
    expect((result.notes ?? []).join(" ")).toMatch(/would create/);
  });

  it("is registered so a deploy actually runs it", () => {
    expect(MIGRATIONS.map((m) => m.id)).toContain("2026-09-06-manifestos-index");
  });
});
