/**
 * Export shell for the research panels (#2331, #2332, #2333, #2336).
 *
 * Read-only and bounded: every request is validated by `parseResearchQuery`
 * (turn window cap, row cap, keyset cursor), reads only the sanitized research
 * collections plus the sourcing ledger, and never touches player records.
 * The row builders and metric reproductions live in `rules.ts`.
 */
import type { Db } from "mongodb";
import {
  getCountryTurnTelemetryCollection,
  getSecurityTelemetryCollection,
} from "@/lib/db/collections/researchTelemetry";
import type { CommoditySourcingDoc } from "@/lib/logistics/sourcingLedger";
import { yearOfTurn } from "@/lib/utils/gameDate";
import { isFoundingTurn } from "@/lib/telemetry/longHorizon/rules";
import {
  resolveLongHorizonContext,
  type LongHorizonContext,
} from "@/lib/telemetry/longHorizon/telemetry";
import {
  ANNUAL_FISCAL_CALC_VERSION,
  COUNTRY_TURN_CALC_VERSION,
  RESEARCH_SECURITY_MAX_TURNS_PER_PAGE,
  RESEARCH_TELEMETRY_SCHEMA_VERSION,
  RESEARCH_UNITS,
  SECURITY_PANEL_CALC_VERSION,
  TRADE_PANEL_CALC_VERSION,
  buildAnnualFiscalPanel,
  buildTradeTelemetryRow,
  expandTradePanel,
  securitiesMarketMetrics,
  tradeObserverMetrics,
  type ResearchQuery,
} from "./rules";

export interface ResearchExport {
  schemaVersion: number;
  panel: ResearchQuery["panel"];
  worldId: string | null;
  turnRange: { from: number; to: number };
  /** Retained turns actually present in the window; absence is not zero. */
  observedTurns: { first: number | null; last: number | null; count: number };
  calcVersion: number;
  units: typeof RESEARCH_UNITS;
  rows: unknown[];
  /** Panel-level reproductions of published observer metrics, when defined. */
  metrics?: unknown;
  /** Pass as `after` to fetch the next page; null when the window is exhausted. */
  nextCursor: string | null;
}

const CALC_VERSIONS = {
  "country-turn": COUNTRY_TURN_CALC_VERSION,
  "annual-fiscal": ANNUAL_FISCAL_CALC_VERSION,
  trade: TRADE_PANEL_CALC_VERSION,
  securities: SECURITY_PANEL_CALC_VERSION,
} as const;

function envelope(
  query: ResearchQuery,
  worldId: string | null,
  turns: number[],
  rows: unknown[],
  nextCursor: string | null,
  metrics?: unknown
): ResearchExport {
  const sorted = [...new Set(turns)].sort((a, b) => a - b);
  return {
    schemaVersion: RESEARCH_TELEMETRY_SCHEMA_VERSION,
    panel: query.panel,
    worldId,
    turnRange: { from: query.fromTurn, to: query.toTurn },
    observedTurns: {
      first: sorted[0] ?? null,
      last: sorted[sorted.length - 1] ?? null,
      count: sorted.length,
    },
    calcVersion: CALC_VERSIONS[query.panel],
    units: RESEARCH_UNITS,
    rows,
    ...(metrics !== undefined ? { metrics } : {}),
    nextCursor,
  };
}

/** `(turn > t) or (turn = t and key > k)` as a Mongo filter fragment. */
function afterFilter(after: ResearchQuery["after"], keyField: string) {
  if (!after) return {};
  return {
    $or: [{ turn: { $gt: after.turn } }, { turn: after.turn, [keyField]: { $gt: after.key } }],
  };
}

export async function runResearchExport(
  db: Db,
  query: ResearchQuery,
  ctx: LongHorizonContext | null
): Promise<ResearchExport> {
  const worldId = ctx?.worldId ?? null;
  const worldFilter = worldId ? { worldId } : {};
  const window = { turn: { $gte: query.fromTurn, $lte: query.toTurn } };

  if (query.panel === "country-turn" || query.panel === "annual-fiscal") {
    const countryFilter = query.countries ? { country: { $in: query.countries } } : {};
    const base = { ...worldFilter, ...countryFilter };
    if (query.panel === "annual-fiscal") {
      // Annual rows need every retained turn of the window, so this panel
      // reads the window whole; the turn cap bounds it (rows x turns).
      const turns = await getCountryTurnTelemetryCollection(db)
        .find({ ...base, ...window })
        .sort({ country: 1, turn: 1 })
        .toArray();
      return envelope(
        query,
        worldId,
        turns.map((t) => t.turn),
        buildAnnualFiscalPanel(turns),
        null
      );
    }
    const found = await getCountryTurnTelemetryCollection(db)
      .find({ ...base, ...window, ...afterFilter(query.after, "country") })
      .sort({ turn: 1, country: 1 })
      .limit(query.limit + 1)
      .toArray();
    const page = found.slice(0, query.limit);
    const last = page[page.length - 1];
    return envelope(
      query,
      worldId,
      page.map((r) => r.turn),
      page,
      found.length > query.limit && last ? `${last.turn}:${last.country}` : null
    );
  }

  if (query.panel === "securities") {
    const found = await getSecurityTelemetryCollection(db)
      .find({
        ...worldFilter,
        turn: { $gte: Math.max(query.fromTurn, (query.after?.turn ?? -1) + 1), $lte: query.toTurn },
      })
      .sort({ turn: 1 })
      .limit(RESEARCH_SECURITY_MAX_TURNS_PER_PAGE + 1)
      .toArray();
    const page = found.slice(0, RESEARCH_SECURITY_MAX_TURNS_PER_PAGE);
    const last = page[page.length - 1];
    return envelope(
      query,
      worldId,
      page.map((r) => r.turn),
      page,
      found.length > RESEARCH_SECURITY_MAX_TURNS_PER_PAGE && last ? String(last.turn) : null,
      securitiesMarketMetrics(page)
    );
  }

  // trade: sourcing ledger documents, retained for SOURCING_FLOW_RETENTION_TURNS.
  const docs = await db
    .collection<CommoditySourcingDoc>("commoditySourcingFlows")
    .find({
      ...window,
      ...(query.commodities ? { commodity: { $in: query.commodities as never[] } } : {}),
      ...afterFilter(query.after, "commodity"),
    })
    .sort({ turn: 1, commodity: 1 })
    .limit(query.limit + 1)
    .toArray();
  const page = docs.slice(0, query.limit);
  const clock = ctx?.clock ?? {};
  const startingYear = ctx?.startingYear ?? 0;
  const tradeRows = page.map((doc) =>
    buildTradeTelemetryRow({
      worldId: worldId ?? "unknown",
      sourceClass: ctx?.sourceClass ?? "multiplayer",
      ...(ctx?.runId !== undefined ? { runId: ctx.runId } : {}),
      ...(ctx?.seed !== undefined ? { seed: ctx.seed } : {}),
      ...(ctx?.codeVersion !== undefined ? { codeVersion: ctx.codeVersion } : {}),
      turn: doc.turn,
      year: ctx
        ? yearOfTurn(doc.turn, startingYear, {
            preIterationActive: clock.preIterationActive,
            preIterationTurns: clock.preIterationTurns,
          })
        : 0,
      foundingTurn: ctx ? isFoundingTurn(doc.turn, clock) : false,
      observedAt: doc.createdAt,
      commodity: doc.commodity,
      summary: {
        demandUnitsIntent: doc.demandUnitsIntent,
        intraStateUnits: doc.intraStateUnits,
        interStateUnits: doc.interStateUnits,
        importUnits: doc.importUnits,
        unmetUnits: doc.unmetUnits,
        toleranceBoundUnits: doc.toleranceBoundUnits ?? 0,
        capacityBoundUnits: doc.capacityBoundUnits ?? 0,
      },
      pairs: doc.countryPairs ?? [],
      destinations: doc.destinations ?? [],
    })
  );
  const last = page[page.length - 1];
  return envelope(
    query,
    worldId,
    tradeRows.map((r) => r.turn),
    tradeRows.flatMap((row) => expandTradePanel(row)),
    docs.length > query.limit && last ? `${last.turn}:${last.commodity}` : null,
    tradeObserverMetrics(tradeRows)
  );
}

/** Convenience for the route: resolve provenance, then run the export. */
export async function exportResearchPanel(db: Db, query: ResearchQuery): Promise<ResearchExport> {
  const ctx = await resolveLongHorizonContext(db, query.toTurn);
  return runResearchExport(db, query, ctx);
}
