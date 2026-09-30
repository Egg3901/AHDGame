/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameResetControls } from "./GameResetControls";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const presets = [
  {
    id: "1991-default",
    name: "1991 Start Date - Default Parties",
    description: "1991 data",
    countries: ["US"],
  },
  {
    id: "2019-default",
    name: "2019 Start Date - Default Parties",
    description: "2019 data",
    countries: ["US"],
  },
  {
    id: "2019-no-parties",
    name: "2019 Start Date - No Parties",
    description: "No parties",
    countries: [],
  },
];
const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

describe("1991 no starting parties picker", () => {
  beforeEach(() => {
    requests.length = 0;
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true)
    );
    vi.stubGlobal(
      "prompt",
      vi.fn(() => "RESET AND BOOTSTRAP")
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          requests.push({ url, body: JSON.parse(String(init.body)) });
          return new Response('data: {"type":"done","data":{"details":{}}}\n\n', {
            headers: { "content-type": "text/event-stream" },
          });
        }
        return new Response(JSON.stringify(url.includes("presets") ? { presets } : {}));
      })
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function pick1991() {
    render(<GameResetControls />);
    fireEvent.click(await screen.findByRole("button", { name: "1991" }));
  }

  it("enables No Parties for 1991 and sends the explicit choice without changing the data preset", async () => {
    await pick1991();
    const noParties = screen.getByRole("button", { name: "No Parties" });
    expect(noParties).toHaveProperty("disabled", false);
    fireEvent.click(noParties);
    expect(noParties.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByText(/Background countries keep their modeled parties and governments/)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset + No Parties" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].url).toContain("preset=1991-default");
    expect(requests[0].body.startingParties).toBe("none");
    expect(vi.mocked(confirm).mock.calls[0][0]).toContain("No starting parties");
    expect(vi.mocked(confirm).mock.calls[0][0]).toContain(
      "background countries keep their governments"
    );
  });

  it("switches back to default parties without carrying over the empty-party choice", async () => {
    await pick1991();
    fireEvent.click(screen.getByRole("button", { name: "No Parties" }));
    fireEvent.click(screen.getByRole("button", { name: "Default Parties" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset + Historical" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body.startingParties).toBe("default");
  });

  it("retains the existing 2019 no-parties preset when switching years", async () => {
    await pick1991();
    fireEvent.click(screen.getByRole("button", { name: "No Parties" }));
    fireEvent.click(screen.getByRole("button", { name: "2019" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset + Historical" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].url).toContain("preset=2019-no-parties");
    expect(requests[0].body.startingParties).toBeUndefined();
  });
});
