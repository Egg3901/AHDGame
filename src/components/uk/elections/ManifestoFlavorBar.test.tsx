/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { ManifestoFlavorBar } from "./ManifestoFlavorBar";
import type { CountryManifestos, ManifestoView } from "@/hooks/useCountryManifestos";

const CATALOG = [
  { id: "uk.nhs.universal", label: "A universal NHS", blurb: "b1", policyDomain: "health" },
  { id: "uk.tax.cutIncome", label: "Cut income tax", blurb: "b2", policyDomain: "economy" },
  { id: "uk.economy.soundMoney", label: "Sound money", blurb: "b3", policyDomain: "economy" },
  {
    id: "uk.education.secondaryForAll",
    label: "Schools for all",
    blurb: "b4",
    policyDomain: "education",
  },
];

function batch(
  overrides: Partial<CountryManifestos> = {},
  manifesto: ManifestoView | null = null
): CountryManifestos {
  return {
    catalog: CATALOG,
    pledgeCount: 3,
    isPartyLeader: true,
    party: { id: "1", name: "Labour" },
    manifestos: { e1: manifesto },
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = vi.fn();
});
afterEach(() => cleanup());

describe("ManifestoFlavorBar", () => {
  it("renders from props without fetching — the page asks once for every race", () => {
    render(<ManifestoFlavorBar countryCode="uk" electionId="e1" data={batch()} />);
    expect(screen.getByText("A universal NHS")).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("renders the catalog and lets a leader pick pledges", async () => {
    render(<ManifestoFlavorBar countryCode="uk" electionId="e1" data={batch()} />);

    expect(screen.getByText(/Labour/)).toBeTruthy();
    expect(screen.getByText("0 of 3 chosen")).toBeTruthy();

    fireEvent.click(screen.getByText("A universal NHS"));
    await waitFor(() => expect(screen.getByText("1 of 3 chosen")).toBeTruthy());
  });

  it("caps selection at the pledge count", async () => {
    render(<ManifestoFlavorBar countryCode="uk" electionId="e1" data={batch()} />);

    fireEvent.click(screen.getByText("A universal NHS"));
    fireEvent.click(screen.getByText("Cut income tax"));
    fireEvent.click(screen.getByText("Sound money"));
    await waitFor(() => expect(screen.getByText("3 of 3 chosen")).toBeTruthy());
    fireEvent.click(screen.getByText("Schools for all"));
    expect(screen.getByText("3 of 3 chosen")).toBeTruthy();
  });

  it("shows a read-only message to a non-leader", () => {
    render(
      <ManifestoFlavorBar
        countryCode="uk"
        electionId="e1"
        data={batch({ isPartyLeader: false, party: null })}
      />
    );
    expect(screen.getByText(/Only the party leader sets the manifesto/)).toBeTruthy();
  });

  it("renders a locked manifesto read-only", () => {
    render(
      <ManifestoFlavorBar
        countryCode="uk"
        electionId="e1"
        data={batch({}, { pledges: ["uk.nhs.universal"], locked: true, lockedAt: "2026-01-01" })}
      />
    );
    expect(screen.getByText(/Manifesto locked/)).toBeTruthy();
    expect(screen.queryByText("Save draft")).toBeNull();
  });

  it("seeds the selection from this election's manifesto, not another's", () => {
    const data = batch();
    data.manifestos = {
      e1: { pledges: ["uk.nhs.universal"], locked: false },
      e2: { pledges: ["uk.tax.cutIncome", "uk.economy.soundMoney"], locked: false },
    };
    render(<ManifestoFlavorBar countryCode="uk" electionId="e2" data={data} />);
    expect(screen.getByText("2 of 3 chosen")).toBeTruthy();
  });

  it("renders nothing until the batch resolves", () => {
    const { container } = render(
      <ManifestoFlavorBar countryCode="uk" electionId="e1" data={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("still saves through this election's own endpoint", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    render(<ManifestoFlavorBar countryCode="uk" electionId="e1" data={batch()} />);

    fireEvent.click(screen.getByText("A universal NHS"));
    fireEvent.click(screen.getByText("Save draft"));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/country/uk/elections/e1/manifesto");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ pledges: ["uk.nhs.universal"], action: "save" });
  });
});
