/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { primaryMetricById } from "@/lib/resetMetrics/catalog";
import { ResetMetricsPage } from "./ResetMetricsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function metric(id: string, value: number) {
  const definition = primaryMetricById(id)!;
  return {
    ...definition,
    observation: {
      metricId: id,
      path: definition.path,
      value,
      status: "proxy",
      source: "1991 game-calibrated fixture",
      owner: definition.owner,
      note: "Opening estimate, not a historical observation.",
    },
    conditionScore: 62,
    temporaryActionEffect: null,
    legislativeEffect: null,
    standingLaws:
      id === "02"
        ? [
            {
              familyId: "L01",
              familyTitle: "Household relief and work credits",
              currentLawTitle: "1991 household relief settlement",
              policyLevelTitle: "Work and Relief Compact",
              state: "equilibrium",
              favorableNormalizedPoints: null,
            },
          ]
        : [],
  };
}

describe("v2 metrics page", () => {
  it("shows the world-bound national board in the established registry layout", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => ({
      ok: true,
      json: async () =>
        String(input).includes("/02")
          ? {
              history: [{ turn: 1, value: 25_000 }],
              nationalValue: 25_000,
              regions: [{ regionId: "PA", name: "Pennsylvania", value: 24_500 }],
            }
          : {
              version: "v2",
              countryId: "US",
              scope: "national",
              regionId: null,
              asOfTurn: 1,
              governanceStyle: {
                name: "Governance Style",
                variant: "liberal-democracy",
                leftRight: { value: 50, label: "Centre" },
                democraticHealth: { value: 72, label: "Functioning democracy" },
                competition: {
                  dominantPartyId: "dem",
                  dominantSeatShare: 58,
                  chambersMeasured: 2,
                  executivePartyId: null,
                  executiveSystem: "presidential",
                  executiveAlignedWithLegislature: null,
                  uninterruptedControlTurns: 0,
                  consecutiveExecutiveTerms: 0,
                  seatMarginPenalty: 1.8,
                  legislativeContinuityPenalty: 0,
                  executiveContinuityPenalty: 0,
                  courtDominantBloc: null,
                  courtDominantShare: 0,
                  courtSeated: 0,
                  courtLiberalSeats: 0,
                  courtSwingSeats: 0,
                  courtConservativeSeats: 0,
                  courtUnclassifiedSeats: 0,
                  courtPenalty: 0,
                  penalty: 1.8,
                },
              },
              metrics: [metric("02", 25_000), metric("07", 3)],
            },
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ResetMetricsPage country="US" />);
    expect(await screen.findByRole("heading", { name: "United States" })).toBeTruthy();
    expect(screen.getByTestId("stat-masthead")).toBeTruthy();
    expect(screen.getByText("Primary observations")).toBeTruthy();
    expect(screen.getByText("National spirit")).toBeTruthy();
    expect(screen.getByText("Political direction")).toBeTruthy();
    expect(screen.getByText("Democratic health")).toBeTruthy();
    expect(screen.getByText("Presidential government")).toBeTruthy();
    expect(screen.queryByText("Parliamentary government")).toBeNull();
    expect(screen.queryByText("Version 2")).toBeNull();
    expect(screen.getByText("Condition")).toBeTruthy();
    expect(screen.getAllByText("62")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Open Economic" }));
    expect(screen.getByText("$25,000")).toBeTruthy();
    expect(screen.getByText("A balanced range is preferred")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Real household purchasing power" }));
    expect(await screen.findByText("Historical series")).toBeTruthy();
    expect(screen.getByText("Regional breakdown")).toBeTruthy();
    expect(screen.getByText("How this measure works")).toBeTruthy();
    expect(screen.getByText("Household finances")).toBeTruthy();
    expect(screen.getByText("Every turn")).toBeTruthy();
    expect(
      screen.getByText("Recalculated from the underlying national and regional records.")
    ).toBeTruthy();
    expect(screen.getByText("Provisional estimate")).toBeTruthy();
    expect(screen.queryByText("$500 worse than national")).toBeNull();
    expect(screen.queryByText("recompute")).toBeNull();
    expect(screen.queryByText("Primary metric 02")).toBeNull();
    expect(screen.getByText("Policy environment")).toBeTruthy();
    expect(screen.getByText("1991 household relief settlement")).toBeTruthy();
    expect(screen.getByText("At equilibrium")).toBeTruthy();
    expect(screen.getByText("Pennsylvania")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["US", 25_000, "$25,000"],
    ["UK", 18_500, "£18,500"],
    ["JP", 2_043_899, "¥2,043,899"],
  ] as const)("formats purchasing power in %s local currency", async (country, value, label) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          version: "v2",
          countryId: country,
          scope: "national",
          regionId: null,
          asOfTurn: 1,
          governanceStyle: null,
          metrics: [metric("02", value)],
        }),
      }))
    );

    render(<ResetMetricsPage country={country} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Economic" }));
    expect(screen.getByText(label)).toBeTruthy();
  });

  it("compares the supported national v2 registries in common condition scores", async () => {
    const values = { US: 5, UK: 7, JP: 2.2, IE: 6.8 } as const;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/world/flags") {
        return {
          ok: true,
          json: async () => ({
            resetV2Countries: ["US", "UK", "JP", "IE"],
            resetSystemVersions: {
              metrics: "v2",
              legislation: "v2",
              cabinet: "v2",
              demographics: "v1",
            },
          }),
        };
      }
      const country = (url.match(/country\/(US|UK|JP|IE)\/reset-metrics/)?.[1] ??
        "US") as keyof typeof values;
      return {
        ok: true,
        json: async () => ({
          version: "v2",
          countryId: country,
          scope: "national",
          regionId: null,
          asOfTurn: 1,
          governanceStyle: null,
          metrics: [metric("01", values[country])],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StrictMode>
        <ResetMetricsPage country="US" />
      </StrictMode>
    );
    fireEvent.click(await screen.findByRole("button", { name: /Compare/ }));

    expect(await screen.findByText("Compare national registries")).toBeTruthy();
    expect((await screen.findAllByText("United Kingdom")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Japan")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Ireland")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Show Economic metrics" }));
    expect(await screen.findByText("7% of labor force")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/country/UK/reset-metrics",
      expect.objectContaining({ cache: "no-store" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/country/JP/reset-metrics",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("clears a failed drilldown when the player opens another metric", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/02")) return { ok: false, json: async () => ({}) };
      if (url.endsWith("/07")) {
        return {
          ok: true,
          json: async () => ({
            history: [{ turn: 1, value: 3 }],
            nationalValue: 3,
            regions: [],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          version: "v2",
          countryId: "US",
          scope: "national",
          regionId: null,
          asOfTurn: 1,
          governanceStyle: null,
          metrics: [metric("02", 25_000), metric("07", 3)],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ResetMetricsPage country="US" />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Economic" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Real household purchasing power" }));
    expect(await screen.findByText("Metric detail could not be loaded")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Back to metrics/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open Price stability" }));

    expect(await screen.findByText("Historical series")).toBeTruthy();
    expect(screen.queryByText("Metric detail could not be loaded")).toBeNull();
  });

  it("shows an error instead of silently falling back to v1", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 }))
    );
    render(<ResetMetricsPage country="UK" />);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("temporarily unavailable")
    );
    expect(screen.queryByText("Metric categories")).toBeNull();
  });
});
