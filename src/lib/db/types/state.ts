import type { CountryId } from "../../constants/countries";
import type { CorporationType } from "../../constants/corporations";

export type RegionType = "state" | "constituency" | "nation" | "province" | "region";

export interface State {
  _id: string;
  countryId: CountryId;
  regionType?: RegionType;
  /** For constituencies/sub-regions: the parent nation or province ID */
  parentRegionId?: string;
  name: string;
  population: number;
  /**
   * Voting-eligible population (Σ ages ≥ `votingAgeEligible`), derived from the
   * region's cohort vector and written each turn by the demographic-flows phase
   * (P1b-1b). The election turnout pool consumes this so the electorate tracks
   * aging-in and deaths. Absent on worlds not yet seeded with cohort vectors —
   * consumers fall back to `population`.
   */
  votingEligiblePopulation?: number;
  /**
   * Working-age (labor-force) population (Σ ages [`workingAgeEligible`,
   * `retirementAgeEligible`)), derived from the cohort vector and written each
   * turn by the demographic-flows phase (P1b-1c). Consumed by the P1c GDP engine
   * as the labor force `L` (design §5.1) — the channel through which working-age
   * demographics modulate income tax (no separate tax-base multiplier). Absent
   * on worlds not yet seeded with cohort vectors.
   */
  workingAgePopulation?: number;
  /**
   * Active conscription / national-service withdrawal (§4.5), derived from the
   * cohort vector by the demographic phase. Subtracted from the labor force `L`
   * by the P1c GDP engine (civilian L = workingAgePopulation − this). Serving
   * people remain in `population` — they return after service. Absent on worlds
   * not yet seeded with cohort vectors.
   */
  militaryServicePopulation?: number;
  gdp: number;
  /**
   * Per-region Solow capital stock (millions — the SAME unit as `gdp`), the
   * monetary-coupling substrate for the P1c GDP engine. Advanced each turn by
   * `advanceCapitalStock` (investment from the central-bank prime rate minus
   * depreciation) and consumed by potential growth as `ΔK/K` (P1c-1). Seeded
   * `≈ 3 × gdp`; cold-starts from `gdp` when absent on un-seeded worlds.
   */
  capitalStock?: number;
  /**
   * Per-region cyclical OUTPUT GAP (%, actual vs potential output, §5.2). The
   * GDP engine accumulates the sector signal's deviation from potential into this
   * gap and closes it over time, so `gdpGrowth` reverts toward potential (P1c-2).
   * Cold-starts at 0 (no gap assumed) when absent.
   */
  outputGap?: number;
  /**
   * P2/D7 (plants mode): Σ owned-sector realized revenue as of
   * `sectorRealizedRevenueTurn`. The engine's cyclical sector signal reads this
   * as the previous-turn baseline for the annualized realized-revenue delta that
   * replaces the (vestigial under plants) `currentGrowthRate` average. Persisted
   * next to `outputGap`/`capitalStock` — the same per-region prior-value pattern.
   * Absent ⇒ no baseline ⇒ the signal falls back to the legacy weighted average.
   *
   * Unit is `sectorRealizedRevenueUnit`. `"host"` = host-state currency (the
   * unit sector fields are stored in). Missing unit = the legacy ₳-normalized
   * snapshot; the engine uses that ₳ path for one more turn then rewrites as
   * host so an FX move cannot annualize into phantom GDP growth (ticket #1084).
   */
  sectorRealizedRevenue?: number;
  sectorRealizedRevenueTurn?: number;
  sectorRealizedRevenueUnit?: "host";
  /**
   * O1c (design §5, macroGrowthV1): the paid corporate growth cost (₳, per turn)
   * summed over this region's sectors, written by the corp turn. The metric
   * engine converts it to local-millions, caps it at 5% of region GDP/yr, and
   * feeds it to the capital stock — but ONLY when `corpGrowthInvestmentTurn`
   * equals the current turn (a per-turn flow must be fresh, never a stale
   * phantom). Absent / stale ⇒ no extra investment.
   */
  corpGrowthInvestmentAnchor?: number;
  corpGrowthInvestmentTurn?: number;
  houseDistricts: number;
  /**
   * In-game year this region was admitted to the Union, for regions that began
   * the world as pre-statehood territories (AK/HI under `1953-default`).
   *
   * Statehood is otherwise defined by presence in the active preset's
   * apportionment map, which is a frozen constant — so this field is what lets
   * a territory cross into it mid-game. Absent on every region that was already
   * a state at seed time, which is all of them outside the 1953 era.
   *
   * @see src/lib/elections/statehoodAdmission.ts
   */
  admittedYear?: number;
  stateSenateSeats: number;
  /** @deprecated Use getStateLean() - lean is derived from demographics/2020, not stored */
  politicalLean?: number;
  region: "Northeast" | "Southeast" | "Midwest" | "Southwest" | "West" | string;
  bannerImage?: string;
  cachedEconomicLean?: number;
  cachedSocialLean?: number;
  demographicsLastUpdated?: Date;
  /**
   * The voting system used for general elections in this state/region.
   * - "fptp": First Past the Post — third-party candidates face a strategic-voting penalty as
   *           voters defect to their nearest major-party option to avoid "wasting" their vote.
   * - "rcv":  Ranked Choice Voting — no strategic-voting penalty; third parties compete on a
   *           level playing field. States can be switched to RCV through legislation.
   * Defaults to "fptp" when undefined.
   */
  votingSystem?: "fptp" | "rcv";
  sectorSpecializations?: {
    /** Sector receiving a +10 percentage-point regional profit margin bonus. */
    primary: CorporationType;
    /** Sector receiving a +5 percentage-point regional profit margin bonus. */
    secondary: CorporationType;
    updatedAt?: Date;
  };
  /**
   * Per-turn snapshot of the top sectors by corporate-sector revenue
   * aggregated across all corps with sector instances in this state.
   * Recomputed by `processTopSectorsRecompute` during the per-turn
   * `stateEffectsAndNationalAggregation` phase. Read by the State
   * Overview tab's Economy card.
   *
   * Empty / undefined when the state has no corporate-sector activity
   * yet (fresh-reset world) — the Overview falls back to
   * `sectorSpecializations.{primary, secondary}` for display.
   */
  topSectorsCache?: {
    sectors: Array<{
      sectorType: CorporationType;
      revenue: number;
      /**
       * `"primary"` when this sector matches `sectorSpecializations.primary`
       * (state grants +10pp margin bonus); `"secondary"` for +5pp.
       * `null` when the live sector isn't a seeded specialization.
       */
      specializationBonus: "primary" | "secondary" | null;
    }>;
    computedAtTurn: number;
    computedAt: Date;
  };
}
