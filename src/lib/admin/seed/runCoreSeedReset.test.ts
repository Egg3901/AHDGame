/**
 * Contract tests for `runSeed`'s reset branch — specifically what it is allowed
 * to destroy.
 *
 * These pin a constant rather than driving `runSeed` against a mock database:
 * the function reaches `getDb()` through `isLayer1PositionsEnabled` and
 * `loadEraFullOverride`, so it cannot run without a live connection. The
 * constant is the whole contract, and it is the thing that regresses.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  RESET_DROP_COLLECTIONS,
  STALE_MARKET_MODE_STAMP_UNSET,
  STALE_PER_WORLD_GAME_CONFIG_UNSET,
} from "@/lib/admin/seed/runCoreSeed";
import { coreGameConfigUpdate, STALE_FREIGHT_MODE_STAMP_UNSET } from "./coreGameConfigUpdate";
import { gameConfig as referenceGameConfig } from "@/lib/seeds/reference/gameConfig";

describe("runSeed reset drops", () => {
  it("does not drop gameConfig, which holds operational state no seeder restores", () => {
    // `gameConfig` is a singleton whose ~113 fields are ~10 seeded reference
    // defaults and ~100 pieces of live operational state: maintenance mode, the
    // Discord webhook URLs, every admin feature gate (labourSystemMode,
    // marketSystemMode, indexFundsMode, moneySupplyEnabled, …). Dropping it
    // re-seeds the ten and silently discards the hundred — nothing anywhere
    // restores them, and `DEFAULT_GAME_STATE_FLAGS` covers `gameState`, not this
    // collection.
    //
    // Two concrete consequences of the old behaviour:
    //   - `POST /api/seed?reset=true` unsealed a site an admin had put into
    //     maintenance, and disconnected the Discord integration.
    //   - `resetAndBootstrapGameWorld` seals the world as step 0; that seal has
    //     to survive the seeders, or the reset unseals itself halfway through.
    //
    // The upsert that follows the drop list `$set`s every seeded field anyway,
    // so the drop was never load-bearing for the reference half.
    expect(RESET_DROP_COLLECTIONS.map((e) => e.name)).not.toContain("gameConfig");
  });

  it("clears the per-world market-guard markers instead of dropping the doc", () => {
    // The one thing the drop did buy: clearing per-world runtime markers that
    // the turn engine stamps onto gameConfig (src/lib/market/launchGuard.ts).
    // Same shape as STALE_PROGRESS_GAME_STATE_UNSET on gameState — an explicit
    // $unset list beats a blanket drop.
    expect(Object.keys(STALE_PER_WORLD_GAME_CONFIG_UNSET).sort()).toEqual([
      "commodityNominalPriceIndex",
      "commodityNominalPriceIndexTurn",
      "marketGuardReferenceFundamentalMcap",
      "marketGuardReferenceMcap",
      "marketGuardReferenceTurn",
      "marketGuardTrippedAt",
      "retailDemandTransitionStartTurn",
      "retailDemandTransitionTurns",
    ]);
  });

  it("clears the commodity price level and the Retail unwind, which a new world starts without", () => {
    // `commodityNominalPriceIndex` multiplies every commodity base price
    // (src/lib/turn/commodity/pricing.ts) and `retailDemandTransitionStartTurn`
    // pauses new Retail capacity until start + duration
    // (src/lib/market/retailDemandTransition.ts). Both are stamped by the world
    // that was played, in that world's turns, and `gameConfig` is never dropped.
    for (const key of [
      "commodityNominalPriceIndex",
      "commodityNominalPriceIndexTurn",
      "retailDemandTransitionStartTurn",
      "retailDemandTransitionTurns",
    ]) {
      expect(STALE_PER_WORLD_GAME_CONFIG_UNSET, key).toHaveProperty(key, "");
    }
  });

  it("never clears a key the reference seed writes, so the two writes cannot fight", () => {
    // The unset runs before `coreGameConfigUpdate`'s `$set`; a key in both would
    // be cleared and then re-written, and the list would be documenting a
    // default it does not apply.
    for (const key of Object.keys(STALE_PER_WORLD_GAME_CONFIG_UNSET)) {
      expect(referenceGameConfig, key).not.toHaveProperty(key);
    }
  });

  it("keeps the market-guard configuration knobs, which are not per-world state", () => {
    // `marketGuardEnabled` / `DropPct` / `GraceTurns` are admin configuration
    // and must survive a reset like every other feature gate. Only the stamped
    // reference values are per-world.
    for (const configKey of ["marketGuardEnabled", "marketGuardDropPct", "marketGuardGraceTurns"]) {
      expect(STALE_PER_WORLD_GAME_CONFIG_UNSET).not.toHaveProperty(configKey);
    }
  });

  it("still drops the region-keyed reference collections a preset switch would strand", () => {
    // Guards against over-correcting the fix above into "drop nothing".
    for (const name of ["states", "stateDemographics", "macroMetrics", "politicalMetrics"]) {
      expect(RESET_DROP_COLLECTIONS.map((e) => e.name)).toContain(name);
    }
  });
});

describe("reset adopts the reference market tier", () => {
  // The pair of decisions in this describe block are load-bearing together and
  // were, for a while, silently contradictory: `gameConfig` is never dropped
  // (see above) AND `marketSystemMode` was only ever written by `$setOnInsert`.
  // The document therefore always already existed, the insert branch never
  // fired after the very first world this database ever had, and every reset
  // world inherited its predecessor's tier — permanently, because the next
  // reset inherited it again. Observed on prod: a fresh 1953 world sitting on
  // "ledger" two raises of the reference default later.
  it("writes market and campaign modes on reset, preserving them during top-ups", () => {
    const reset = coreGameConfigUpdate(true, 1991);
    const topUp = coreGameConfigUpdate(false, 1991);
    expect(reset.$set?.marketSystemMode).toBe(referenceGameConfig.marketSystemMode);
    expect(reset.$set?.campaignEraPriceLevelEnabled).toBe(true);
    expect(topUp.$set).not.toHaveProperty("marketSystemMode");
    expect(topUp.$set).not.toHaveProperty("campaignEraPriceLevelEnabled");
    expect(topUp.$setOnInsert).toEqual({
      marketSystemMode: referenceGameConfig.marketSystemMode,
      campaignEraPriceLevelEnabled: true,
    });
  });

  it("clears the provenance stamps naming whoever set the previous world's tier", () => {
    expect(Object.keys(STALE_MARKET_MODE_STAMP_UNSET).sort()).toEqual([
      "marketSystemModeUpdatedAt",
      "marketSystemModeUpdatedBy",
      "marketSystemModeUpdatedTurn",
    ]);
  });

  it("has a reference tier for the reset branch to adopt", () => {
    expect(referenceGameConfig.marketSystemMode).toBeTruthy();
  });
});

describe("reset adopts the reference freight tier", () => {
  // `freightSettlementMode` is in the reference seed, so a reset sets it back to
  // "shadow". The stamps naming who last changed it, and on which turn, belong to
  // the world that tier was chosen in, the same as the market-tier stamps above.
  it("clears the provenance stamps naming whoever set the previous world's freight tier", () => {
    expect(Object.keys(STALE_FREIGHT_MODE_STAMP_UNSET).sort()).toEqual([
      "freightSettlementModeUpdatedAt",
      "freightSettlementModeUpdatedBy",
      "freightSettlementModeUpdatedTurn",
    ]);
  });

  it("unsets both stamp sets on reset and none on a top-up, without colliding with the $set", () => {
    const reset = coreGameConfigUpdate(true, 1991);
    const topUp = coreGameConfigUpdate(false, 1991);
    expect(Object.keys(reset.$unset ?? {}).sort()).toEqual([
      "freightSettlementModeUpdatedAt",
      "freightSettlementModeUpdatedBy",
      "freightSettlementModeUpdatedTurn",
      "marketSystemModeUpdatedAt",
      "marketSystemModeUpdatedBy",
      "marketSystemModeUpdatedTurn",
    ]);
    expect(topUp).not.toHaveProperty("$unset");
    expect(reset.$set?.freightSettlementMode).toBe(referenceGameConfig.freightSettlementMode);
    // MongoDB rejects an update that both sets and unsets one path.
    expect(Object.keys(reset.$unset ?? {}).filter((key) => key in (reset.$set ?? {}))).toEqual([]);
  });
});

describe("reset leaves a new world its own prices and Retail rules", () => {
  /** Apply the top-level `$set` / `$unset` of an update the way MongoDB would. */
  function applyUpdate(
    doc: Record<string, unknown>,
    update: { $set?: object; $unset?: object }
  ): Record<string, unknown> {
    const next: Record<string, unknown> = { ...doc, ...update.$set };
    for (const key of Object.keys(update.$unset ?? {})) delete next[key];
    return next;
  }

  // A world that was played to turn 1329: the first block is stamped by the turn
  // engine or by an operator in that world's turns, the second is configuration
  // an operator chose and a reset preserves by design.
  const deadWorld: Record<string, unknown> = {
    _id: "default",
    commodityNominalPriceIndex: 1.9569,
    commodityNominalPriceIndexTurn: 1329,
    retailDemandTransitionStartTurn: 514,
    retailDemandTransitionTurns: 192,
    marketGuardReferenceMcap: 3_560_375_953,
    marketGuardReferenceTurn: 2,
    freightSettlementMode: "active",
    freightSettlementModeUpdatedBy: "operator",
    freightSettlementModeUpdatedAt: "2026-08-13T23:16:31.180Z",
    freightSettlementModeUpdatedTurn: 100,
    marketSystemModeUpdatedBy: "operator",
    maintenanceMode: "full",
    registrationEnabled: false,
    savingsAccountsMode: "authoritative",
    privateBankingEnabled: true,
    publicReviewMode: true,
  };

  // Mirrors the two writes `runSeed` issues on a reset, in order.
  const afterReset = () =>
    applyUpdate(
      applyUpdate(deadWorld, { $unset: STALE_PER_WORLD_GAME_CONFIG_UNSET }),
      coreGameConfigUpdate(true, 1991) as { $set?: object; $unset?: object }
    );

  it("starts the price level, Retail rules and freight provenance from nothing", () => {
    const after = afterReset();
    for (const key of [
      "commodityNominalPriceIndex",
      "commodityNominalPriceIndexTurn",
      "retailDemandTransitionStartTurn",
      "retailDemandTransitionTurns",
      "marketGuardReferenceMcap",
      "marketGuardReferenceTurn",
      "freightSettlementModeUpdatedBy",
      "freightSettlementModeUpdatedAt",
      "freightSettlementModeUpdatedTurn",
      "marketSystemModeUpdatedBy",
    ]) {
      expect(after, `gameConfig.${key} must not survive the reset`).not.toHaveProperty(key);
    }
    expect(after.freightSettlementMode).toBe("shadow");
    expect(after.seedYear).toBe(1991);
  });

  it("keeps the operator configuration the reset is not allowed to touch", () => {
    expect(afterReset()).toMatchObject({
      maintenanceMode: "full",
      registrationEnabled: false,
      savingsAccountsMode: "authoritative",
      privateBankingEnabled: true,
      publicReviewMode: true,
    });
  });

  it("runSeed clears the markers inside the reset branch, before the reference write", () => {
    // `runSeed` cannot be driven without a live connection (see the file header),
    // so the order is asserted on the source, like the command-economy gate below.
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/admin/seed/runCoreSeed.ts"),
      "utf8"
    );
    const resetBranch = src.indexOf("if (reset) {");
    const clearWrite = src.indexOf("{ $unset: STALE_PER_WORLD_GAME_CONFIG_UNSET }");
    const referenceWrite = src.indexOf("coreGameConfigUpdate(reset, seedYear)");
    expect(resetBranch).toBeGreaterThan(-1);
    expect(clearWrite).toBeGreaterThan(resetBranch);
    expect(referenceWrite).toBeGreaterThan(clearWrite);
  });
});

describe("gameConfig write ordering", () => {
  // A source-order assertion rather than a behavioural one: `seedAllCountryData`
  // is a sibling export in the same module as `bootstrapGameWorld`, so it cannot
  // be mocked out from under it, and driving the real orchestrator needs a live
  // database. The invariant is narrow and mechanical enough that reading the
  // file is a fair proxy — and it is the ordering, not the values, that broke.
  it("bootstrapGameWorld sets the command-economy era gate AFTER seedAllCountryData", () => {
    // `runSeed` re-seeds gameConfig from the static reference object, which
    // hardcodes `commandEconomyEnabled: true`. Written before the seed, the era
    // gate is silently overwritten and a 1991/2019 world runs with a command
    // economy switched on. Measured before the fix on a 1953 reset as
    // `commandEconomyEnabled: true` with `commandEconomyEnabledBy: undefined` —
    // the two are written together, so a missing `By` proves the surviving
    // value came from the seed object. Measured after, on 1991: `false` /
    // `"system:bootstrap"`.
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/admin/bootstrapGameWorld.ts"),
      "utf8"
    );
    const seedCall = src.indexOf(
      "await seedAllCountryData(db, resetReference, log, preset, options.run);"
    );
    const gateWrite = src.indexOf('commandEconomyEnabledBy: "system:bootstrap"');
    expect(seedCall).toBeGreaterThan(-1);
    expect(gateWrite).toBeGreaterThan(-1);
    expect(gateWrite).toBeGreaterThan(seedCall);
  });
});

describe("region-derived catch-up coverage", () => {
  // Superseded by "region-derived stage placement" below: `seedNationalManpower`
  // no longer needs a bloc-specific catch-up because it runs from
  // `runRegionDerivedStage`, which is ordered after the Warsaw-Pact block. The
  // invariant it protected — the bloc six MUST end up with manpower pools — is
  // kept here against the measured number, since that is the thing that
  // regressed (24 -> 18) when the ordering was wrong.
  it("the bloc six are the reason the stage is ordered where it is", () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/admin/bootstrapGameWorld.ts"),
      "utf8"
    );
    // Documented, so the next person to move this call knows what it costs.
    expect(src).toContain("runRegionDerivedStage");
    expect(src).toMatch(/Warsaw[- ]Pact/);
  });
});

describe("region-derived stage placement", () => {
  // The four seeders nobody added a catch-up for produced a US-only world:
  // MEASURED on a fresh 1953 bootstrap with 226 states across 24 countries as
  // militaryUnits 13/1, energyPlants 7/1, infraProjects 5/1, cabinetEstates
  // 65/6. `runSeed` seeds only the US states bundle and then called them, and
  // each reads `states` for its roster.
  const bootstrapSrc = () =>
    fs.readFileSync(path.resolve(process.cwd(), "src/lib/admin/bootstrapGameWorld.ts"), "utf8");
  const coreSrc = () =>
    fs.readFileSync(path.resolve(process.cwd(), "src/lib/admin/seed/runCoreSeed.ts"), "utf8");

  it("runSeed does not call the region-derived seeders directly", () => {
    // They belong to runRegionDerivedStage, which runSeed invokes only behind
    // `includeRegionDerived` — the flag `seedAllCountryData` turns off.
    const src = coreSrc();
    const body = src.slice(
      src.indexOf("export async function runSeed"),
      src.indexOf("export async function runRegionDerivedStage")
    );
    for (const seeder of [
      "seedMilitaryUnits(",
      "seedCabinetEstates(",
      "seedEnergyPlants(",
      "seedInfraProjects(",
      "seedNationalManpower(",
    ]) {
      expect(
        body,
        `${seeder} must live in runRegionDerivedStage, not runSeed's body`
      ).not.toContain(`await ${seeder}`);
    }
  });

  it("seedAllCountryData runs the stage AFTER the Warsaw-Pact countries are seeded", () => {
    // The bloc six are the last countries to get regions. A stage that runs
    // before them repeats the original bug for exactly those six — which is how
    // nationalManpower measured 18/24 during the A3 refactor.
    const src = bootstrapSrc();
    const bloc = src.indexOf("await seedEasternBlocStatePartyOrg(");
    const stage = src.indexOf('run.step("build", "runRegionDerivedStage"');
    expect(bloc).toBeGreaterThan(-1);
    expect(stage).toBeGreaterThan(bloc);
  });

  it("the stage runs after the GDP reconcile barrier", () => {
    const src = bootstrapSrc();
    const reconcile = src.indexOf("await reconcileStateGdpWithNationalSeeds(");
    const stage = src.indexOf('run.step("build", "runRegionDerivedStage"');
    expect(stage).toBeGreaterThan(reconcile);
  });

  it("no catch-up re-runs survive in bootstrapGameWorld", () => {
    // Four of these existed only to paper over the misplaced stage;
    // seedStateResourceCapacity ran three times per bootstrap to reach the
    // coverage one correctly-placed call gives.
    const src = bootstrapSrc();
    for (const seeder of [
      "seedStateResourceCapacity(",
      "seedStateSectorSpecializations(",
      "seedNationalManpower(",
    ]) {
      expect(
        src,
        `${seeder} catch-up should be gone — runRegionDerivedStage owns it`
      ).not.toContain(`await ${seeder}`);
    }
  });
});

describe("reset drop scoping", () => {
  const byName = Object.fromEntries(RESET_DROP_COLLECTIONS.map((e) => [e.name, e]));

  it("scopes every country-keyed collection instead of dropping it whole", () => {
    // A global drop here deleted 1,995 documents on `POST /api/seed?reset=true`
    // and `scripts/seed/seed.ts --reset`, taking `states` from 24 countries to 1 —
    // because `runSeed` is the US pack and re-seeds only the US. Every other
    // country is seeded by its own module, each of which already scopes its own
    // reset with deleteMany({ countryId }).
    for (const name of [
      "states",
      "stateDemographics",
      "demographicDefaults",
      "politicalParties",
      "statePartyOrg",
      "politicalMetrics",
      "macroMetrics",
      "federalBudget",
      "stateBudgets",
      "stateResourceCapacity",
      "congressionalDistricts",
      "stateSectorSpecializations",
    ]) {
      expect(byName[name], `${name} missing from the drop list`).toBeDefined();
      expect(byName[name].scope, `${name} must be scoped by countryId`).toBe("countryId");
    }
  });

  it("scopes the region-id-keyed collections by the preset's US bundle", () => {
    // These key on the region id in `_id` and carry no countryId, so a
    // countryId filter would silently match nothing and delete nothing.
    for (const name of ["stateBaselines", "stateMetricBaselines", "stateMetrics"]) {
      expect(byName[name].scope).toBe("stateIds");
    }
  });

  it("does not drop stateRegistrationPool, which runSeed cannot rebuild", () => {
    // Its only seeder, `seedRegistrationLanes`, is in bootstrapGameWorld.
    // Measured 51 -> 0 on the standalone path, with nothing to restore it — and
    // scoping would not have helped, since the US is who loses the rows.
    expect(RESET_DROP_COLLECTIONS.map((e) => e.name)).not.toContain("stateRegistrationPool");
  });

  it("leaves only genuinely global reference data unscoped", () => {
    const global = RESET_DROP_COLLECTIONS.filter((e) => e.scope === "global").map((e) => e.name);
    expect(global.sort()).toEqual([
      "demographicCategories",
      "formulaGrants",
      "legislationTypes",
      "policies",
    ]);
  });

  it("explains every entry that is not scoped by countryId", () => {
    // A `global` or `stateIds` entry is the dangerous kind — it is the shape
    // that deleted other countries' data. Each must carry its reason.
    for (const entry of RESET_DROP_COLLECTIONS) {
      if (entry.scope === "countryId") continue;
      expect(
        entry.note,
        `${entry.name} (${entry.scope}) needs a note explaining the scope`
      ).toBeTruthy();
    }
  });
});

describe("forex ordering", () => {
  // Two ordering defects in the same six lines of bootstrapGameWorld, fixed by
  // one move. Source-order assertions: driving `bootstrapGameWorld` far enough
  // to observe either would need a live database and ~40 mocked seeders, and
  // what broke is the ordering, not the values. The measured evidence is in the
  // commit message.
  const src = () =>
    fs.readFileSync(path.resolve(process.cwd(), "src/lib/admin/bootstrapGameWorld.ts"), "utf8");

  it("seeds forex BEFORE the seedOnly return", () => {
    // `resetGameWorld` deletes `exchangeRates` and `centralBanks`, and
    // `seedForex` is their only re-seeder. With it below the early return, the
    // admin "Reset Only" AND "Delete All Data" buttons — both of which post
    // without `bootstrap: true` — left a world with no exchange rates and no
    // central banks, recoverable only by pressing a different button.
    const s = src();
    expect(s.indexOf('guarded("seedForex"')).toBeGreaterThan(-1);
    expect(s.indexOf('guarded("seedForex"')).toBeLessThan(s.indexOf("if (seedOnly) {"));
  });

  it("builds the turn-1 stock snapshot AFTER forex exists", () => {
    // `generateStockExchangeSnapshots` converts each corp via `getCorpFxRate`,
    // which returns 1.0 when no rate document exists. Built before `seedForex`,
    // the snapshot mixed converted and unconverted values — and it is served
    // straight from the document by /api/stock-exchange, with both rebuild paths
    // (the turn and the 15-minute cron) skipping while paused. A freshly reset
    // world is sealed in maintenance mode, so the wrong snapshot stood for the
    // whole window an admin would be inspecting it.
    const s = src();
    expect(s.indexOf('guarded("generateStockExchangeSnapshots"')).toBeGreaterThan(
      s.indexOf('guarded("seedForex"')
    );
  });

  it("keeps the stock snapshot after initializeGameState, which it needs a turn from", () => {
    const s = src();
    expect(s.indexOf('guarded("generateStockExchangeSnapshots"')).toBeGreaterThan(
      s.indexOf("await initializeGameState()")
    );
  });
});

describe("per-country seeder roster", () => {
  // The same "which countries does this world contain" list is written out by
  // hand in several places — 104 per-country calls in bootstrapGameWorld alone —
  // and nothing forced them to agree. Two divergences were measured before the
  // reset path stopped seeding: `seedNgBudgets` ran on bootstrap but not on
  // reset, and the reset-only Eastern-Bloc budget loop covered EIGHT ids
  // including BLR and BAL, which have no `states` rows at all and are not in the
  // 1953 roster. Both are gone; these pin them shut.
  const bootstrapSrc = () =>
    fs.readFileSync(path.resolve(process.cwd(), "src/lib/admin/bootstrapGameWorld.ts"), "utf8");

  const countriesWith = (re: RegExp, src: string) =>
    [...new Set([...src.matchAll(re)].map((m) => m[1].toUpperCase()))].sort();

  it("gives every country with a budget seeder a region seeder too", () => {
    // Budgets derive from regions (state.gdp), so a budget seeder without a
    // region seeder prices a country that does not exist. The converse is fine:
    // a country may have regions and no authored budget.
    const src = bootstrapSrc();
    const budgets = countriesWith(/await\s+seed([A-Z][a-z])Budgets\(/g, src);
    const regions = countriesWith(/await\s+seed([A-Z]{2})Regions\(/g, src);
    for (const c of budgets) {
      expect(regions, `${c} has a budget seeder but no region seeder`).toContain(c);
    }
  });

  it("seeds an Eastern-Bloc budget for exactly the countries that have regions", () => {
    // The hazard this pins is a budget loop naming a country id with zero
    // `states` rows, which produced orphan federalBudget + enactedLaws docs.
    // UKR/BLR/BAL used to be that case; they now seed their own regions, so
    // they belong in the loop and the guard is the region seeder, not the id.
    const src = bootstrapSrc();
    const loop = src.slice(src.indexOf('for (const cid of ["HU"'));
    const ids = [...new Set([...loop.slice(0, 300).matchAll(/"([A-Z]{2,3})"/g)].map((m) => m[1]))];
    expect(ids.sort()).toEqual(["BAL", "BG", "BLR", "CS", "HU", "PL", "RO", "UKR", "YU"]);
  });

  it("keeps the reset path out of the seeding business entirely", () => {
    // `resetGameWorld` is teardown; every seeder it used to call is bootstrap's.
    // A seeder reappearing there is the double-seed coming back, and with it the
    // roster drift, since the two lists were maintained separately.
    const resetSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/admin/resetGameWorld.ts"),
      "utf8"
    );
    expect(resetSrc).not.toMatch(/await\s+seed[A-Z][a-z]Budgets\(/);
    expect(resetSrc).not.toContain("await seedAllCountryData(");
    expect(resetSrc).not.toContain("seedEasternBlocBudget");
  });
});
