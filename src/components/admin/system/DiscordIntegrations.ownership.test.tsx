/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";

vi.mock("@/lib/observability/fetchJson", () => ({
  fetchJson: vi.fn(async () => ({
    general: { game: "", news: "https://discord.test/news", suggestions: "", changelog: "" },
    countries: [],
    electionTypes: [],
  })),
}));

import { DiscordIntegrations } from "./DiscordIntegrations";

/**
 * #1208: webhook URLs live in the database, so a restore hands another
 * deployment the players' channels. The save route refuses to move ownership
 * without an explicit claim — these cover the half of that contract the admin
 * actually sees.
 */
describe("DiscordIntegrations webhook ownership (#1208)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  async function renderLoaded() {
    render(<DiscordIntegrations />);
    // Save is gated on the initial GET resolving.
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /save webhooks/i }) as HTMLButtonElement).disabled
      ).toBe(false)
    );
  }

  function conflictResponse() {
    return {
      ok: false,
      status: 409,
      json: async () => ({
        error: 'These webhooks belong to the "main-site" deployment and this is "sandbox-staging".',
      }),
    };
  }

  it("shows the server's reason instead of a generic failure", async () => {
    fetchMock.mockResolvedValueOnce(conflictResponse());
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: /save webhooks/i }));

    await waitFor(() =>
      expect(screen.getByText(/belong to the "main-site" deployment/)).toBeTruthy()
    );
    expect(screen.queryByText(/check console/i)).toBeNull();
  });

  it("does not claim ownership on an ordinary save", async () => {
    // Regression guard: with `onClick={handleSave}` React passes the click
    // event as the first argument, so every save would have claimed.
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: /save webhooks/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.claimWebhooks).toBeUndefined();
  });

  it("offers to take ownership, and only then sends the claim", async () => {
    fetchMock.mockResolvedValueOnce(conflictResponse());
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: /save webhooks/i }));
    const claim = await screen.findByRole("button", { name: /take ownership and save/i });

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    fireEvent.click(claim);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(body.claimWebhooks).toBe(true);
  });

  it("does not offer the claim until a save is actually refused", async () => {
    await renderLoaded();
    expect(screen.queryByRole("button", { name: /take ownership and save/i })).toBeNull();
  });
});
