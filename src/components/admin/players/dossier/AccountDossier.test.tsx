/**
 * @vitest-environment happy-dom
 */
// Dossier cockpit tests — pure layout/format maths in `dossierTypes.ts` plus
// light render coverage of the MoneyFlowGraph (stubbed fetch) and the
// LinkedAccountsPanel pivot. Mirrors the style of
// `src/components/admin/alts/AltDetection.test.tsx`.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import {
  capGraphForDisplay,
  computeHops,
  formatCompactAmount,
  isSyntheticNodeId,
  moneyEdgeKey,
  nodeFlowTotals,
  strongestAltConfidence,
  accountLabel,
  type MoneyGraphEdge,
  type MoneyGraphNode,
  type MoneyGraphResponse,
} from "./dossierTypes";
import { MoneyFlowGraph } from "./MoneyFlowGraph";
import { LinkedAccountsPanel } from "./LinkedAccountsPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("dossierTypes helpers", () => {
  it("formats compact money with symbol, sign, and magnitude suffix", () => {
    expect(formatCompactAmount(1_234_567, "USD")).toBe("$1.2M");
    expect(formatCompactAmount(-45_300, "USD")).toBe("-$45.3K");
    expect(formatCompactAmount(730, "USD", true)).toBe("+$730");
    expect(formatCompactAmount(2_000_000_000, "USD")).toBe("$2B");
  });

  it("labels accounts by name, falling back to a short id", () => {
    expect(accountLabel("EggPlant", "abc123def456")).toBe("EggPlant");
    expect(accountLabel(null, "abc123def456")).toBe("acct·def456");
  });

  it("recognizes synthetic (gov/system) node ids", () => {
    expect(isSyntheticNodeId("gov:US")).toBe(true);
    expect(isSyntheticNodeId("sys:System")).toBe(true);
    expect(isSyntheticNodeId("64b7f0aa1c9d440000a1b2c3")).toBe(false);
  });

  it("computes BFS hop distance from the center in either edge direction", () => {
    const edges: MoneyGraphEdge[] = [
      { from: "A", to: "B", totalAmount: 100, txCount: 1, currencyCode: "USD" },
      { from: "C", to: "B", totalAmount: 50, txCount: 1, currencyCode: "USD" },
      { from: "C", to: "D", totalAmount: 10, txCount: 1, currencyCode: "USD" },
    ];
    const hops = computeHops(edges, new Set(["A"]));
    expect(hops.get("A")).toBe(0);
    expect(hops.get("B")).toBe(1); // outbound
    expect(hops.get("C")).toBe(2); // reached against edge direction
    expect(hops.get("D")).toBe(3);
    expect(hops.get("Z")).toBeUndefined();
  });

  it("caps the graph to the highest-flow nodes while always keeping centers", () => {
    const nodes: MoneyGraphNode[] = ["A", "B", "C", "D"].map((id) => ({
      id,
      name: id,
      banned: false,
    }));
    const edges: MoneyGraphEdge[] = [
      { from: "A", to: "B", totalAmount: 1000, txCount: 1, currencyCode: "USD" },
      { from: "A", to: "C", totalAmount: 5, txCount: 1, currencyCode: "USD" },
      { from: "A", to: "D", totalAmount: 500, txCount: 1, currencyCode: "USD" },
    ];
    const capped = capGraphForDisplay(nodes, edges, new Set(["A"]), 3);
    expect(capped.keep.has("A")).toBe(true); // center survives regardless of flow
    expect(capped.keep.has("B")).toBe(true); // heaviest counterparty
    expect(capped.keep.has("D")).toBe(true);
    expect(capped.keep.has("C")).toBe(false); // low-flow node dropped
    expect(capped.hiddenCount).toBe(1);
    // Edges to dropped nodes are pruned.
    expect(capped.edges.every((e) => e.to !== "C")).toBe(true);
  });

  it("sums absolute flow per node for ranking", () => {
    const edges: MoneyGraphEdge[] = [
      { from: "A", to: "B", totalAmount: 100, txCount: 2, currencyCode: "USD" },
      { from: "B", to: "A", totalAmount: 40, txCount: 1, currencyCode: "USD" },
    ];
    const totals = nodeFlowTotals(edges);
    expect(totals.get("A")).toBe(140);
    expect(totals.get("B")).toBe(140);
  });

  it("derives header risk from the strongest link or cluster", () => {
    expect(
      strongestAltConfidence({
        links: [
          {
            otherUserId: "x",
            otherUsername: null,
            confidence: 0.62,
            signalCount: 2,
            topSignal: null,
          },
        ],
        clusters: [
          {
            id: "c1",
            confidence: 0.87,
            size: 3,
            status: "open",
            role: "burner",
            topEvidence: [],
          },
        ],
      })
    ).toBe(0.87);
    expect(strongestAltConfidence({ links: [], clusters: [] })).toBe(0);
  });

  it("keys directed edges per currency so A→B and B→A stay distinct", () => {
    const ab: MoneyGraphEdge = {
      from: "A",
      to: "B",
      totalAmount: 1,
      txCount: 1,
      currencyCode: "USD",
    };
    const ba: MoneyGraphEdge = {
      from: "B",
      to: "A",
      totalAmount: 1,
      txCount: 1,
      currencyCode: "USD",
    };
    expect(moneyEdgeKey(ab)).not.toBe(moneyEdgeKey(ba));
  });
});

describe("MoneyFlowGraph", () => {
  const graph: MoneyGraphResponse = {
    nodes: [
      { id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Center", banned: false },
      { id: "bbbbbbbbbbbbbbbbbbbbbbbb", name: "Mule", banned: true },
      { id: "gov:US", name: "US Government", banned: false },
    ],
    edges: [
      {
        from: "aaaaaaaaaaaaaaaaaaaaaaaa",
        to: "bbbbbbbbbbbbbbbbbbbbbbbb",
        totalAmount: 250_000,
        txCount: 12,
        currencyCode: "USD",
      },
      {
        from: "gov:US",
        to: "aaaaaaaaaaaaaaaaaaaaaaaa",
        totalAmount: 4_000,
        txCount: 3,
        currencyCode: "USD",
      },
    ],
    truncated: false,
    depth: 1,
    turnMin: 900,
    currentTurn: 1068,
  };

  it("fetches the money graph and renders nodes, edges, and the summary line", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => graph,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <MoneyFlowGraph userId="cccccccccccccccccccccccc" centerIds={["aaaaaaaaaaaaaaaaaaaaaaaa"]} />
    );

    await waitFor(() => {
      expect(screen.getByRole("img", { name: /money-flow graph/i })).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/players/money-graph?userId=cccccccccccccccccccccccc&depth=1"
    );
    // 3 accounts / 2 flows in the summary line.
    expect(screen.getByText(/3 accounts · 2 flows/)).toBeTruthy();
    // Two visible edge paths (each edge = hit-target + visible path).
    const svg = container.querySelector("svg")!;
    expect(svg.querySelectorAll("path[marker-end]").length).toBe(2);
    // Synthetic node renders as a square, banned node gets the dashed halo.
    expect(svg.querySelectorAll("rect[rx]").length).toBe(1);
    expect(svg.querySelectorAll("circle[stroke-dasharray='3 3']").length).toBe(1);
  });

  it("shows the error state with a retry button when the API fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) }))
    );
    render(<MoneyFlowGraph userId="cccccccccccccccccccccccc" />);
    await waitFor(() => {
      expect(screen.getByText("Forbidden")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });
});

describe("LinkedAccountsPanel", () => {
  it("renders linked accounts and pivots on click", () => {
    const onPivot = vi.fn();
    render(
      <LinkedAccountsPanel
        links={[
          {
            otherUserId: "dddddddddddddddddddddddd",
            otherUsername: "SockPuppet",
            confidence: 0.73,
            signalCount: 3,
            topSignal: "deviceKey_exact",
          },
        ]}
        clusters={[]}
        onPivot={onPivot}
      />
    );
    expect(screen.getByText("SockPuppet")).toBeTruthy();
    // The alt-signal vocabulary matches the Alts screens.
    expect(screen.getByText(/Same device key/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /SockPuppet/ }));
    expect(onPivot).toHaveBeenCalledWith("dddddddddddddddddddddddd");
  });

  it("shows the empty state when nothing links here", () => {
    render(<LinkedAccountsPanel links={[]} clusters={[]} onPivot={() => {}} />);
    expect(screen.getByText(/No alt-detection links/)).toBeTruthy();
  });
});
