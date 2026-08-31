/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { ManifestoFlavorBar } from "./ManifestoFlavorBar";

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

function stubGet(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("ManifestoFlavorBar", () => {
  it("renders the catalog and lets a leader pick pledges", async () => {
    stubGet({
      catalog: CATALOG,
      pledgeCount: 3,
      isPartyLeader: true,
      party: { id: "1", name: "Labour" },
      manifesto: null,
    });
    render(<ManifestoFlavorBar countryCode="uk" electionId="e1" />);

    await waitFor(() => expect(screen.getByText("A universal NHS")).toBeTruthy());
    expect(screen.getByText(/Labour/)).toBeTruthy();
    expect(screen.getByText("0 of 3 chosen")).toBeTruthy();

    fireEvent.click(screen.getByText("A universal NHS"));
    await waitFor(() => expect(screen.getByText("1 of 3 chosen")).toBeTruthy());
  });

  it("caps selection at the pledge count", async () => {
    stubGet({
      catalog: CATALOG,
      pledgeCount: 3,
      isPartyLeader: true,
      party: { id: "1", name: "Labour" },
      manifesto: null,
    });
    render(<ManifestoFlavorBar countryCode="uk" electionId="e1" />);
    await waitFor(() => screen.getByText("A universal NHS"));

    fireEvent.click(screen.getByText("A universal NHS"));
    fireEvent.click(screen.getByText("Cut income tax"));
    fireEvent.click(screen.getByText("Sound money"));
    await waitFor(() => expect(screen.getByText("3 of 3 chosen")).toBeTruthy());
    // 4th should be disabled (still 3/3)
    fireEvent.click(screen.getByText("Schools for all"));
    expect(screen.getByText("3 of 3 chosen")).toBeTruthy();
  });

  it("shows a read-only message to a non-leader", async () => {
    stubGet({
      catalog: CATALOG,
      pledgeCount: 3,
      isPartyLeader: false,
      party: null,
      manifesto: null,
    });
    render(<ManifestoFlavorBar countryCode="uk" electionId="e1" />);
    await waitFor(() =>
      expect(screen.getByText(/Only the party leader sets the manifesto/)).toBeTruthy()
    );
  });

  it("renders a locked manifesto read-only", async () => {
    stubGet({
      catalog: CATALOG,
      pledgeCount: 3,
      isPartyLeader: true,
      party: { id: "1", name: "Labour" },
      manifesto: { pledges: ["uk.nhs.universal"], locked: true, lockedAt: "2026-01-01" },
    });
    render(<ManifestoFlavorBar countryCode="uk" electionId="e1" />);
    await waitFor(() => expect(screen.getByText(/Manifesto locked/)).toBeTruthy());
    // No Save/Lock buttons when locked
    expect(screen.queryByText("Save draft")).toBeNull();
  });

  it("renders nothing until data loads", () => {
    stubGet(new Promise(() => {})); // never resolves
    const { container } = render(<ManifestoFlavorBar countryCode="uk" electionId="e1" />);
    expect(container.firstChild).toBeNull();
  });
});
