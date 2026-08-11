/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { EconomicModelCard } from "./EconomicModelCard";
import type { EconomicModelView } from "@/lib/economicModels/present";

const view: EconomicModelView = {
  current: "militaryIndustrial",
  currentName: "Military-Industrial Complex",
  intensity: 62,
  band: "Established",
  drivers: { sector: 0.7, spend: 0.5, law: 0 },
  signatureSectors: ["Defense", "Manufacturing", "Technology"],
  challenger: {
    modelId: "techInnovation",
    name: "Tech-Innovation Economy",
    turnsLeading: 20,
    switchTurns: 48,
  },
};

function mockFetch(impl: () => Promise<Partial<Response>>) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(impl));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EconomicModelCard", () => {
  it("renders the model, band, intensity, signature sectors, and challenger", async () => {
    mockFetch(async () => ({ ok: true, json: async () => view }));
    render(<EconomicModelCard countryId="US" />);

    await waitFor(() => expect(screen.getByText("Military-Industrial Complex")).toBeTruthy());
    expect(screen.getByText("Established")).toBeTruthy();
    expect(screen.getByText("62/100")).toBeTruthy();
    expect(screen.getByText("Defense")).toBeTruthy();
    expect(screen.getByText("Tech-Innovation Economy")).toBeTruthy();
    expect(screen.getByText(/20\/48 turns/)).toBeTruthy();
  });

  it("renders nothing when no model is classified yet (404)", async () => {
    mockFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    const { container } = render(<EconomicModelCard countryId="US" />);
    await waitFor(() => expect(container.querySelector("div")).toBeNull());
  });

  it("queries the region endpoint when a regionId is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => view });
    vi.stubGlobal("fetch", fetchMock);
    render(<EconomicModelCard countryId="US" regionId="us1" scopeLabel="California" />);
    await waitFor(() => expect(screen.getByText("California Economic Model")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/country/US/economic-model?regionId=us1");
  });
});
