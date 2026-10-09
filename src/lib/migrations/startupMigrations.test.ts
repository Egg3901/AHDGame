import { beforeEach, describe, expect, it, vi } from "vitest";
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

import {
  REQUIRED_STARTUP_MIGRATIONS,
  REQUIRED_STARTUP_INDEX_MIGRATIONS,
  runRequiredStartupMigrations,
} from "./startupMigrations";

const findOne = vi.fn().mockResolvedValue(null);
const db = { collection: vi.fn(() => ({ findOne })) } as unknown as Db;

beforeEach(() => {
  runMigrationsMock.mockClear();
  findOne.mockReset().mockResolvedValue(null);
});

describe("runRequiredStartupMigrations", () => {
  it("runs only the audited idempotent startup allowlist", async () => {
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
      "2026-10-04-media-discriminator-market-indexes",
      "2026-10-04-construction-service-lease-index",
      "2026-10-04-media-product-projects-v1-index",
      "2026-10-04-manufacturing-product-projects-v2-index",
      "2026-10-04-underwriting-recovery-indexes",
      "2026-10-05-advertising-agreement-indexes",
      "2026-10-08-product-venture-indexes",
      "2026-10-09-market-cap-tick-indexes",
    ]);
    expect(REQUIRED_STARTUP_MIGRATIONS.every((migration) => migration.idempotent)).toBe(true);
    expect(runMigrationsMock).toHaveBeenNthCalledWith(1, db, {
      migrations: [...REQUIRED_STARTUP_MIGRATIONS],
      dryRun: false,
    });
    expect(runMigrationsMock).toHaveBeenNthCalledWith(2, db, {
      migrations: [...REQUIRED_STARTUP_INDEX_MIGRATIONS],
      only: REQUIRED_STARTUP_INDEX_MIGRATIONS.map((migration) => migration.id),
      force: true,
      dryRun: false,
    });
    expect(REQUIRED_STARTUP_INDEX_MIGRATIONS.every((migration) => migration.idempotent)).toBe(true);
    expect(runMigrationsMock).toHaveBeenCalledTimes(2);
  });

  it("restores insert-only bond pools on a fresh 1991 world despite surviving markers", async () => {
    findOne.mockResolvedValue({ preset: "1991-default", currentTurn: 1 });
    await runRequiredStartupMigrations(db);
    expect(runMigrationsMock).toHaveBeenNthCalledWith(3, db, {
      migrations: [expect.objectContaining({ id: "2026-09-03-bond-market-pools" })],
      only: ["2026-09-03-bond-market-pools"],
      force: true,
      dryRun: false,
    });
  });

  it("does not bootstrap bond cash into an existing world", async () => {
    findOne.mockResolvedValue({ preset: "1991-default", currentTurn: 1329 });
    await runRequiredStartupMigrations(db);
    expect(runMigrationsMock).toHaveBeenCalledTimes(2);
  });
});
