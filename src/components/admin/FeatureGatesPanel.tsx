"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_GAME_STATE_FLAGS } from "@/lib/seeds/reference/featureFlagDefaults";
import { gameConfig as gameConfigDefaults } from "@/lib/seeds/reference/gameConfig";

type NppAutonomyLevel = "off" | "v0" | "v1" | "v2" | "v3" | "v4";
type NppForeignPolicyMode = "off" | "shadow" | "active";
type NppForeignPolicyStage = "votes" | "proposals" | "trade" | "support" | "war";

interface BooleanGate {
  key: string;
  label: string;
  desc: string;
}

// Mirrors FEATURE_GATE_BOOLEAN_KEYS in /api/admin/feature-gates.
//
// Exported so `featureGateParity.test.ts` can hold the two lists in agreement.
// `key` is a bare string and the route's enum is the real contract, so nothing
// but that test stops a gate being added to one side and silently missing from
// the other — which ships a flag no admin can reach, or a dead toggle.
export const BOOLEAN_GATES: BooleanGate[] = [
  { key: "forexEnabled", label: "Forex", desc: "Multi-currency exchange-rate system." },
  {
    key: "nppCorpStrategyEnabled",
    label: "NPP corp strategy loop",
    desc: "NPP-run corporations switch approach (expand, harvest, defend, retrench, pivot) when the current one stops improving their margin. Off pins every corp to expand, which is the pre-v5 behaviour.",
  },
  {
    key: "playerRandomEventsEnabled",
    label: "Player random events",
    desc: "PREE offers new players random events.",
  },
  {
    key: "crisisInteractionEnabled",
    label: "Crisis interaction",
    desc: "Decision trees, collective contributions, input nodes.",
  },
  {
    key: "livingConflictsEnabled",
    label: "Living conflicts and global responses",
    desc: "1.3 phased world conflicts, role-specific government responses, and aggregate outcomes. Enabling retires the legacy Vietnam choice chain.",
  },
  {
    key: "autoDisastersEnabled",
    label: "Auto crises & disasters",
    desc: "Master gate for the automatic crisis/disaster system.",
  },
  {
    key: "crisisAidBillsEnabled",
    label: "Crisis aid bills",
    desc: "Aid nodes use the slider + legislature-bill flow.",
  },
  {
    key: "demographicsLayer1PositionsEnabled",
    label: "Demographics Layer-1 positions",
    desc: "Seed derives archetype econ/social from Layer-1 positions.",
  },
  {
    key: "granularElectorateEnabled",
    label: "Granular-cell electorate",
    desc: "Vote shares over IPF-raked Layer-1 cells instead of the 12 archetypes.",
  },
  {
    key: "granularPollEnabled",
    label: "Granular polls",
    desc: "Poll breakdowns over Layer-1 electorate cells (additive to poll math).",
  },
  {
    key: "rpgStatsEnabled",
    label: "RPG stats",
    desc: "Character stat allocation, drift, debates.",
  },
  {
    key: "autoSectorSeedEnabled",
    label: "Auto sector seeding",
    desc: "Re-seeds unowned sectors every 48 turns.",
  },
  {
    key: "redistrictingEnabled",
    label: "US House redistricting",
    desc: "Districted redistricting system.",
  },
  {
    key: "sectorTechTreesEnabled",
    label: "Sector tech trees",
    desc: "Decade-gated R&D tech trees per sector.",
  },
  {
    key: "eraSystemEnabled",
    label: "Era system",
    desc: "Decade eras: era stamps + wire news at rollover, and approval/metric thresholds drift with the in-game decade. Review scripts/debug/era-approval-dryrun.ts before enabling.",
  },
  {
    key: "liveElectionResultsEnabled",
    label: "Live election results",
    desc: "Election-night results page (/elections/[id]/results): rolling calls, final-hour drip feed, Westminster projections.",
  },
  {
    key: "legislationDemographicEffectsV2Enabled",
    label: "Legislation demographic effects v2",
    desc: "Bills shift voter-group lean and turnout over time (economicLean/socialLean/turnout targets + decay toward seeded baselines). Population channel is always on.",
  },
  {
    key: "onboardingChecklistEnabled",
    label: "Onboarding checklist",
    desc: "New-player 7-step checklist on the profile page, welcome mail at character creation, and one-time completion reward. Off = legacy new-player banner.",
  },
  {
    key: "macroGrowthV1",
    label: "Macro-growth v1 (convergence)",
    desc: "Folds corporate buildout + historical catch-up into region GDP growth: a Solow convergence bonus toward the frontier (O2, gated by a state-ownership/trade/freedom openness index), a sector-signal blend into potential (O3), and paid corp growth-cost into the capital stock (O1c, capped at 5% of region GDP/yr). Review scripts/debug/macro-growth-dryrun.mjs before enabling.",
  },
  // ── Three gates below were in the route's enum but missing from this panel,
  // so they were unreachable from the UI. Found by featureGateParity.test.ts,
  // which now holds the two lists in agreement.
  {
    key: "extractionAutoStrategyEnabled",
    label: "Extraction auto strategy",
    desc: "Nudges standard miners on shortage deposits onto the matching focused mining strategy (Phase 1a of the extraction-capacity remediation). Default off.",
  },
  {
    key: "embargoTradeExposureEnabled",
    label: "Embargo trade exposure",
    desc: "Embargoes strip only a sector's cross-border leg, scaling revenue by its export exposure, instead of mothballing the whole operation including domestic host sales (#935). Off = legacy total-blackout behaviour.",
  },
  {
    // `isSeasonRecapEnabled` documents this as "flipped from the admin Feature
    // Gates panel" — but the entry was never added, so the doc described a
    // control that did not exist.
    key: "seasonRecapEnabled",
    label: "Season recap (Wrapped)",
    desc: "End-of-iteration Season Recap. Off or absent = inert: resetGameWorld builds no recaps, voluntary/admin retirements attach none, and the post-reset gate surfaces nothing.",
  },
  {
    key: "intOrgAlignmentEnabled",
    label: "IntOrg alignment",
    desc: "Cold War alignment: every nation holds a share per bloc pole plus a non-aligned remainder, drifting each turn and moved by influence plays. Adds the Cold War Ledger and the per-org Influence tab. Off by default — seeded values are written regardless, so flipping this on shows a populated map rather than blank rows. Tune drift against a live world before enabling.",
  },
  {
    key: "settlementCrisisEnabled",
    label: "Settlement crises",
    desc: "The German Question: a standing contest over whether West Germany stays sovereign in NATO or reunifies into the Warsaw Pact, fought across four weighted institutions by the GDR, USSR, USA and UK. Off by default and incomplete — the turn phase runs but nothing creates a crisis yet, so enabling this on a live world currently does nothing.",
  },
];

/** Default when gameConfig omits the lever (matches commandEconomyTurn). */
const COMMAND_ECONOMY_DEFAULT_TOLERANCE = 0.3;

const isDefaultOn = (key: string): boolean => key in DEFAULT_GAME_STATE_FLAGS;

const NPP_LEVELS: { value: NppAutonomyLevel; label: string; blurb: string }[] = [
  { value: "off", label: "Off", blurb: "No NPP autonomy anywhere." },
  { value: "v0", label: "v0 (current)", blurb: "Shipped behavior in non-player countries." },
  { value: "v1", label: "v1", blurb: "Governing brain in non-player countries." },
  { value: "v2", label: "v2", blurb: "Comingles with player countries / corps." },
  {
    value: "v3",
    label: "v3 (full agency — non-player countries)",
    blurb:
      "Full player-parity, but only in non-player-enabled countries: NPPs campaign, legislate, invest, and found & run their own companies where no players compete.",
  },
  {
    value: "v4",
    label: "v4 (full agency — global)",
    blurb:
      "Same as v3, applied everywhere — player-enabled countries included. NPPs become fully autonomous economic + political actors in every market.",
  },
];

const NPP_FOREIGN_POLICY_MODES: {
  value: NppForeignPolicyMode;
  label: string;
  blurb: string;
}[] = [
  { value: "off", label: "Off", blurb: "Do not plan or execute autonomous foreign policy." },
  {
    value: "shadow",
    label: "Shadow",
    blurb: "Score and audit decisions without changing diplomacy, trade, or conflicts.",
  },
  {
    value: "active",
    label: "Active",
    blurb: "Execute at most one scored action per country and strategic cycle.",
  },
];

const NPP_FOREIGN_POLICY_STAGES: {
  value: NppForeignPolicyStage;
  label: string;
  blurb: string;
}[] = [
  { value: "votes", label: "Votes", blurb: "Cast scored votes on pending organization business." },
  {
    value: "proposals",
    label: "Proposals",
    blurb: "Also table trade, aid, sanctions, and statement proposals.",
  },
  {
    value: "trade",
    label: "Trade",
    blurb: "Also introduce targeted tariff bills and manage temporary embargoes.",
  },
  {
    value: "support",
    label: "Support",
    blurb: "Also provide non-belligerent material support in existing wars.",
  },
  {
    value: "war",
    label: "War",
    blurb: "Also seek guarded war entry, conduct operations, and pursue peace.",
  },
];

/**
 * Graduated system modes that live on gameConfig instead of gameState. Writes
 * go through the existing per-system PATCH routes (NOT /feature-gates) because
 * some of them carry side effects — e.g. index-funds runs its bootstrap
 * migrations on a fresh enable.
 */
interface SystemMode {
  key: "labourSystemMode" | "marketSystemMode" | "indexFundsMode" | "freightSettlementMode";
  label: string;
  desc: string;
  endpoint: string;
  defaultValue: string;
  levels: { value: string; label: string; blurb: string }[];
}

const SYSTEM_MODES: SystemMode[] = [
  {
    key: "labourSystemMode",
    label: "Labour system",
    desc: "Graduated rollout — each tier is a superset of the previous.",
    endpoint: "/api/admin/config/labour",
    defaultValue: gameConfigDefaults.labourSystemMode ?? "off",
    levels: [
      { value: "off", label: "Off", blurb: "Baseline economy, no labour dynamics." },
      { value: "wages", label: "Wages", blurb: "Sector wage dynamics + minimum-wage laws." },
      { value: "macro", label: "Macro", blurb: "Wages feed back into the macro engine." },
      { value: "unions", label: "Unions", blurb: "Unions & collective bargaining." },
      { value: "full", label: "Full", blurb: "Complete labour system." },
    ],
  },
  {
    key: "marketSystemMode",
    label: "Market structure",
    desc: "Structural market rework — staged tiers.",
    endpoint: "/api/admin/config/market",
    defaultValue: gameConfigDefaults.marketSystemMode ?? "off",
    levels: [
      { value: "off", label: "Off", blurb: "Legacy market behavior." },
      {
        value: "realization",
        label: "Realization",
        blurb: "Corp revenue passes price realization.",
      },
      { value: "ledger", label: "Ledger", blurb: "Realization + double-entry financial ledger." },
      { value: "clearing", label: "Clearing", blurb: "Order-book market clearing." },
      { value: "capital", label: "Capital", blurb: "Full capital-markets tier." },
    ],
  },
  {
    key: "indexFundsMode",
    label: "Index funds",
    desc: "Fresh enable runs the fund-definition bootstrap migrations.",
    endpoint: "/api/admin/config/index-funds",
    defaultValue: gameConfigDefaults.indexFundsMode ?? "off",
    levels: [
      { value: "off", label: "Off", blurb: "Funds hidden." },
      { value: "partial", label: "Partial", blurb: "Read-only pages + cron accrual." },
      { value: "full", label: "Full", blurb: "Player buys/sells enabled." },
    ],
  },
  {
    key: "freightSettlementMode",
    label: "Freight settlement",
    desc: "Shadow records routes. Active applies delivered inputs to the next corporation turn.",
    endpoint: "/api/admin/config/freight-settlement",
    defaultValue: gameConfigDefaults.freightSettlementMode ?? "shadow",
    levels: [
      {
        value: "shadow",
        label: "Shadow",
        blurb: "Observe routes and capacity without changing plant throughput.",
      },
      {
        value: "active",
        label: "Active",
        blurb:
          "Use lagged delivered inputs in plant throughput. Requires market clearing or higher.",
      },
    ],
  },
];

interface GatesState {
  booleans: Record<string, boolean>;
  nppAutonomyLevel: NppAutonomyLevel;
  nppForeignPolicyMode: NppForeignPolicyMode;
  nppForeignPolicyStage: NppForeignPolicyStage;
}

function DefaultBadge() {
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
      style={{ background: "rgba(59,130,246,0.12)", color: "var(--primary)" }}
      title="Enabled by default on every fresh seed / reset"
    >
      Seed default
    </span>
  );
}

export function FeatureGatesPanel() {
  const [state, setState] = useState<GatesState | null>(null);
  const [modes, setModes] = useState<Record<string, string> | null>(null);
  const [commandEconomyEnabled, setCommandEconomyEnabled] = useState(false);
  const [commandEconomyTolerance, setCommandEconomyTolerance] = useState(
    COMMAND_ECONOMY_DEFAULT_TOLERANCE
  );
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const fetchState = useCallback(async () => {
    try {
      const [gatesRes, ...modeRes] = await Promise.all([
        fetch("/api/admin/feature-gates"),
        ...SYSTEM_MODES.map((m) => fetch(m.endpoint)),
      ]);
      if (gatesRes.ok) setState((await gatesRes.json()) as GatesState);
      const next: Record<string, string> = {};
      for (let i = 0; i < SYSTEM_MODES.length; i++) {
        const res = modeRes[i];
        if (res.ok) {
          const data = (await res.json()) as {
            mode?: string;
            commandEconomyEnabled?: boolean;
            commandEconomySecondEconomyTolerance?: number;
          };
          next[SYSTEM_MODES[i].key] = data.mode ?? "off";
          // Command-economy flags live on the market config route (gameConfig),
          // not /feature-gates — pull them from that GET response.
          if (SYSTEM_MODES[i].key === "marketSystemMode") {
            setCommandEconomyEnabled(data.commandEconomyEnabled === true);
            setCommandEconomyTolerance(
              typeof data.commandEconomySecondEconomyTolerance === "number"
                ? data.commandEconomySecondEconomyTolerance
                : COMMAND_ECONOMY_DEFAULT_TOLERANCE
            );
          }
        }
      }
      setModes(next);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  const post = useCallback(async (body: unknown, savingId: string) => {
    setSavingKey(savingId);
    setError("");
    try {
      const res = await fetch("/api/admin/feature-gates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as Partial<GatesState> & { error?: string };
      if (!res.ok) {
        setError(data.error || "Failed to update gate");
        return;
      }
      if (
        data.booleans &&
        data.nppAutonomyLevel &&
        data.nppForeignPolicyMode &&
        data.nppForeignPolicyStage
      ) {
        setState({
          booleans: data.booleans,
          nppAutonomyLevel: data.nppAutonomyLevel,
          nppForeignPolicyMode: data.nppForeignPolicyMode,
          nppForeignPolicyStage: data.nppForeignPolicyStage,
        });
      }
    } catch {
      setError("Network error");
    } finally {
      setSavingKey(null);
    }
  }, []);

  const patchMode = useCallback(async (mode: SystemMode, value: string) => {
    setSavingKey(mode.key);
    setError("");
    try {
      const res = await fetch(mode.endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: value }),
      });
      const data = (await res.json()) as { mode?: string; error?: string };
      if (!res.ok) {
        setError(data.error || `Failed to update ${mode.label}`);
        return;
      }
      setModes((prev) => ({ ...(prev ?? {}), [mode.key]: data.mode ?? value }));
    } catch {
      setError("Network error");
    } finally {
      setSavingKey(null);
    }
  }, []);

  /** PATCH market config flags; route requires `mode` on every write (same as MarketAdminPanel). */
  const patchMarketFlags = useCallback(
    async (body: Record<string, unknown>, savingId: string) => {
      const currentMode = modes?.marketSystemMode ?? "off";
      setSavingKey(savingId);
      setError("");
      try {
        const res = await fetch("/api/admin/config/market", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: currentMode, ...body }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setError(data.error || "Failed to update command economy");
          return;
        }
        if (typeof body.commandEconomyEnabled === "boolean") {
          setCommandEconomyEnabled(body.commandEconomyEnabled);
        }
        if (typeof body.commandEconomySecondEconomyTolerance === "number") {
          setCommandEconomyTolerance(body.commandEconomySecondEconomyTolerance);
        }
      } catch {
        setError("Network error");
      } finally {
        setSavingKey(null);
      }
    },
    [modes]
  );

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted">Loading feature gates…</span>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <p className="text-sm text-destructive">Could not load feature gates.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 shadow-card sm:p-6">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">Feature Gates</h3>
        <p className="text-xs leading-relaxed text-muted">
          One control surface for every game feature flag, including the graduated system modes.
          Gates marked <span className="font-semibold text-primary">seed default</span> ship enabled
          on every fresh world; the rest are staged rollouts. NPP economy and line of credit are
          core systems — always on, no longer gated.
        </p>
      </div>

      {error ? (
        <p className="mb-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {/* NPP autonomy level selector */}
      <div className="mb-5 rounded-lg border border-card-border bg-background/40 p-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">NPP autonomy</span>
            <DefaultBadge />
          </div>
          <span className="text-[10px] uppercase tracking-wider text-muted">
            {NPP_LEVELS.find((l) => l.value === state.nppAutonomyLevel)?.label}
          </span>
        </div>
        <p className="mb-3 text-xs text-muted">
          Fresh seeds start at <span className="font-semibold">v4</span>.{" "}
          {NPP_LEVELS.find((l) => l.value === state.nppAutonomyLevel)?.blurb}
        </p>
        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-card-border bg-card p-1">
          {NPP_LEVELS.map((lvl) => {
            const active = state.nppAutonomyLevel === lvl.value;
            return (
              <button
                key={lvl.value}
                type="button"
                disabled={savingKey === "level"}
                onClick={() => void post({ kind: "level", value: lvl.value }, "level")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                  active
                    ? "bg-primary text-white"
                    : "text-muted hover:bg-background hover:text-foreground"
                }`}
              >
                {lvl.label}
              </button>
            );
          })}
        </div>
        {/* TLDR — what each level does, visible before enabling anything. */}
        <ul className="mt-3 space-y-1 border-t border-card-border pt-2.5">
          {NPP_LEVELS.map((lvl) => (
            <li key={lvl.value} className="flex gap-2 text-[11px] leading-relaxed">
              <span
                className={`w-24 shrink-0 font-semibold ${
                  state.nppAutonomyLevel === lvl.value ? "text-primary" : "text-foreground"
                }`}
              >
                {lvl.label}
              </span>
              <span className="text-muted">{lvl.blurb}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mb-5 rounded-lg border border-card-border bg-background/40 p-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">NPP foreign policy</span>
          <span className="text-[10px] uppercase tracking-wider text-muted">
            {
              NPP_FOREIGN_POLICY_MODES.find((mode) => mode.value === state.nppForeignPolicyMode)
                ?.label
            }
          </span>
        </div>
        <p className="mb-3 text-xs text-muted">
          Defaults to shadow when absent. Active mode can cast organization votes, table diplomacy,
          aid allies, support alliance war entry, impose embargoes, and introduce tariff bills.
        </p>
        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-card-border bg-card p-1">
          {NPP_FOREIGN_POLICY_MODES.map((mode) => {
            const active = state.nppForeignPolicyMode === mode.value;
            return (
              <button
                key={mode.value}
                type="button"
                disabled={savingKey === "foreign-policy-mode"}
                title={mode.blurb}
                onClick={() =>
                  void post(
                    { kind: "foreign-policy-mode", value: mode.value },
                    "foreign-policy-mode"
                  )
                }
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                  active
                    ? "bg-primary text-white"
                    : "text-muted hover:bg-background hover:text-foreground"
                }`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
        <p className="mt-3 border-t border-card-border pt-2.5 text-[11px] leading-relaxed text-muted">
          {
            NPP_FOREIGN_POLICY_MODES.find((mode) => mode.value === state.nppForeignPolicyMode)
              ?.blurb
          }
        </p>
        <div className="mt-3 border-t border-card-border pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold">Active capability stage</span>
            <span className="text-[10px] uppercase tracking-wider text-muted">
              {
                NPP_FOREIGN_POLICY_STAGES.find(
                  (stage) => stage.value === state.nppForeignPolicyStage
                )?.label
              }
            </span>
          </div>
          <div className="inline-flex flex-wrap gap-1 rounded-lg border border-card-border bg-card p-1">
            {NPP_FOREIGN_POLICY_STAGES.map((stage) => {
              const active = state.nppForeignPolicyStage === stage.value;
              return (
                <button
                  key={stage.value}
                  type="button"
                  disabled={savingKey === "foreign-policy-stage"}
                  title={stage.blurb}
                  onClick={() =>
                    void post(
                      { kind: "foreign-policy-stage", value: stage.value },
                      "foreign-policy-stage"
                    )
                  }
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    active
                      ? "bg-primary text-white"
                      : "text-muted hover:bg-background hover:text-foreground"
                  }`}
                >
                  {stage.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            {
              NPP_FOREIGN_POLICY_STAGES.find((stage) => stage.value === state.nppForeignPolicyStage)
                ?.blurb
            }
          </p>
        </div>
      </div>

      {/* Graduated system modes (gameConfig) */}
      <div className="mb-5 space-y-3">
        {SYSTEM_MODES.map((mode) => {
          const current = modes?.[mode.key] ?? "off";
          const saving = savingKey === mode.key;
          return (
            <div
              key={mode.key}
              className="rounded-lg border border-card-border bg-background/40 p-4"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{mode.label}</span>
                  {mode.defaultValue !== "off" ? <DefaultBadge /> : null}
                </div>
                <span className="text-[10px] uppercase tracking-wider text-muted">
                  {mode.levels.find((l) => l.value === current)?.label ?? current}
                </span>
              </div>
              <p className="mb-3 text-xs text-muted">
                {mode.desc}
                {mode.defaultValue !== "off" ? (
                  <>
                    {" "}
                    Fresh seeds start at <span className="font-semibold">{mode.defaultValue}</span>.
                  </>
                ) : null}
              </p>
              <div className="inline-flex flex-wrap gap-1 rounded-lg border border-card-border bg-card p-1">
                {mode.levels.map((lvl) => {
                  const active = current === lvl.value;
                  return (
                    <button
                      key={lvl.value}
                      type="button"
                      disabled={saving}
                      title={lvl.blurb}
                      onClick={() => void patchMode(mode, lvl.value)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                        active
                          ? "bg-primary text-white"
                          : "text-muted hover:bg-background hover:text-foreground"
                      }`}
                    >
                      {lvl.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Command economy — gameConfig flags via /api/admin/config/market (not /feature-gates). */}
        <div className="rounded-lg border border-card-border bg-background/40 p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">
                Command economy (USSR/China planned regime)
              </span>
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                style={{
                  background: commandEconomyEnabled
                    ? "rgba(34,197,94,0.15)"
                    : "rgba(148,163,184,0.15)",
                  color: commandEconomyEnabled ? "var(--success)" : "var(--muted)",
                }}
              >
                {commandEconomyEnabled ? "On" : "Off"}
              </span>
            </div>
            <button
              type="button"
              disabled={savingKey === "commandEconomyEnabled"}
              onClick={() =>
                void patchMarketFlags(
                  { commandEconomyEnabled: !commandEconomyEnabled },
                  "commandEconomyEnabled"
                )
              }
              className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                commandEconomyEnabled
                  ? "border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10"
                  : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
              }`}
            >
              {savingKey === "commandEconomyEnabled"
                ? "…"
                : commandEconomyEnabled
                  ? "Disable"
                  : "Enable"}
            </button>
          </div>
          <p className="mb-3 text-xs text-muted">
            Fixed non-convertible currencies, administered prices, shortage/overhang, second
            economy. Default off.
          </p>
          <label className="block text-xs text-muted">
            <span className="mb-1 flex items-center justify-between gap-2">
              <span>Second-economy tolerance</span>
              <span className="font-semibold text-foreground tabular-nums">
                {commandEconomyTolerance.toFixed(2)}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={commandEconomyTolerance}
              disabled={savingKey === "commandEconomyTolerance" || !commandEconomyEnabled}
              onChange={(e) => setCommandEconomyTolerance(Number(e.target.value))}
              onPointerUp={(e) => {
                const next = Number((e.target as HTMLInputElement).value);
                void patchMarketFlags(
                  { commandEconomySecondEconomyTolerance: next },
                  "commandEconomyTolerance"
                );
              }}
              className="mt-1 w-full accent-[var(--primary)] disabled:opacity-50"
            />
            <span className="mt-1 flex justify-between text-[10px] text-muted">
              <span>0 — full repression</span>
              <span>1 — tolerated</span>
            </span>
          </label>
        </div>
      </div>

      {/* Boolean gates */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {BOOLEAN_GATES.map((gate) => {
          const on = state.booleans[gate.key] === true;
          const saving = savingKey === gate.key;
          return (
            <div
              key={gate.key}
              className="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-background/40 p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{gate.label}</span>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                    style={{
                      background: on ? "rgba(34,197,94,0.15)" : "rgba(148,163,184,0.15)",
                      color: on ? "var(--success)" : "var(--muted)",
                    }}
                  >
                    {on ? "On" : "Off"}
                  </span>
                  {isDefaultOn(gate.key) ? <DefaultBadge /> : null}
                </div>
                <p className="truncate text-[11px] text-muted">{gate.desc}</p>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => void post({ kind: "boolean", key: gate.key, value: !on }, gate.key)}
                className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                  on
                    ? "border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10"
                    : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                }`}
              >
                {saving ? "…" : on ? "Disable" : "Enable"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
