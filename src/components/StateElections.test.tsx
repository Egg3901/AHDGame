/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StateElections } from "./StateElections";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

function json(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch() {
  global.fetch = vi.fn().mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.includes("/api/elections")) return Promise.resolve(json({ elections: [] }));
    if (u.includes("/api/character/me")) return Promise.resolve(json({ character: null }));
    if (u.includes("/api/game/turn/status"))
      return Promise.resolve(json({ isActive: true, currentTurn: 774 }));
    if (u.includes("parties")) return Promise.resolve(json({ parties: [] }));
    return Promise.resolve(json({}));
  }) as unknown as typeof fetch;
}

describe("StateElections — NG zone label", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses 'Zone Elections' for NG", async () => {
    mockFetch();
    render(<StateElections stateId="NORTH_EAST" stateName="North-East" countryId="NG" />);
    await waitFor(() => expect(screen.getByText("Zone Elections")).toBeTruthy());
  });

  it("keeps 'State Elections' for US", async () => {
    mockFetch();
    render(<StateElections stateId="CA" stateName="California" countryId="US" />);
    await waitFor(() => expect(screen.getByText("State Elections")).toBeTruthy());
  });
});
