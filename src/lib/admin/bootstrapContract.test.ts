/**
 * Reset / bootstrap contract tests.
 *
 * These tests run without a live MongoDB — they exercise the pure-function
 * seed factories and the manifest so we can prove the contract holds without
 * having to run a destructive real reset against any database.
 *
 * What they pin:
 *   1. `initialNationalBudgets` contains every supported country with the
 *      sovereign-default + IMF default fields stamped (Phase 3 fold).
 *   2. `generateCountryOwnedSeedData` produces a sovereign corp for every
 *      supported country with `isPrivate` / `legalStructure` /
 *      `liquidCurrencyCode` set (Phase 3 fold + Phase 3 fan-out).
 *   3. The seed manifest covers every collection the seeders reference and
 *      classifies them consistently.
 *   4. Bootstrap call-graph is symmetric: the orchestrator pipes its
 *      `seedOnly`/`resetReference` options through to bootstrapGameWorld.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { resetAndBootstrapGameWorld } from "@/lib/admin/resetAndBootstrapGameWorld";

// ── Helper: fields the sovereign-default migration used to stamp. ──────────
const SOVEREIGN_DEFAULT_FIELDS = [
  "sovereignCrisisState",
  "failedAuctionConsecutiveCount",
  "lastAuctionDemandRatio",
  "crisisFiredAt",
  "crisisChoice",
  "crisisChoiceAt",
  "crisisLegislativeProposalId",
  "crisisAutoActionAt",
  "crisisLegislativeDeadlineAt",
  "recoveryStartedAt",
  "recoveryFiscalDisciplineStreak",
  "marketAccessLockedUntilTurn",
  "lastDefaultTurn",
  "imfSovereignBailoutActive",
  "imfSovereignFacilityPrincipalOutstanding",
  "imfSovereignFacilityAnnualRate",
  "imfSovereignFacilityAmortizationTurnsRemaining",
  "imfSovereignFacilityIncomeCaptureFraction",
  "imfBoardOverrideWindowEndAt",
  "imfBoardOverrideAt",
] as const;

/**
 * DERIVED, not hand-listed. This was `["US","UK","JP","DE","IE","BR","CN"]` — 7
 * of the 18 countries that actually have budget seeders, so 11 could lose their
 * budget without a single test failing. A hand-list is guaranteed to drift: it
 * has to be edited by whoever adds a country, and nothing makes them.
 *
 * Reading the seed configs instead means adding a country automatically extends
 * the contract. Asserted below to be strictly larger than the old hand-list, so
 * this cannot silently collapse back to a narrow roster (an empty or tiny
 * derivation would make every loop over it vacuous).
 */
async function supportedBudgetCountries(): Promise<string[]> {
  const { getNationalBudgetSeedConfigsForPreset } = await import("@/lib/seeds/reference/budgets");
  return [
    ...new Set(getNationalBudgetSeedConfigsForPreset("2019-default").map((c) => c.countryId)),
  ];
}

/** The roster the hand-list used to pin — a floor, never the whole set. */
const LEGACY_HAND_LIST = ["US", "UK", "JP", "DE", "IE", "BR", "CN"] as const;

describe("bootstrap contract: national budgets", () => {
  it("derives its country roster from the seed configs, and covers more than the old hand-list", async () => {
    const countries = await supportedBudgetCountries();
    for (const expected of LEGACY_HAND_LIST) {
      expect(countries, `derivation lost ${expected}`).toContain(expected);
    }
    // Guards the derivation itself: if it ever returned [] or a stub, every
    // other assertion in this file that loops over it would pass vacuously.
    expect(countries.length).toBeGreaterThan(LEGACY_HAND_LIST.length);
  });

  it("seeds an initial budget for every supported country", async () => {
    const { initialNationalBudgets } = await import("@/lib/seeds/reference/budgets");
    const countryIds = initialNationalBudgets.map((b) => b.countryId);
    for (const expected of await supportedBudgetCountries()) {
      expect(countryIds, `expected initial budget for ${expected}`).toContain(expected);
    }
  });

  it("every initial budget carries the sovereign-default + IMF default fields", async () => {
    const { initialNationalBudgets } = await import("@/lib/seeds/reference/budgets");
    for (const budget of initialNationalBudgets) {
      for (const field of SOVEREIGN_DEFAULT_FIELDS) {
        expect(
          field in budget,
          `${budget.countryId} budget missing ${field} (was the sovereign-default migration not folded into the seed?)`
        ).toBe(true);
      }
      // The state machine must start in "normal" — any other state means a
      // fresh game is born mid-crisis, which the runtime will then try to resolve.
      expect(budget.sovereignCrisisState).toBe("normal");
      expect(budget.imfSovereignBailoutActive).toBe(false);
    }
  });
});

describe("bootstrap contract: sovereign issuer corporations", () => {
  it("seeds a sovereign corp for every supported country", async () => {
    const { generateCountryOwnedSeedData } = await import("@/lib/seeds/reference/budgets");
    // We only need at least one UK state with positive GDP for the UK NHS
    // sovereign-issuer branch to activate. The other countries' sovereign corps
    // are created unconditionally (financial-only, no nationalized sectors).
    const entries = generateCountryOwnedSeedData(
      [
        { id: "DC", population: 700_000, gdp: 200_000_000_000, countryId: "US" },
        { id: "LON", population: 9_000_000, gdp: 600_000_000_000, countryId: "UK" },
      ],
      "2019-default"
    );
    const owners = entries.map((entry) => entry.corporation.countryOwnerId).filter(Boolean);
    for (const expected of await supportedBudgetCountries()) {
      expect(owners, `expected sovereign corp for ${expected}`).toContain(expected);
    }
  });

  it("every sovereign corp carries isPrivate + legalStructure + liquidCurrencyCode", async () => {
    const { generateCountryOwnedSeedData } = await import("@/lib/seeds/reference/budgets");
    const entries = generateCountryOwnedSeedData(
      [
        { id: "DC", population: 700_000, gdp: 200_000_000_000, countryId: "US" },
        { id: "LON", population: 9_000_000, gdp: 600_000_000_000, countryId: "UK" },
      ],
      "2019-default"
    );
    for (const entry of entries) {
      expect(entry.corporation.isPrivate).toBe(false);
      expect(entry.corporation.legalStructure).toBeTruthy();
      expect(entry.corporation.liquidCurrencyCode).toBeTruthy();
      // The sovereign corp's denomination should match its country.
      const map = (await import("@/lib/constants/currencies")).COUNTRY_CURRENCY_MAP;
      expect(entry.corporation.liquidCurrencyCode).toBe(
        map[entry.corporation.countryId as keyof typeof map]
      );
    }
  });
});

describe("bootstrap contract: seed manifest", () => {
  it("classifies every entry into one of the five categories", async () => {
    const { SEED_MANIFEST } = await import("@/lib/admin/seed/seedManifest");
    const validCategories = new Set([
      "reference",
      "runtime",
      "preserved",
      "migration-only",
      "incident-only",
    ]);
    for (const entry of SEED_MANIFEST) {
      expect(validCategories.has(entry.category), `${entry.name} bad category`).toBe(true);
    }
  });

  it("has no duplicate collection names", async () => {
    const { SEED_MANIFEST } = await import("@/lib/admin/seed/seedManifest");
    const names = SEED_MANIFEST.map((entry) => entry.name);
    const unique = new Set(names);
    expect(names.length, "duplicate entry in SEED_MANIFEST").toBe(unique.size);
  });

  it("covers the core reference + runtime + preserved collections by name", async () => {
    const { getCollectionCategory } = await import("@/lib/admin/seed/seedManifest");
    // Spot-check the well-known anchors from each category.
    expect(getCollectionCategory("states")).toBe("reference");
    expect(getCollectionCategory("politicalParties")).toBe("reference");
    expect(getCollectionCategory("federalBudget")).toBe("reference");
    expect(getCollectionCategory("elections")).toBe("runtime");
    expect(getCollectionCategory("bills")).toBe("runtime");
    expect(getCollectionCategory("corporations")).toBe("runtime");
    expect(getCollectionCategory("indexFunds")).toBe("runtime");
    expect(getCollectionCategory("countryState")).toBe("runtime");
    expect(getCollectionCategory("regimeEscalation")).toBe("runtime");
    expect(getCollectionCategory("users")).toBe("preserved");
    expect(getCollectionCategory("characters")).toBe("preserved");
    expect(getCollectionCategory("migrations")).toBe("preserved");
  });

  it("forces the idempotent fund bootstrap after reset drops fund documents", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/admin/bootstrapGameWorld.ts"),
      "utf8"
    );
    const start = source.indexOf("const indexFundBootstrap = await runMigrations");
    const end = source.indexOf("Bootstrap migrations: ran", start);
    expect(start).toBeGreaterThan(-1);
    expect(source.slice(start, end)).toContain("force: forceIndexFundBootstrap");
  });

  it("findUnclassifiedCollections flags unknown collections", async () => {
    const { findUnclassifiedCollections } = await import("@/lib/admin/seed/seedManifest");
    expect(findUnclassifiedCollections(["states", "elections", "users"])).toEqual([]);
    const drift = findUnclassifiedCollections(["states", "brandNewCollection"]);
    expect(drift).toEqual(["brandNewCollection"]);
  });

  it("classifies every collection referenced by a string literal in src", async () => {
    // Scans the source tree for `db.collection("name")` literals and asserts
    // each is in the manifest. This guards the exact drift we cleaned up: a new
    // collection added in code but never classified, which then silently
    // survives resets. (Constant-held names — `collection(SOME_CONST)` — aren't
    // scanned; classify those manually when introduced.)
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { findUnclassifiedCollections } = await import("@/lib/admin/seed/seedManifest");

    const srcDir = path.resolve(__dirname, "../../../src");
    const re = /collection(?:<[^>]*>)?\(\s*"([a-zA-Z][a-zA-Z0-9]*)"\s*\)/g;
    const names = new Set<string>();

    async function walk(dir: string): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
        if (entry.name.includes(".test.")) continue;
        const text = await fs.readFile(full, "utf8");
        let match: RegExpExecArray | null;
        while ((match = re.exec(text)) !== null) {
          names.add(match[1]);
        }
      }
    }
    await walk(srcDir);

    const unclassified = findUnclassifiedCollections([...names]);
    expect(
      unclassified,
      `unclassified collections found in src (add them to seedManifest.ts): ${unclassified.join(", ")}`
    ).toEqual([]);
    // Reads and regex-scans every .ts/.tsx file under src from disk: ~2s alone,
    // but up to ~15s under full-suite parallel I/O, which is right on vitest's
    // default budget. Past it the case fails as a TIMEOUT masquerading as a drift
    // failure, so it gets an explicit, generous one and fails only for the reason
    // it exists to catch. (Both branches hit this independently and added the
    // same 60s budget; this comment is the two explanations merged.)
  }, 60_000);
});

describe("bootstrap contract: orchestrator wiring", () => {
  it("passes seedOnly + resetReference through to bootstrapGameWorld", async () => {
    // We mock the building blocks so the test runs without a live DB. The
    // assertion is purely structural — the orchestrator must hand seedOnly /
    // resetReference / preset / mode through unchanged.
    const resetGameWorldMock = vi
      .fn()
      .mockResolvedValue({ success: true, message: "ok", details: { budgetSeedLog: [] } });
    const bootstrapGameWorldMock = vi.fn().mockResolvedValue(undefined);
    const seedHistoricalOfficialsMock = vi
      .fn()
      .mockResolvedValue({ officialsCreated: 0, nppsCreated: 0 });
    const enableMaintenanceModeMock = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/admin/resetGameWorld", () => ({ resetGameWorld: resetGameWorldMock }));
    vi.doMock("@/lib/admin/bootstrapGameWorld", () => ({
      bootstrapGameWorld: bootstrapGameWorldMock,
    }));
    vi.doMock("@/lib/npp/seedHistorical", () => ({
      seedHistoricalOfficials: seedHistoricalOfficialsMock,
    }));
    vi.doMock("@/lib/maintenanceStatus", () => ({
      enableMaintenanceMode: enableMaintenanceModeMock,
    }));
    vi.doMock("@/lib/admin/finalizeResetGameWorld", () => ({
      finalizeResetGameWorld: vi.fn().mockResolvedValue({
        demographicsReset: 0,
        customPartiesDeleted: 0,
        partyOrgRecordsDeleted: 0,
        finalizeLog: [],
      }),
    }));

    vi.resetModules();
    const { resetAndBootstrapGameWorld: fresh } =
      await import("@/lib/admin/resetAndBootstrapGameWorld");

    // `collection` is needed because the orchestrator now stamps `isActive: false`
    // on gameState as part of sealing the world before the reset runs.
    const db = {
      collection: () => ({ updateOne: async () => ({}), insertOne: async () => ({}) }),
    } as never;
    await fresh({
      db,
      mode: "vacant",
      preset: "2019-default",
      resetReference: false,
      seedOnly: true,
      adminUsername: "test",
    });

    expect(resetGameWorldMock).toHaveBeenCalledTimes(1);
    expect(bootstrapGameWorldMock).toHaveBeenCalledTimes(1);
    const bootstrapArgs = bootstrapGameWorldMock.mock.calls[0][0];
    expect(bootstrapArgs.mode).toBe("vacant");
    expect(bootstrapArgs.preset).toBe("2019-default");
    expect(bootstrapArgs.resetReference).toBe(false);
    expect(bootstrapArgs.seedOnly).toBe(true);
    // seedOnly path should also drive the post-seed officials helper.
    expect(seedHistoricalOfficialsMock).toHaveBeenCalledTimes(1);
    // Twice, deliberately: once as step 0 so the wipe and the seed never run
    // against a world players can reach, and once at the end as a re-assert.
    // The seed path is hostile to `gameConfig` — `runSeed`'s reset branch used
    // to drop the whole collection — so the closing call guarantees the world is
    // sealed when it is handed over, whatever the seeders did to the doc.
    expect(enableMaintenanceModeMock).toHaveBeenCalledTimes(2);
    const maintenanceArgs = enableMaintenanceModeMock.mock.calls[0];
    expect(maintenanceArgs[0]).toBe(db);
    expect(maintenanceArgs[1].enabledBy).toBe("test");
    expect(typeof maintenanceArgs[1].reason).toBe("string");
    expect(maintenanceArgs[1].reason.length).toBeGreaterThan(0);

    vi.doUnmock("@/lib/admin/resetGameWorld");
    vi.doUnmock("@/lib/admin/bootstrapGameWorld");
    vi.doUnmock("@/lib/npp/seedHistorical");
    vi.doUnmock("@/lib/maintenanceStatus");
    vi.doUnmock("@/lib/admin/finalizeResetGameWorld");
  });

  it("gives resetGameWorld the same log sink it gives bootstrapGameWorld", async () => {
    // The reset phase is roughly half a reset's wall time. Until it took a
    // logger, an admin watching the SSE stream saw nothing at all until
    // bootstrap started, and the reset's own seeder output never left the
    // function. Both phases must write to the caller's sink.
    const resetGameWorldMock = vi
      .fn()
      .mockImplementation(async (_db: unknown, opts: { log?: (m: string) => void }) => {
        opts.log?.("wiped runtime collections");
        return { success: true, message: "ok", details: { budgetSeedLog: [] } };
      });
    const bootstrapGameWorldMock = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/admin/resetGameWorld", () => ({ resetGameWorld: resetGameWorldMock }));
    vi.doMock("@/lib/admin/bootstrapGameWorld", () => ({
      bootstrapGameWorld: bootstrapGameWorldMock,
    }));
    vi.doMock("@/lib/npp/seedHistorical", () => ({
      seedHistoricalOfficials: vi.fn().mockResolvedValue({ officialsCreated: 0, nppsCreated: 0 }),
    }));
    vi.doMock("@/lib/maintenanceStatus", () => ({
      enableMaintenanceMode: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("@/lib/admin/finalizeResetGameWorld", () => ({
      finalizeResetGameWorld: vi.fn().mockResolvedValue({
        demographicsReset: 0,
        customPartiesDeleted: 0,
        partyOrgRecordsDeleted: 0,
        finalizeLog: [],
      }),
    }));

    vi.resetModules();
    const { resetAndBootstrapGameWorld: fresh } =
      await import("@/lib/admin/resetAndBootstrapGameWorld");

    const streamed: string[] = [];
    const result = await fresh({
      db: {
        collection: () => ({ updateOne: async () => ({}), insertOne: async () => ({}) }),
      } as never,
      mode: "vacant",
      preset: "2019-default",
      seedOnly: true,
      log: (msg: string) => streamed.push(msg),
    });

    // Live, while the reset is still running — not just in the response body.
    expect(streamed).toContain("wiped runtime collections");
    // And captured in the returned transcript alongside the bootstrap lines.
    expect(result.logs).toContain("wiped runtime collections");

    vi.doUnmock("@/lib/admin/resetGameWorld");
    vi.doUnmock("@/lib/admin/bootstrapGameWorld");
    vi.doUnmock("@/lib/npp/seedHistorical");
    vi.doUnmock("@/lib/maintenanceStatus");
    vi.doUnmock("@/lib/admin/finalizeResetGameWorld");
  });

  it("seals the world before resetGameWorld destroys anything", async () => {
    // `enableMaintenanceMode` used to be step 4, after BOTH phases finished, and
    // `isActive: false` was not written until deep inside resetGameWorld's final
    // gameState update. So for the first several minutes of a reset the runtime
    // wipe and the country seed ran against a world the turn cron still
    // considered active and that players could still load pages on.
    const order: string[] = [];
    const resetGameWorldMock = vi.fn().mockImplementation(async () => {
      order.push("resetGameWorld");
      return { success: true, message: "ok", details: { budgetSeedLog: [] } };
    });
    const bootstrapGameWorldMock = vi.fn().mockImplementation(async () => {
      order.push("bootstrapGameWorld");
    });
    const enableMaintenanceModeMock = vi.fn().mockImplementation(async () => {
      order.push("enableMaintenanceMode");
    });
    const updateOne = vi.fn().mockImplementation(async () => {
      order.push("gameState.updateOne");
      return { modifiedCount: 1 };
    });

    vi.doMock("@/lib/admin/resetGameWorld", () => ({ resetGameWorld: resetGameWorldMock }));
    vi.doMock("@/lib/admin/bootstrapGameWorld", () => ({
      bootstrapGameWorld: bootstrapGameWorldMock,
    }));
    vi.doMock("@/lib/npp/seedHistorical", () => ({
      seedHistoricalOfficials: vi.fn().mockResolvedValue({ officialsCreated: 0, nppsCreated: 0 }),
    }));
    vi.doMock("@/lib/maintenanceStatus", () => ({
      enableMaintenanceMode: enableMaintenanceModeMock,
    }));
    vi.doMock("@/lib/admin/finalizeResetGameWorld", () => ({
      finalizeResetGameWorld: vi.fn().mockResolvedValue({
        demographicsReset: 0,
        customPartiesDeleted: 0,
        partyOrgRecordsDeleted: 0,
        finalizeLog: [],
      }),
    }));

    vi.resetModules();
    const { resetAndBootstrapGameWorld: fresh } =
      await import("@/lib/admin/resetAndBootstrapGameWorld");

    await fresh({
      // `insertOne` is the reset's audit row, opened right after the seal.
      // Recorded in `order` too, so the assertions below can place it.
      db: {
        collection: () => ({
          updateOne,
          insertOne: async () => {
            order.push("adminLogs.insertOne");
            return {};
          },
        }),
      } as never,
      mode: "historical",
      preset: "2019-default",
      seedOnly: true,
      adminUsername: "test",
    });

    // Both halves of the seal land before the first destructive call.
    expect(order.indexOf("enableMaintenanceMode")).toBeLessThan(order.indexOf("resetGameWorld"));
    expect(order.indexOf("gameState.updateOne")).toBeLessThan(order.indexOf("resetGameWorld"));
    // ...and the audit row is opened in that same window: after the world is
    // sealed, before anything is destroyed. Opened later (it used to be written
    // in finalize) a run that dies in teardown records nothing at all.
    expect(order.indexOf("adminLogs.insertOne")).toBeGreaterThan(
      order.indexOf("gameState.updateOne")
    );
    expect(order.indexOf("adminLogs.insertOne")).toBeLessThan(order.indexOf("resetGameWorld"));
    // The turn cron gates on gameState.isActive, so that is what must be cleared.
    expect(updateOne.mock.calls[0][1]).toMatchObject({ $set: { isActive: false } });

    vi.doUnmock("@/lib/admin/resetGameWorld");
    vi.doUnmock("@/lib/admin/bootstrapGameWorld");
    vi.doUnmock("@/lib/npp/seedHistorical");
    vi.doUnmock("@/lib/maintenanceStatus");
    vi.doUnmock("@/lib/admin/finalizeResetGameWorld");
  });

  it("re-exports the orchestrator for downstream consumers", () => {
    expect(typeof resetAndBootstrapGameWorld).toBe("function");
  });
});

describe("bootstrap contract: deprecated migration directory", () => {
  it("has its own README documenting what was absorbed", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../../../");
    const readme = await fs.readFile(
      path.join(root, "scripts/migrations/deprecated/README.md"),
      "utf8"
    );
    expect(readme).toMatch(/absorbed by/i);
    expect(readme).toMatch(/sovereignDefaultPhase1FederalBudget/);
    expect(readme).toMatch(/add-election-write-guard-indexes/);
  });

  it("seedIndexes barrel runs every absorbed index module", async () => {
    const seedIndexes = await import("@/lib/admin/seed/seedIndexes");
    // Spot-check the modules that absorb Phase 4 migrations.
    expect(typeof seedIndexes.seedWriteGuardIndexes).toBe("function");
    expect(typeof seedIndexes.seedPartyNppReworkIndexes).toBe("function");
    expect(typeof seedIndexes.seedSovereignDefaultIndexes).toBe("function");
    expect(typeof seedIndexes.seedObservabilityIndexes).toBe("function");
    expect(typeof seedIndexes.seedFinancialTxLogIndexes).toBe("function");
    expect(typeof seedIndexes.seedCommodityPriceIndexes).toBe("function");
  });
});
