import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";

const { runMigrationsMock } = vi.hoisted(() => ({
  runMigrationsMock: vi.fn().mockResolvedValue({
    ranIds: ["2026-09-03-repair-orphan-index-fund-state"],
    skippedIds: [],
    results: {},
    dryRun: false,
  }),
}));

vi.mock("./runner", () => ({ runMigrations: runMigrationsMock }));

import { REQUIRED_STARTUP_MIGRATIONS, runRequiredStartupMigrations } from "./startupMigrations";

describe("runRequiredStartupMigrations", () => {
  it("runs only the audited idempotent startup allowlist", async () => {
    const db = {} as Db;

    await runRequiredStartupMigrations(db);

    expect(REQUIRED_STARTUP_MIGRATIONS.map((migration) => migration.id)).toEqual([
      "2026-09-03-equity-market-pools",
      "2026-09-03-repair-orphan-index-fund-state",
    ]);
    expect(REQUIRED_STARTUP_MIGRATIONS.every((migration) => migration.idempotent)).toBe(true);
    expect(runMigrationsMock).toHaveBeenCalledWith(db, {
      migrations: [...REQUIRED_STARTUP_MIGRATIONS],
      dryRun: false,
    });
  });
});
