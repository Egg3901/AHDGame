import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { LongHorizonContext } from "@/lib/telemetry/longHorizon/telemetry";

vi.mock("./rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rules")>();
  return {
    ...actual,
    // Annual rows need full country-turn inputs; paging is what is under test.
    buildAnnualFiscalPanel: (rows: Array<{ country: string; turn: number }>) =>
      rows.map((r) => ({ country: r.country, firstTurn: r.turn, fiscalYear: 1 })),
  };
});

import { runResearchExport, type ResearchExport } from "./export";
import {
  RESEARCH_MAX_RESPONSE_BYTES,
  RESEARCH_TELEMETRY_RETENTION_TURNS,
  checkResearchRetention,
  parseResearchQuery,
  researchRetentionLabel,
  takeResearchPage,
  type ResearchQuery,
} from "./rules";

type Doc = Record<string, unknown>;

/** Minimal filter evaluator for the shapes the export builds. */
function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or") return (cond as Doc[]).some((f) => matches(doc, f));
    const v = doc[key] as never;
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      return Object.entries(cond as Doc).every(([op, arg]) => {
        const a = arg as never;
        if (op === "$gte") return v >= a;
        if (op === "$gt") return v > a;
        if (op === "$lte") return v <= a;
        if (op === "$lt") return v < a;
        if (op === "$in") return (arg as unknown[]).includes(v);
        return true;
      });
    }
    return v === cond;
  });
}

function fakeDb(data: Record<string, Doc[]>): Db {
  return {
    collection(name: string) {
      return {
        find(filter: Doc = {}) {
          let sort: Doc = {};
          let max = Infinity;
          const chain = {
            sort(s: Doc) {
              sort = s;
              return chain;
            },
            limit(n: number) {
              max = n;
              return chain;
            },
            async toArray() {
              const keys = Object.keys(sort);
              return (data[name] ?? [])
                .filter((d) => matches(d, filter))
                .sort((a, b) => {
                  for (const k of keys) {
                    const av = a[k] as never;
                    const bv = b[k] as never;
                    if (av < bv) return -1;
                    if (av > bv) return 1;
                  }
                  return 0;
                })
                .slice(0, max);
            },
          };
          return chain;
        },
      };
    },
  } as unknown as Db;
}

const ctx = {
  worldId: "w",
  sourceClass: "sandbox",
  runId: "r",
  seed: "s",
  codeVersion: "c",
  preset: "1991",
  startingYear: 1991,
  year: 1992,
  foundingTurn: false,
  clock: {},
  governingByCountry: new Map(),
} as unknown as LongHorizonContext;

const at = new Date("2026-10-02T00:00:00Z");

function query(params: Record<string, string>): ResearchQuery {
  const parsed = parseResearchQuery(params, 100);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.query;
}

/** Page through a panel with the given limit; returns every row in order. */
async function drain(db: Db, params: Record<string, string>, limit: number) {
  const rows: Doc[] = [];
  let after: string | null = null;
  let pages = 0;
  do {
    const out: ResearchExport = await runResearchExport(
      db,
      query({ ...params, limit: String(limit), ...(after ? { after } : {}) }),
      ctx
    );
    expect(out.rows.length).toBeLessThanOrEqual(limit);
    rows.push(...(out.rows as Doc[]));
    after = out.nextCursor;
    pages += 1;
    expect(pages).toBeLessThan(200);
  } while (after);
  return rows;
}

const sec = (id: string, assetClass: "equity" | "bond") => ({
  securityId: id,
  assetClass,
  executions: { count: 0 },
  book: null,
});

const securityDocs = [5, 6, 7].map((turn) => ({
  worldId: "w",
  turn,
  year: 1992,
  observedAt: at,
  securities: [sec("b1", "bond"), sec("e2", "equity"), sec("e1", "equity")],
  pools: [{ pool: "equity" }, { pool: "bond" }],
}));

const sourcingDoc = (turn: number, commodity: string, countries: string[]) => ({
  turn,
  commodity,
  createdAt: at,
  demandUnitsIntent: 10,
  intraStateUnits: 0,
  interStateUnits: 0,
  importUnits: 0,
  unmetUnits: 0,
  countryPairs: [],
  destinations: countries.map((country) => ({ country })),
});

const tradeDocs = [
  sourcingDoc(10, "oil", ["US", "UK", "FR"]),
  sourcingDoc(10, "wheat", ["US", "UK"]),
  sourcingDoc(11, "oil", ["US", "UK", "FR"]),
];

describe("export row limit and cursor", () => {
  const cases: Array<{ panel: string; db: () => Db; total: number }> = [
    {
      panel: "country-turn",
      db: () =>
        fakeDb({
          countryTurnTelemetry: [3, 4].flatMap((turn) =>
            ["AA", "BB", "CC"].map((country) => ({ worldId: "w", turn, country }))
          ),
        }),
      total: 6,
    },
    {
      panel: "annual-fiscal",
      db: () =>
        fakeDb({
          countryTurnTelemetry: [3, 4].flatMap((turn) =>
            ["AA", "BB", "CC"].map((country) => ({ worldId: "w", turn, country }))
          ),
        }),
      total: 6,
    },
    { panel: "securities", db: () => fakeDb({ securityTelemetry: securityDocs }), total: 15 },
    { panel: "trade", db: () => fakeDb({ commoditySourcingFlows: tradeDocs }), total: 6 + 2 + 6 },
  ];

  for (const c of cases) {
    it(`${c.panel}: limit=1 returns exactly one row and a cursor`, async () => {
      const out = await runResearchExport(
        c.db(),
        query({ panel: c.panel, limit: "1", fromTurn: "1", toTurn: "100" }),
        ctx
      );
      expect(out.rows).toHaveLength(1);
      expect(out.nextCursor).not.toBeNull();
    });

    for (const limit of [1, 2, 4]) {
      it(`${c.panel}: limit=${limit} pages every row exactly once, in order`, async () => {
        const db = c.db();
        const whole = await drain(db, { panel: c.panel, fromTurn: "1", toTurn: "100" }, 2000);
        expect(whole).toHaveLength(c.total);
        const paged = await drain(db, { panel: c.panel, fromTurn: "1", toTurn: "100" }, limit);
        expect(paged).toEqual(whole);
      });
    }
  }

  it("securities rows are per security then pool, ordered inside a turn", async () => {
    const rows = await drain(
      fakeDb({ securityTelemetry: securityDocs }),
      { panel: "securities", fromTurn: "1", toTurn: "100" },
      2000
    );
    const first = rows.slice(0, 5).map((r) => r.kind + ":" + (r.securityId ?? r.pool));
    expect(first).toEqual([
      "security:b1",
      "security:e1",
      "security:e2",
      "pool:bond",
      "pool:equity",
    ]);
    expect(rows.map((r) => r.turn)).toEqual([5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7]);
  });

  it("trade cursor resumes inside a multi-row document", async () => {
    const db = fakeDb({ commoditySourcingFlows: tradeDocs });
    const first = await runResearchExport(
      db,
      query({ panel: "trade", limit: "4", fromTurn: "1", toTurn: "100" }),
      ctx
    );
    expect(first.rows).toHaveLength(4);
    expect(first.nextCursor?.startsWith("10:oil|")).toBe(true);
  });

  it("enforces the byte ceiling by cutting the page and issuing a cursor", () => {
    const row = { blob: "x".repeat(1000) };
    const rows = Array.from({ length: 10 }, () => row);
    const page = takeResearchPage(rows, 10, 3500);
    expect(page.rows.length).toBeLessThan(10);
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.more).toBe(true);
    // One oversized row still makes progress.
    expect(takeResearchPage([{ blob: "x".repeat(9000) }], 5, 100).rows).toHaveLength(1);
    expect(RESEARCH_MAX_RESPONSE_BYTES).toBeLessThan(16 * 1024 * 1024);
  });

  it("applies the byte ceiling inside an export page", async () => {
    const big = Array.from({ length: 40 }, (_, i) => ({
      ...sec(`e${String(i).padStart(2, "0")}`, "equity"),
      pad: "x".repeat(400_000),
    }));
    const db = fakeDb({
      securityTelemetry: [
        { worldId: "w", turn: 5, year: 1, observedAt: at, securities: big, pools: [] },
      ],
    });
    const out = await runResearchExport(
      db,
      query({ panel: "securities", limit: "2000", fromTurn: "1", toTurn: "100" }),
      ctx
    );
    expect(out.rows.length).toBeLessThan(40);
    expect(out.nextCursor).not.toBeNull();
    const rest = await drain(db, { panel: "securities", fromTurn: "1", toTurn: "100" }, 2000);
    expect(rest).toHaveLength(40);
  });
});

describe("research retention boundary", () => {
  const latest = 2000;
  const floor = latest - RESEARCH_TELEMETRY_RETENTION_TURNS;

  it("accepts a window inside the live retention", () => {
    const q = query({
      panel: "country-turn",
      fromTurn: String(floor),
      toTurn: String(floor + 100),
    });
    expect(checkResearchRetention(q, latest, 48)).toEqual({ ok: true });
  });

  it("rejects a window crossing the boundary and names it", () => {
    const q = { panel: "securities" as const, fromTurn: floor - 1 };
    const out = checkResearchRetention(q, latest, 48);
    expect(out).toMatchObject({
      ok: false,
      availableFromTurn: floor,
      retentionTurns: RESEARCH_TELEMETRY_RETENTION_TURNS,
    });
  });

  it("uses the shorter sourcing ledger window for trade", () => {
    expect(
      checkResearchRetention({ panel: "trade", fromTurn: latest - 49 }, latest, 48)
    ).toMatchObject({ ok: false, availableFromTurn: latest - 48 });
    expect(checkResearchRetention({ panel: "trade", fromTurn: latest - 48 }, latest, 48)).toEqual({
      ok: true,
    });
  });

  it("never rejects in a young world", () => {
    expect(checkResearchRetention({ panel: "country-turn", fromTurn: 0 }, 100, 48)).toEqual({
      ok: true,
    });
  });

  it("labels retention from the policy, not the life of the world", () => {
    const label = researchRetentionLabel("country-turn", 48);
    expect(label).toContain(String(RESEARCH_TELEMETRY_RETENTION_TURNS));
    expect(label).not.toContain("life of the world");
    expect(researchRetentionLabel("trade", 48)).toContain("48");
  });
});
