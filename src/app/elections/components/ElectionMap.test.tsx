/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ElectionDisplay } from "@/lib/db/types";
import { ElectionMap } from "./ElectionMap";
import enElections from "../../../../messages/en/elections.json";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enElections}>
      {ui}
    </NextIntlClientProvider>
  );
}

vi.mock("@/components/CountryMapPaths", async () => {
  const actual = await vi.importActual<typeof import("@/components/CountryMapPaths")>(
    "@/components/CountryMapPaths"
  );
  return {
    ...actual,
    CountryMapPaths: (props: {
      countryId: string;
      regionData: Record<string, { color: string }>;
      regionHref?: (id: string) => string | undefined;
    }) => (
      <div data-testid="mock-map" data-country={props.countryId}>
        {Object.keys(props.regionData)
          .sort()
          .map((id) => (
            <span key={id} data-testid={`region-${id}`} data-href={props.regionHref?.(id) ?? ""}>
              {props.regionData[id].color}
            </span>
          ))}
      </div>
    ),
  };
});

function election(over: Partial<ElectionDisplay> = {}): ElectionDisplay {
  return {
    id: "e1",
    state: "NE",
    electionType: "governor",
    status: "active",
    candidates: [],
    polling: {
      leaderId: "c1",
      leaderName: "Leader",
      leaderParty: "2",
      sharesPct: { c1: 60, c2: 40 },
      candidateNames: { c1: "Leader" },
      candidateParties: { c1: "2" },
      candidatePartyNames: { c1: "Republican Party" },
      candidatePartyColors: { c1: "#EF4444" },
      source: "general",
    },
    ...over,
  } as unknown as ElectionDisplay;
}

describe("ElectionMap", () => {
  const groups = [{ stateId: "NE", elections: [election()] }];

  it("passes the country through so non-US maps render", () => {
    render(<ElectionMap countryId="DE" electionsByState={groups} onRegionClick={vi.fn()} />);
    expect(screen.getByTestId("mock-map").getAttribute("data-country")).toBe("DE");
  });

  it("renders a legend derived from polling, not hardcoded US parties", () => {
    render(<ElectionMap countryId="US" electionsByState={groups} onRegionClick={vi.fn()} />);
    expect(screen.getByText("Republican Party")).toBeTruthy();
    expect(screen.queryByText("Democratic lead")).toBeNull();
  });

  it("forwards regionHref so regions can render as links", () => {
    render(
      <ElectionMap
        countryId="US"
        electionsByState={groups}
        onRegionClick={vi.fn()}
        regionHref={(id) => `/country/us/elections?state=${id}`}
      />
    );
    expect(screen.getByTestId("region-NE").getAttribute("data-href")).toBe(
      "/country/us/elections?state=NE"
    );
  });

  it("shows the no-polling entry only when a region lacks polling", () => {
    const { rerender } = render(
      <ElectionMap countryId="US" electionsByState={groups} onRegionClick={vi.fn()} />
    );
    expect(screen.queryByText("No polling data")).toBeNull();

    rerender(
      <NextIntlClientProvider locale="en" messages={enElections}>
        <ElectionMap
          countryId="US"
          electionsByState={[{ stateId: "IA", elections: [election({ polling: undefined })] }]}
          onRegionClick={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    expect(screen.getByText("No polling data")).toBeTruthy();
  });
});
