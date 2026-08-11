/**
 * Client-safe market-system mode metadata — the single source of truth for
 * the mode enum, its order, and the per-mode TLDRs. `featureFlag.ts`
 * (server-only: touches Mongo) re-exports the type + order from here; the
 * admin panel and API route both consume this module so the client, the Zod
 * schema, and the engine can never drift.
 */
export type MarketSystemMode = "off" | "realization" | "ledger" | "clearing" | "capital" | "plants";

/** Tiers in ascending order; index = rank used for `marketAtLeast` comparisons. */
export const MARKET_MODE_ORDER: readonly MarketSystemMode[] = [
  "off",
  "realization",
  "ledger",
  "clearing",
  "capital",
  "plants",
] as const;

export const MARKET_MODE_INFO: Record<
  MarketSystemMode,
  { label: string; description: string; live: boolean }
> = {
  off: { label: "Off", description: "Today's economy, unchanged.", live: true },
  realization: {
    label: "Realization",
    description:
      "Sectors realize revenue at the (lagged) market price of what they sell — shortages pay a premium, gluts bleed. Damped and clamped to [−30%, +50%].",
    live: true,
  },
  ledger: {
    label: "Ledger",
    description:
      "Shadow commodity flow ledger + inventory: per-turn produced / cleared / unmet / unsold / stock rows. Observability only — never changes balance.",
    live: true,
  },
  clearing: {
    label: "Clearing",
    description:
      "Posted prices + cheapest-first market clearing, and inputs physically gate output (scarcest input binds, ramped). Pricing posture becomes a real decision with a volume trade-off.",
    live: true,
  },
  capital: {
    label: "Capital",
    description:
      "Sectors own productive capacity that depreciates; the growth slider becomes investment (stop investing and capacity decays), output is gated by capacity, and unit economics (price − labour − inputs − capital charge) are surfaced per sector.",
    live: true,
  },
  plants: {
    label: "Plants",
    description:
      "Sectors ARE their plants: owned capacity is the authoritative production base and revenue is derived from what those plants actually make and sell. The nameplate revenue number stops compounding on its own — output grows only when capacity does.",
    // Selectable as of the transition-readiness pass. `live` only controls
    // whether the admin panel offers the tier and whether the mode route will
    // accept it without `allowNonLive` — it is NOT a world's mode. Flipping a
    // world still requires an explicit admin action, and that action should be
    // preceded by `scripts/ops/plantsPreflight.ts` (GO/NO-GO) and followed by
    // `scripts/ops/plantsWatch.ts` (soak). Rollback: D13 drill, see
    // `scripts/migrations/restoreCapitalModeFromShadow.ts`.
    live: true,
  },
};
