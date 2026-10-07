// @vitest-environment node
import Module, { createRequire } from "node:module";
import { dirname } from "node:path";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/mongodb";
import { findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/macroMetrics/merge", () => ({ findMergedRegionMetricsMany: vi.fn() }));
vi.mock("@/lib/politicalLegislation/politicalApprovalProvider", () => ({
  isPoliticalApprovalCountry: () => true,
  loadPoliticalApprovalBases: async () => ({ byRegion: new Map(), national: 50 }),
}));
vi.mock("@/lib/api/stateTickRates", () => ({
  computeAllNationalMetricTickRates: async () => ({}),
}));
vi.mock("@/lib/country/nationalApproval", () => ({
  loadNationalApproval: async () => ({
    governmentApproval: 50,
    governmentApprovalBase: 50,
    modifiers: [],
  }),
}));

type FlightServer = {
  registerClientReference: <T>(proxy: T, id: string, exportName: string) => T;
  renderToPipeableStream: (
    model: unknown,
    webpackMap: unknown,
    options: { onError: (error: unknown) => void }
  ) => { pipe: (destination: NodeJS.WritableStream) => void };
};

// Load the Flight server Next renders Server Components with, bound to the
// react-server builds of React it is compiled against.
function loadFlightServer(): FlightServer {
  const require = createRequire(import.meta.url);
  const compiled = dirname(dirname(require.resolve("next/dist/compiled/react/package.json")));
  const react = `${compiled}/react/cjs/react.react-server.production.js`;
  const reactDom = `${compiled}/react-dom/cjs/react-dom.react-server.production.js`;
  const swaps: Record<string, string> = {
    react,
    "react-dom": reactDom,
    "next/dist/compiled/react": react,
    "next/dist/compiled/react-dom": reactDom,
  };
  const loader = Module as unknown as {
    _resolveFilename: (request: string, ...rest: unknown[]) => string;
  };
  const original = loader._resolveFilename;
  loader._resolveFilename = (request, ...rest) =>
    swaps[request] ?? original.call(Module, request, ...rest);
  try {
    return require(
      `${compiled}/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js`
    ) as FlightServer;
  } finally {
    loader._resolveFilename = original;
  }
}

const flight = loadFlightServer();
const CLIENT_ID = "approval-client";

vi.mock("./ApprovalClient", async () => {
  return {
    default: flight.registerClientReference(
      () => {
        throw new Error("client component rendered on the server");
      },
      CLIENT_ID,
      "default"
    ),
  };
});

async function renderFlight(model: unknown): Promise<{ errors: unknown[]; payload: string }> {
  const errors: unknown[] = [];
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve) => sink.on("end", () => resolve()));
  flight
    .renderToPipeableStream(
      model,
      { [`${CLIENT_ID}#default`]: { id: CLIENT_ID, chunks: [], name: "default" } },
      {
        onError: (error) => {
          errors.push(error);
        },
      }
    )
    .pipe(sink);
  await done;
  return { errors, payload: Buffer.concat(chunks).toString("utf8") };
}

describe("approval page server-to-client boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue({
      collection: (name: string) => ({
        find: () => ({
          toArray: async () =>
            name === "states"
              ? [
                  { _id: "TX", countryId: "US", name: "Texas", population: 3, gdp: 0 },
                  { _id: "NY", countryId: "US", name: "New York", population: 1, gdp: 0 },
                ]
              : [],
        }),
        findOne: async () => null,
      }),
    } as never);
    const texas = JSON.parse(
      '{"_id":"TX","countryId":"US","economic":{"unemploymentRate":{"value":4,"trend":2},"__proto__":{"value":999},"constructor":{"value":999},"prototype":{"value":999}}}'
    );
    vi.mocked(findMergedRegionMetricsMany).mockResolvedValue([
      texas,
      { _id: "NY", countryId: "US", economic: { unemploymentRate: { value: 8, trend: 6 } } },
    ] as never);
  });

  it("passes the loaded national metrics to ApprovalClient through Flight", async () => {
    const { default: ApprovalPage } = await import("./page");
    const element = await ApprovalPage({ params: Promise.resolve({ code: "us" }) });
    const props = (element as { props: { initialMetrics: unknown } }).props;
    expect(props.initialMetrics).not.toBeNull();

    const { errors, payload } = await renderFlight(element);
    expect(errors.map((error) => String(error))).toEqual([]);

    const row = payload.split("\n").find((line) => line.includes('"initialMetrics"'));
    expect(row).toBeDefined();
    const model = JSON.parse(row!.slice(row!.indexOf(":") + 1)) as [
      string,
      string,
      unknown,
      { initialMetrics: Record<string, Record<string, Record<string, unknown>>> },
    ];
    const metrics = model[3].initialMetrics;
    expect(metrics.categories.economic.unemploymentRate).toMatchObject({
      average: 6,
      populationWeightedAverage: 5,
      trend: 3,
    });
    expect(Object.keys(metrics.categories.economic)).toEqual(["unemploymentRate"]);
    expect(
      (metrics.stateRankings.economic.unemploymentRate as { stateId: string }[]).map(
        (r) => r.stateId
      )
    ).toEqual(["TX", "NY"]);
    // Sparse categories survive as empty dictionaries.
    expect(metrics.categories.education).toEqual({});
    expect(metrics.stateRankings.education).toEqual({});
    expect(Object.hasOwn(Object.prototype, "average")).toBe(false);
    expect(Object.hasOwn(Object.prototype, "value")).toBe(false);
  }, 60_000);
});
