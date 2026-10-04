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
      "2026-09-10-provider-identity-indexes",
      "2026-09-11-central-bank-pricing-phase-in",
      "2026-09-30-long-horizon-telemetry-indexes",
      "2026-09-30-apple-provider-identity-index",
      "2026-09-17-uk-dual-ministry-role-slot",
      "2026-10-04-political-media-order-indexes",
      "2026-10-04-bank-treasury-trade-indexes",
      "2026-10-04-bank-prop-forex-fee-index",
      "2026-10-04-bank-failure-politics-index",
      "2026-10-04-industry-model-market-indexes",
      "2026-10-04-media-discriminator-market-indexes",
      "2026-10-04-construction-service-lease-index",
    ]);
    expect(REQUIRED_STARTUP_MIGRATIONS.every((migration) => migration.idempotent)).toBe(true);
    expect(runMigrationsMock).toHaveBeenCalledWith(db, {
      migrations: [...REQUIRED_STARTUP_MIGRATIONS],
      dryRun: false,
    });
  });
});
