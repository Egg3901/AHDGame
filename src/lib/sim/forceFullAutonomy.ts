import type { Db } from "mongodb";
import type { GameConfig } from "@/lib/db/types";
import type {
  GameState,
  CountryGameState,
  NppAutonomyLevel,
  NppForeignPolicyMode,
  NppForeignPolicyStage,
} from "@/lib/db/types/gameState";
import { ALL_COUNTRY_IDS } from "@/lib/constants/countries";

/** Re-exported for callers that already import from this module — the
 * implementation and its full rationale live in bootstrapGameWorld.ts,
 * alongside the function whose gap it exists to cover. */
export { stampInitialGameClock } from "@/lib/admin/bootstrapGameWorld";

/**
 * Flips every lever needed for a sandbox world to run 100% NPP-driven, for the
 * headless seeded-balance sim harness (scripts/sim/runWorld.ts).
 *
 * - `nppAutonomyLevel: "v3"` globally, mirroring the admin feature-gates route's
 *   write shape (src/app/api/admin/feature-gates/route.ts) including the legacy
 *   `nppAutonomyEnabled` boolean back-compat readers still check.
 * - Every `countryGameStates.enabledForPlayers = false`. This matters beyond
 *   "no players exist in a sandbox anyway": getNppAutonomyLevelForCountry
 *   (src/lib/nppAutonomy/featureFlag.ts) gates player-enabled countries down to
 *   the comingle tiers (v2+) even at a higher configured level, while
 *   non-player countries get the configured level as-is. Forcing every country
 *   off the player rail is what makes v3 (and the v0 NPP-seating rails) apply
 *   everywhere instead of only at the comingle gate. CRITICAL: a fresh
 *   bootstrap has ZERO countryGameStates docs for most presets —
 *   seedCountryGameStates only writes rows for presets with an explicit
 *   PRESET_ENABLEMENT map (1953/1979-default only; see
 *   src/lib/admin/seed/seedCountryGameStates.ts) — so the original
 *   updateMany({}, ...) here matched NOTHING and every country silently kept
 *   its compiled-in CONFIG default (US/UK/JP default to "active", i.e.
 *   player-enabled). Found the hard way: appointNppPrimeMinister's safety
 *   rail explicitly refuses to touch player-enabled countries, so UK and JP
 *   parliamentary governments never formed across 100 real turns despite
 *   clear seat majorities. Now loops every known country and upserts with a
 *   MINIMAL field set — mirroring the exact pattern the admin per-country
 *   settings route already uses in production
 *   (src/app/api/admin/country/[code]/settings/route.ts's PATCH handler),
 *   which also never fabricates the doc's other "required" TS fields
 *   (currentTurn/cycleStartTurn/etc.) on upsert — so this is proven-safe,
 *   not a new risk.
 * - `isActive: true`, `pausedAt: null` so the turn engine's auto-pause-drift
 *   guard (turnSystem.ts) and election-cycle-anchor code see a live game.
 * - `autoDisastersEnabled: true`, `crisisAidBillsEnabled: true`: the master
 *   crisis-spawn gate defaults to false and nothing in bootstrap ever set it
 *   — found via a 100-turn sim run that spawned zero crises despite
 *   processAutoCrisisTurn being correctly wired into every turn
 *   (turnPhaseRegistry.ts). NPPs are actually ready to respond once crises
 *   exist: crisisIntake.ts already feeds active crises into the governing
 *   agenda, which cascades into ministerial orders and emergency bill
 *   sponsorship — both NPP-autonomous — so aid-via-bill-flow
 *   (crisisAidBillsEnabled) is enabled alongside spawning. Deliberately NOT
 *   enabling crisisInteractionEnabled (decision trees / collective
 *   contributions / input nodes) — that reads as a player-input-shaped
 *   system with no confirmed NPP hook; leave off until verified.
 * - `conflictsEnabled: true`, `coldWarEnabled: true`: user-requested for the
 *   500-turn audit. NOTE: confirmed via grep that both are PURE UI-visibility
 *   gates (src/app/world/conflicts/_coldwar/gate.ts's page redirect,
 *   client-nav's navbar link) — neither has any src/lib/turn or
 *   src/simulation phase reading them. Harmless to enable, but adds no
 *   testable mechanic to a headless sim; flagging so this isn't mistaken for
 *   real new coverage.
 * - `nppOffensiveInitiationEnabled: true`, `nppOffensiveJoinEnabled: true`: the two
 *   admin switches that let an NPP belligerent declare an offensive and follow an
 *   ally into one. Both ship OFF for real worlds, and both are real turn mechanics
 *   (foreignPolicy's `conduct_war` candidate; battleResolution's auto-join roster),
 *   so leaving them off would silently empty the war stage this helper selects.
 * - `autoSectorSeedEnabled: true`: user-requested; this one IS a real,
 *   self-contained turn mechanic (src/lib/turn/autoSectorSeed.ts, fires every
 *   48 turns) — no NPP-side wiring needed.
 * - `sectorTechTreesEnabled: true`: user-requested; gates the tech-tree
 *   unlock/abandon routes, which are CEO-decision-driven and currently
 *   player-only (src/app/api/corporation/[id]/tech/{unlock,abandon}/route.ts)
 *   — only becomes meaningful once NPP CEOs can act on it, see
 *   src/lib/nppAutonomy/v3/corp/nppCeoManagement.ts.
 */
export async function forceFullAutonomy(
  db: Db,
  /**
   * Autonomy tier to force. Defaults to v3 (the historical behavior of this
   * helper). Pass "v4" to exercise the global tier — the harness previously
   * hardcoded v3, which meant the one thing v4 changes (autonomy running inside
   * player-enabled countries) could not be simulated at all. Pass "v5" for the
   * persistent-goal tier.
   *
   * Note that at v4 the `enabledForPlayers = false` sweep below stops being the
   * mechanism that makes autonomy apply everywhere — v4 applies everywhere by
   * definition. It is still performed so a v3 and a v4 run differ only in the
   * level, which is what makes an A/B comparison meaningful.
   *
   * The default is deliberately NOT raised as new tiers ship: every comparison
   * run has to name its own level, or the baseline silently moves under the
   * comparison and the A/B stops meaning anything.
   */
  level: NppAutonomyLevel = "v3",
  foreignPolicyMode: NppForeignPolicyMode = "shadow",
  foreignPolicyStage: NppForeignPolicyStage = "war",
  preservePlayerRail = false
): Promise<void> {
  await db.collection<GameState>("gameState").updateOne(
    { _id: "current" },
    {
      $set: {
        nppAutonomyLevel: level,
        nppAutonomyEnabled: true,
        nppAutonomyEnabledBy: "sim-harness",
        nppForeignPolicyMode: foreignPolicyMode,
        nppForeignPolicyModeBy: "sim-harness",
        nppForeignPolicyModeAt: new Date().toISOString(),
        nppForeignPolicyStage: foreignPolicyStage,
        nppForeignPolicyStageBy: "sim-harness",
        nppForeignPolicyStageAt: new Date().toISOString(),
        isActive: true,
        pausedAt: null,
        autoDisastersEnabled: true,
        autoDisastersEnabledBy: "sim-harness",
        autoDisastersEnabledAt: new Date().toISOString(),
        // Boost random-tier crisis frequency for the audit — base per-template
        // rates (~0.002-0.004/turn) yielded only ~2 crises in 250 turns; ×5
        // makes crises a materially active force without spamming (per-crisis
        // cooldowns still apply). Production is unaffected (flag absent → ×1).
        crisisSpawnChanceMultiplier: 5,
        crisisAidBillsEnabled: true,
        crisisAidBillsEnabledBy: "sim-harness",
        crisisAidBillsEnabledAt: new Date().toISOString(),
        conflictsEnabled: true,
        conflictsEnabledBy: "sim-harness",
        conflictsEnabledAt: new Date().toISOString(),
        coldWarEnabled: true,
        coldWarEnabledBy: "sim-harness",
        coldWarEnabledAt: new Date().toISOString(),
        autoSectorSeedEnabled: true,
        autoSectorSeedEnabledBy: "sim-harness",
        autoSectorSeedEnabledAt: new Date().toISOString(),
        sectorTechTreesEnabled: true,
        sectorTechTreesEnabledBy: "sim-harness",
        sectorTechTreesEnabledAt: new Date().toISOString(),
        // Both ship OFF for real worlds (admin opt-in, Admin → World → Conflicts)
        // and MUST be forced on here. This helper defaults `foreignPolicyStage` to
        // "war", so the war stage is the thing a run at these settings exists to
        // exercise — and with the switches off a belligerent is never offered
        // `conduct_war` and never joins an ally's attack, so the harness would report
        // a fully-wired war stage that produced zero offensives. Exactly the failure
        // the `autoDisastersEnabled` note above records: a gate defaulting false and
        // nothing in bootstrap setting it, found only after a run came back empty.
        nppOffensiveInitiationEnabled: true,
        nppOffensiveInitiationEnabledBy: "sim-harness",
        nppOffensiveInitiationEnabledAt: new Date().toISOString(),
        nppOffensiveJoinEnabled: true,
        nppOffensiveJoinEnabledBy: "sim-harness",
        nppOffensiveJoinEnabledAt: new Date().toISOString(),
        // The Cold War world-event catalog (sputnik 1955-62, Berlin crisis
        // 1958-62, space race 1957-75, detente 1969-79, the 1973 oil-embargo
        // shock) is authored and era-gated in
        // events/worldEvents/handlers/coldWarWorldEvents.ts but never fired,
        // because nothing ever set this flag — so a 20-year Cold War world ran
        // with no Cold War events at all.
        worldEventsEnabled: true,
        worldEventsEnabledBy: "sim-harness",
        worldEventsEnabledAt: new Date().toISOString(),
        updatedAt: new Date(),
      },
    }
  );

  await db.collection<GameConfig>("gameConfig").updateOne(
    { _id: "default" },
    {
      $set: {
        // Both of these belong on gameConfig, NOT gameState: every consumer
        // reads `gameConfig._id:"default"` (commandEconomyTurn, commodityPriceTurn,
        // forexTurn, centralBankChairTurn, nppInsolvencyDissolution), so setting
        // them on gameState is a silent no-op.
        //
        // Without commandEconomyEnabled every planned economy is inert:
        // isCommandEconomy() is fail-safe on the flag, so RU/DD/CN fall through
        // to the market path and their state-owned sectors are never simulated.
        commandEconomyEnabled: true,
        commandEconomyEnabledBy: "sim-harness",
        commandEconomyEnabledAt: new Date().toISOString(),
        // The seed default is "wages" — tier 1 of 4 on the off→wages→macro→
        // unions→full ladder — which leaves the macro, unions and full tiers
        // entirely inert. In particular `ownedUnionMembershipPressureByKey` is
        // only fetched at "full", so union membership pressure never reaches
        // unionization or labor cost no matter who leads the union. A world
        // meant to exercise labour bargaining has to run at the top tier.
        labourSystemMode: "full",
        // Seeded true today, but pinned here so a seed-default change cannot
        // silently switch the monetary layer off mid-programme. Gates the
        // per-currency M1/M2 snapshots, monetary transmission and central-bank
        // operations — the money-supply term of the inflation model reads
        // moneySupplyGrowthPct, which degrades to gdpGrowth (a zero-effect
        // no-op) when the snapshots are absent.
        moneySupplyEnabled: true,
        // Bretton Woods exit. A 1953 world reaches ~1971 around turn 860, so a
        // long run should actually cross the Nixon Shock rather than hold a gold
        // peg into the mid-70s. Gated on a gold-cover pressure model and an
        // era-earliest year, so it fires on its own terms or not at all.
        // Sovereignty transitions. Fail-safe off by default (see the flag doc);
        // a 1953 world is exactly the era they describe.
        worldTransitionsEnabled: true,
        worldTransitionsEnabledBy: "sim-harness",
        worldTransitionsEnabledAt: new Date().toISOString(),
        brettonWoodsExitEnabled: true,
        brettonWoodsExitEnabledBy: "sim-harness",
        brettonWoodsExitEnabledAt: new Date().toISOString(),
        extractionOutputScaleEnabled: true,
        commodityScarcityDriftEnabled: true,
        qualityPremiumPricingEnabled: true,
        sectorQualityEnabled: true,
        stockCoverCapEnabled: true,
        supplyAgreementsEnabled: true,
        contractIssuanceEnabled: true,
        prospectingEnabled: true,
        brandLoyaltyEnabled: true,
        brandLoyaltySliceEnabled: true,
        nppCorporateAttacksEnabled: true,
        // Uncalibrated — see the note above.
        // These are two competing consumer-demand channels and the type doc is
        // explicit that householdConsumptionEnabled SUPERSEDES the demographics
        // uplift — "do not enable both". Nothing enforces it: the two reads in
        // commodityPriceTurn are independent `if`s with no `else`, so enabling
        // both stacks a demographics uplift on top of a household basket at a
        // size neither model was calibrated for. Household is the newer and
        // wider channel, so it wins and the older uplift stays off.
        demographicsDemandEnabled: false,
        householdConsumptionEnabled: true,
      },
    },
    { upsert: true }
  );

  const countryGameStates = db.collection<CountryGameState>("countryGameStates");
  const now = new Date();
  if (!preservePlayerRail) {
    await Promise.all(
      ALL_COUNTRY_IDS.map((countryId) =>
        countryGameStates.updateOne(
          { _id: countryId },
          // MUST stay false. It reads like it should be true for a world meant to
          // exercise everything, and flipping it does switch the auto-disaster /
          // auto-crisis / IO-broadcast spawners on (they walk
          // `getEnabledCountryIdsFromDb`, which resolves
          // `doc?.enabledForPlayers ?? status === "active"`; `??` only falls
          // through on null/undefined, so `false` pins that list to EMPTY).
          //
          // But `isNppAutonomyActive` returns false for any player-enabled country
          // REGARDLESS of autonomy level. It is a legacy strict rail that
          // deliberately does not extend into player countries even at v2+. It
          // gates appointNppPrimeMinister, autonomousOrgVoting and central-bank
          // chair seating, so flipping this would stop every government forming
          // for the whole run. That is the exact failure this file's header
          // documents (UK and JP never formed a government across 100 turns).
          //
          // The two needs genuinely conflict inside one predicate, so the spawners
          // were given their own status-based resolver instead:
          // `getSimulatedCountryIds` in countryAccess.ts.
          { $set: { enabledForPlayers: false, updatedAt: now } },
          { upsert: true }
        )
      )
    );
  }
}
