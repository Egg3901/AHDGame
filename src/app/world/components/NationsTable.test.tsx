/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { resolveCountryAvailability } from "@/lib/countryAvailability";
import type { NationWorldSnapshot } from "@/lib/world/nationWorldSnapshots";
import { NationsTable, PlannedNationsTable, type NationRow } from "./NationsTable";

const NAMES: Record<string, string> = {
  US: "United States",
  UK: "United Kingdom",
  SCO: "Scotland",
};

vi.mock("@/contexts/RegisteredCountriesContext", () => ({
  useActivePreset: () => "1953-default",
  useCountryDisplayName: () => (id: string) => NAMES[id] ?? id,
}));

const SNAPSHOT: NationWorldSnapshot = {
  executive: {
    name: "Ada Example",
    avatarUrl: null,
    borderKey: null,
    tintColor: null,
    isNpp: false,
    sequentialId: 7,
    nppSequentialId: null,
    isVacant: false,
  },
  legislatureParty: { partySequentialId: "1", partyName: "Example Party", partyColor: "#336699" },
};

const playable: NationRow = {
  id: "US",
  availability: resolveCountryAvailability("US", {
    enabledForPlayers: true,
    status: "active",
    economyPreview: false,
  }),
  snapshot: SNAPSHOT,
};

const econOnly: NationRow = {
  id: "UK",
  availability: resolveCountryAvailability("UK", {
    enabledForPlayers: false,
    status: "active",
    economyPreview: true,
  }),
};

const hidden: NationRow = {
  id: "SCO",
  availability: resolveCountryAvailability("SCO", {
    enabledForPlayers: false,
    status: "coming-soon",
    economyPreview: false,
    registered: false,
  }),
};

function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe("NationsTable", () => {
  it("states each nation's status as a plain word", () => {
    render(<NationsTable rows={[playable, econOnly]} />);
    expect(within(rowFor("United States")).getByText("Active")).toBeTruthy();
    expect(within(rowFor("United Kingdom")).getByText("Econ-only")).toBeTruthy();
  });

  it("links every open nation to its overview", () => {
    render(<NationsTable rows={[playable, econOnly]} />);
    expect(screen.getByRole("link", { name: "United States" }).getAttribute("href")).toBe(
      "/country/us"
    );
    expect(screen.getByRole("link", { name: "United Kingdom" })).toBeTruthy();
  });

  it("shows the leader and leading party, and Vacant when a nation has no snapshot", () => {
    render(<NationsTable rows={[playable, econOnly]} />);
    expect(within(rowFor("United States")).getAllByText("Ada Example").length).toBeGreaterThan(0);
    expect(within(rowFor("United States")).getAllByText("Example Party").length).toBeGreaterThan(0);
    expect(within(rowFor("United Kingdom")).getAllByText("Vacant").length).toBeGreaterThan(0);
  });
});

describe("PlannedNationsTable", () => {
  it("lists nations that are not open yet without linking them", () => {
    render(
      <PlannedNationsTable
        hidden={[hidden]}
        roadmap={[{ id: "ca", name: "Canada", region: "North America", featured: true }]}
      />
    );
    expect(within(rowFor("Scotland")).getByText("Under development")).toBeTruthy();
    expect(within(rowFor("Canada")).getByText("Beta access")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
