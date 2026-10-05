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
import {
  SOURCING_FLOW_RETENTION_TURNS,
  type CommoditySourcingDoc,
} from "@/lib/logistics/sourcingLedger";
import { yearOfTurn } from "@/lib/utils/gameDate";
import { isFoundingTurn } from "@/lib/telemetry/longHorizon/rules";
import {
  resolveLongHorizonContext,
  type LongHorizonContext,
} from "@/lib/telemetry/longHorizon/telemetry";
import {
  ANNUAL_FISCAL_CALC_VERSION,
  COUNTRY_TURN_CALC_VERSION,
  RESEARCH_TELEMETRY_SCHEMA_VERSION,
  RESEARCH_UNITS,
  SECURITY_PANEL_CALC_VERSION,
  TRADE_PANEL_CALC_VERSION,
  annualRowCursor,
  annualRowsAfter,
  buildAnnualFiscalPanel,
  buildTradeTelemetryRow,
  expandTradePanel,
  flattenSecurityTurn,
  parseTradeCursorKey,
  researchRetentionLabel,
  securitiesMarketMetrics,
  securityPanelRowKey,
  takeResearchPage,
  tradeDocAfter,
  tradeObserverMetrics,
  tradePanelRowKey,
  type ResearchQuery,
  type SecurityPanelRow,
  type SecurityTelemetryRow,
  type TradePanelRow,
  type TradeTelemetryRow,
} from "./rules";

export interface ResearchExport {
  schemaVersion: number;
  panel: ResearchQuery["panel"];
  worldId: string | null;
  /** Run identity and effective feature manifest of the exporting database, when known. */
  provenance: {
    sourceClass: string | null;
    runId: string | null;
    seed: string | null;
    codeVersion: string | null;
    effectiveManifest: unknown;
  };
  /** Real live retention of the underlying rows; older turns are archived and not served. */
  retention: string;
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
  ctx: LongHorizonContext | null,
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
    provenance: {
      sourceClass: ctx?.sourceClass ?? null,
      runId: ctx?.runId ?? null,
      seed: ctx?.seed ?? null,
      codeVersion: ctx?.codeVersion ?? null,
      effectiveManifest: ctx?.effectiveManifest ?? null,
    },
    retention: researchRetentionLabel(query.panel, SOURCING_FLOW_RETENTION_TURNS),
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

/** Trade documents read per round trip while expanding them into rows. */
const TRADE_DOC_BATCH = 8;

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
      // Annual rows need every retained turn of the window, so the source rows
      // are read whole (the turn cap bounds that); the returned annual rows
      // are paged by limit and byte ceiling like every other panel.
      const turns = await getCountryTurnTelemetryCollection(db)
        .find({ ...base, ...window })
        .sort({ country: 1, turn: 1 })
        .toArray();
      const all = annualRowsAfter(buildAnnualFiscalPanel(turns), query.after);
      const { rows: page, more } = takeResearchPage(all, query.limit);
      const last = page[page.length - 1];
      return envelope(
        query,
        ctx,
        worldId,
        turns.map((t) => t.turn),
        page,
        more && last ? annualRowCursor(last) : null
      );
    }
    const found = await getCountryTurnTelemetryCollection(db)
      .find({ ...base, ...window, ...afterFilter(query.after, "country") })
      .sort({ turn: 1, country: 1 })
      .limit(query.limit + 1)
      .toArray();
    const { rows: page, more } = takeResearchPage(found, query.limit);
    const last = page[page.length - 1];
    return envelope(
      query,
      ctx,
      worldId,
      page.map((r) => r.turn),
      page,
      more && last ? `${last.turn}:${last.country}` : null
    );
  }

  if (query.panel === "securities") {
    // One whole-market document per turn can hold thousands of securities, so
    // documents are read one at a time and expanded to per-security rows; a
    // page never holds more than one document plus `limit` rows.
    const collection = getSecurityTelemetryCollection(db);
    const after = query.after;
    const afterKey = after && after.key !== "" ? after.key : null;
    const collected: SecurityPanelRow[] = [];
    let nextTurn = Math.max(query.fromTurn, after?.turn ?? 0);
    for (let reads = 0; reads <= query.toTurn - query.fromTurn + 1; reads++) {
      if (collected.length > query.limit || nextTurn > query.toTurn) break;
      const [doc] = await collection
        .find({ ...worldFilter, turn: { $gte: nextTurn, $lte: query.toTurn } })
        .sort({ turn: 1 })
        .limit(1)
        .toArray();
      if (!doc || doc.turn < nextTurn) break;
      const rows = flattenSecurityTurn(doc, after && doc.turn === after.turn ? afterKey : null);
      collected.push(...rows.slice(0, query.limit + 1 - collected.length));
      nextTurn = doc.turn + 1;
    }
    const { rows: page, more } = takeResearchPage(collected, query.limit);
    const last = page[page.length - 1];
    const metricTurns = [...new Set(page.map((r) => r.turn))].map((turn) => ({
      turn,
      securities: page.filter(
        (r): r is Extract<SecurityPanelRow, { kind: "security" }> =>
          r.turn === turn && r.kind === "security"
      ),
    }));
    return envelope(
      query,
      ctx,
      worldId,
      page.map((r) => r.turn),
      page,
      more && last ? `${last.turn}:${securityPanelRowKey(last)}` : null,
      securitiesMarketMetrics(metricTurns as unknown as SecurityTelemetryRow[])
    );
  }

  // trade: sourcing ledger documents, retained for SOURCING_FLOW_RETENTION_TURNS.
  // A document expands into one row per directed country pair, so documents are
  // read in small batches and the cursor can resume inside a document.
  const clock = ctx?.clock ?? {};
  const startingYear = ctx?.startingYear ?? 0;
  const after = query.after;
  const afterDoc = after ? { turn: after.turn, ...parseTradeCursorKey(after.key) } : null;
  const commodityFilter = query.commodities
    ? { commodity: { $in: query.commodities as never[] } }
    : {};
  const collected: TradePanelRow[] = [];
  const tradeRows: TradeTelemetryRow[] = [];
  let position: { turn: number; commodity: string; inclusive: boolean } | null = afterDoc
    ? { turn: afterDoc.turn, commodity: afterDoc.commodity, inclusive: afterDoc.pairKey !== null }
    : null;
  for (let batches = 0; batches <= query.toTurn - query.fromTurn + 2; batches++) {
    if (collected.length > query.limit) break;
    const docs = await db
      .collection<CommoditySourcingDoc>("commoditySourcingFlows")
      .find({
        ...window,
        ...commodityFilter,
        ...(position
          ? {
              $or: [
                { turn: { $gt: position.turn } },
                {
                  turn: position.turn,
                  commodity: position.inclusive
                    ? { $gte: position.commodity }
                    : { $gt: position.commodity },
                },
              ],
            }
          : {}),
      })
      .sort({ turn: 1, commodity: 1 })
      .limit(TRADE_DOC_BATCH)
      .toArray();
    let progressed = false;
    for (const doc of docs) {
      if (collected.length > query.limit) break;
      const isCursorDoc =
        afterDoc?.pairKey != null &&
        doc.turn === afterDoc.turn &&
        doc.commodity === afterDoc.commodity;
      // Guard against a source that repeats documents already passed.
      if (
        position &&
        !(
          tradeDocAfter(doc, position) ||
          (position.inclusive && doc.turn === position.turn && doc.commodity === position.commodity)
        )
      ) {
        continue;
      }
      progressed = true;
      position = { turn: doc.turn, commodity: doc.commodity, inclusive: false };
      const row = buildTradeTelemetryRow({
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
      });
      tradeRows.push(row);
      const expanded = expandTradePanel(row).filter(
        (r) => !isCursorDoc || tradePanelRowKey(r) > (afterDoc?.pairKey ?? "")
      );
      collected.push(...expanded.slice(0, query.limit + 1 - collected.length));
    }
    if (docs.length < TRADE_DOC_BATCH || !progressed) break;
  }
  const { rows: page, more } = takeResearchPage(collected, query.limit);
  const last = page[page.length - 1];
  return envelope(
    query,
    ctx,
    worldId,
    page.map((r) => r.turn),
    page,
    more && last ? `${last.turn}:${tradePanelRowKey(last)}` : null,
    tradeObserverMetrics(
      tradeRows.filter((r) => page.some((p) => p.turn === r.turn && p.commodity === r.commodity))
    )
  );
}

/** Convenience for the route: resolve provenance, then run the export. */
export async function exportResearchPanel(db: Db, query: ResearchQuery): Promise<ResearchExport> {
  const ctx = await resolveLongHorizonContext(db, query.toTurn);
  return runResearchExport(db, query, ctx);
}
